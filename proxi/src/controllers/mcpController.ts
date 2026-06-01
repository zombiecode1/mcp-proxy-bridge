import { Request, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import {
  getAgentService,
  getMawlanaRouter,
  getRagService,
  getStateDb,
  getVectorIndexService,
} from './agentController';
import { ensureConversation } from '../services/stateDb';
import { readRuntimeEvents, recordRuntimeEvent } from '../services/runtimeEventLog';

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
};

type McpSessionRecord = {
  sessionId: string;
  protocolVersion: string;
  clientInfo?: { name?: string; version?: string };
  capabilities?: any;
  logLevel?: string;
  initialized: boolean;
  createdAt: string;
  updatedAt: string;
  lastMethod?: string;
  sseResponse?: Response | null;
  lastEventId?: string;
};

const MCP_PROTOCOL_VERSION = '2025-03-26';
const mcpSessions = new Map<string, McpSessionRecord>();

function rpcResult(id: JsonRpcRequest['id'], result: any) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string, data?: any) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } };
}

function createSessionId() {
  return crypto.randomUUID();
}

function saveSession(session: McpSessionRecord) {
  mcpSessions.set(session.sessionId, session);
  return session;
}

function touchSession(sessionId: string, method?: string) {
  const session = mcpSessions.get(sessionId);
  if (!session) return;
  session.updatedAt = new Date().toISOString();
  if (method) session.lastMethod = method;
  mcpSessions.set(sessionId, session);
}

function sessionClientName(session?: McpSessionRecord) {
  return session?.clientInfo?.name || 'unknown';
}

function getSessionSummary() {
  const sessions = Array.from(mcpSessions.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    activeSessions: sessions.length,
    initializedSessions: sessions.filter((s) => s.initialized).length,
    clientNames: sessions.map((s) => s.clientInfo?.name).filter(Boolean),
    sessions: sessions.slice(0, 10).map((s) => ({
      sessionId: s.sessionId,
      protocolVersion: s.protocolVersion,
      clientInfo: s.clientInfo,
      logLevel: s.logLevel,
      initialized: s.initialized,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lastMethod: s.lastMethod,
    })),
    recentEvents: readRuntimeEvents(25),
  };
}

function sendSseEvent(res: Response, eventName: string, data: any, eventId?: string) {
  if (eventId) {
    res.write(`id: ${eventId}\n`);
  }
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendSseData(res: Response, data: any, eventId?: string) {
  if (eventId) {
    res.write(`id: ${eventId}\n`);
  }
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function buildTools() {
  return [
    {
      name: 'workspace_index',
      description: 'Index a workspace into the local vector store.',
      inputSchema: {
        type: 'object',
        properties: {
          directory: { type: 'string' },
          workspace_id: { type: 'string' },
        },
        required: ['directory'],
      },
    },
    {
      name: 'workspace_search',
      description: 'Search indexed workspace chunks.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          workspace_id: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
    {
      name: 'conversation_create',
      description: 'Create a new conversation id and persist its metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string' },
          user_id: { type: 'string' },
          title: { type: 'string' },
        },
      },
    },
    {
      name: 'conversation_history',
      description: 'Fetch a conversation with its message history.',
      inputSchema: {
        type: 'object',
        properties: {
          conversation_id: { type: 'string' },
        },
        required: ['conversation_id'],
      },
    },
    {
      name: 'conversation_list',
      description: 'List conversations for the current workspace or globally.',
      inputSchema: {
        type: 'object',
        properties: {
          workspace_id: { type: 'string' },
          limit: { type: 'number' },
        },
      },
    },
    {
      name: 'ssot_read',
      description: 'Read the current SSOT file.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'project_status',
      description: 'Read current agent, RAG, and index status.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'agent_routes',
      description: 'List available routing decisions for the active agent.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];
}

function buildResources() {
  return [
    { uri: 'zombiecoder://status', name: 'Agent status', mimeType: 'application/json' },
    { uri: 'zombiecoder://ssot', name: 'SSOT', mimeType: 'text/markdown' },
    { uri: 'zombiecoder://index', name: 'Vector index stats', mimeType: 'application/json' },
    { uri: 'zombiecoder://conversations', name: 'Conversation list', mimeType: 'application/json' },
  ];
}

function currentStatus() {
  const rag = getRagService();
  const index = getVectorIndexService();
  return {
    persona: getAgentService()?.getPersonaName() || 'ZombieCoder',
    workingDir: rag?.currentDir || null,
    hasWorkingDir: rag?.hasWorkingDir || false,
    ssotExists: rag?.ssotExists() || false,
    zombieDirExists: rag?.zombieDirExists() || false,
    index: index?.getStats() || { documents: 0, chunks: 0, workspaces: 0 },
    indexError: index?.getLastIndexError() || null,
    mcp: getSessionSummary(),
  };
}

export const handleMcpInfo = async (_req: Request, res: Response) => {
  return res.json({
    protocol: 'jsonrpc-2.0',
    name: 'proxi-mcp',
    version: '1.0.0',
    tools: buildTools().length,
    resources: buildResources().length,
    status: currentStatus(),
  });
};

async function handleJsonRpcMethod(body: JsonRpcRequest, sessionIdHeader: string): Promise<any> {
  const id = body?.id ?? null;
  const method = String(body?.method || '');
  const response: any = {};

  if (sessionIdHeader) {
    touchSession(sessionIdHeader, method);
  }

  if (method === 'initialize') {
    const sessionId = createSessionId();
    const clientInfo = body.params?.clientInfo && typeof body.params.clientInfo === 'object'
      ? {
          name: String(body.params.clientInfo.name || ''),
          version: String(body.params.clientInfo.version || ''),
        }
      : undefined;
    saveSession({
      sessionId,
      protocolVersion: MCP_PROTOCOL_VERSION,
      clientInfo,
      capabilities: body.params?.capabilities || {},
      logLevel: 'info',
      initialized: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastMethod: 'initialize',
    });
    recordRuntimeEvent({
      timestamp: new Date().toISOString(),
      category: 'mcp',
      event: 'initialize',
      sessionId,
      clientName: clientInfo?.name,
      clientVersion: clientInfo?.version,
      method,
      status: 'ok',
      details: { protocolVersion: MCP_PROTOCOL_VERSION },
    });
    response._sessionId = sessionId;
    response._protocolVersion = MCP_PROTOCOL_VERSION;
    response.body = rpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: { name: 'proxi-mcp', version: '1.0.0' },
      capabilities: {
        logging: {},
        resources: { subscribe: true, listChanged: true },
        tools: { listChanged: true },
      },
      instructions: 'Call tools/list or resources/list after notifications/initialized.',
    });
    return response;
  }

  if (method === 'notifications/initialized' || (method.startsWith('notifications/') && id == null)) {
    if (sessionIdHeader && mcpSessions.has(sessionIdHeader)) {
      const session = mcpSessions.get(sessionIdHeader)!;
      session.initialized = true;
      session.updatedAt = new Date().toISOString();
      session.lastMethod = method;
      mcpSessions.set(sessionIdHeader, session);
      recordRuntimeEvent({
        timestamp: new Date().toISOString(),
        category: 'mcp',
        event: 'initialized_notification',
        sessionId: sessionIdHeader,
        clientName: sessionClientName(session),
        clientVersion: session.clientInfo?.version,
        method,
        status: 'ok',
      });
    }
    response._noBody = true;
    return response;
  }

  if (method === 'logging/setLevel') {
    const level = String(body.params?.level || body.params?.logLevel || 'info').toLowerCase();
    if (sessionIdHeader && mcpSessions.has(sessionIdHeader)) {
      const session = mcpSessions.get(sessionIdHeader)!;
      session.logLevel = level;
      session.updatedAt = new Date().toISOString();
      session.lastMethod = method;
      mcpSessions.set(sessionIdHeader, session);
    }
    recordRuntimeEvent({
      timestamp: new Date().toISOString(),
      category: 'mcp',
      event: 'logging_set_level',
      sessionId: sessionIdHeader || undefined,
      method,
      status: 'ok',
      details: { level },
    });
    response.body = rpcResult(id, { level });
    return response;
  }

  if (method === 'tools/list') {
    recordRuntimeEvent({
      timestamp: new Date().toISOString(),
      category: 'mcp',
      event: 'tools_list',
      sessionId: sessionIdHeader || undefined,
      method,
      status: 'ok',
    });
    response.body = rpcResult(id, { tools: buildTools() });
    return response;
  }

  if (method === 'resources/list') {
    recordRuntimeEvent({
      timestamp: new Date().toISOString(),
      category: 'mcp',
      event: 'resources_list',
      sessionId: sessionIdHeader || undefined,
      method,
      status: 'ok',
    });
    response.body = rpcResult(id, { resources: buildResources() });
    return response;
  }

  if (method === 'resources/read') {
    const uri = String(body.params?.uri || '');
    const rag = getRagService();
    const index = getVectorIndexService();
    const stateDb = getStateDb();

    if (uri === 'zombiecoder://status') {
      recordRuntimeEvent({
        timestamp: new Date().toISOString(),
        category: 'mcp',
        event: 'resources_read_status',
        sessionId: sessionIdHeader || undefined,
        method,
        status: 'ok',
      });
      response.body = rpcResult(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(currentStatus(), null, 2) }] });
      return response;
    }
    if (uri === 'zombiecoder://ssot') {
      const text = rag?.readSSOT() || '';
      recordRuntimeEvent({
        timestamp: new Date().toISOString(),
        category: 'mcp',
        event: 'resources_read_ssot',
        sessionId: sessionIdHeader || undefined,
        method,
        status: 'ok',
      });
      response.body = rpcResult(id, { contents: [{ uri, mimeType: 'text/markdown', text }] });
      return response;
    }
    if (uri === 'zombiecoder://index') {
      const text = JSON.stringify(index?.getStats() || { documents: 0, chunks: 0, workspaces: 0 }, null, 2);
      recordRuntimeEvent({
        timestamp: new Date().toISOString(),
        category: 'mcp',
        event: 'resources_read_index',
        sessionId: sessionIdHeader || undefined,
        method,
        status: 'ok',
      });
      response.body = rpcResult(id, { contents: [{ uri, mimeType: 'application/json', text }] });
      return response;
    }
    if (uri === 'zombiecoder://conversations') {
      const conversations = stateDb
        ? stateDb.prepare(`
            SELECT conversation_id, workspace_id, user_id, title, created_at, updated_at
            FROM conversations
            ORDER BY updated_at DESC
            LIMIT 100
          `).all()
        : [];
      recordRuntimeEvent({
        timestamp: new Date().toISOString(),
        category: 'mcp',
        event: 'resources_read_conversations',
        sessionId: sessionIdHeader || undefined,
        method,
        status: 'ok',
      });
      response.body = rpcResult(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(conversations, null, 2) }] });
      return response;
    }

    response.statusCode = 404;
    response.body = rpcError(id, -32602, 'Unknown resource', { uri });
    return response;
  }

  if (method === 'tools/call') {
    const name = String(body.params?.name || '');
    const args = body.params?.arguments || {};
    const rag = getRagService();
    const index = getVectorIndexService();
    const stateDb = getStateDb();

    if (name === 'workspace_index') {
      const directory = String(args.directory || '');
      if (!directory) {
        response.statusCode = 400;
        response.body = rpcError(id, -32602, 'directory is required');
        return response;
      }
      const result = await index?.indexDirectory(path.resolve(directory), {
        workspaceId: args.workspace_id ? String(args.workspace_id) : undefined,
      });
      recordRuntimeEvent({
        timestamp: new Date().toISOString(),
        category: 'mcp',
        event: 'workspace_index',
        sessionId: sessionIdHeader || undefined,
        method,
        workspaceId: args.workspace_id ? String(args.workspace_id) : undefined,
        directory: path.resolve(directory),
        status: 'ok',
        details: result as any,
      });
      response.body = rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      return response;
    }

    if (name === 'workspace_search') {
      const query = String(args.query || '');
      if (!query) {
        response.statusCode = 400;
        response.body = rpcError(id, -32602, 'query is required');
        return response;
      }
      const result = await index?.search(query, {
        workspaceId: args.workspace_id ? String(args.workspace_id) : undefined,
        limit: Number(args.limit) || 5,
      });
      recordRuntimeEvent({
        timestamp: new Date().toISOString(),
        category: 'mcp',
        event: 'workspace_search',
        sessionId: sessionIdHeader || undefined,
        method,
        workspaceId: args.workspace_id ? String(args.workspace_id) : undefined,
        status: 'ok',
        details: { query, matches: result?.matches?.length || 0 },
      });
      response.body = rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      return response;
    }

    if (name === 'conversation_create') {
      if (!stateDb) {
        response.statusCode = 500;
        response.body = rpcError(id, -32000, 'state db not initialized');
        return response;
      }
      const conversationId = crypto.randomUUID();
      ensureConversation(stateDb, {
        conversation_id: conversationId,
        workspace_id: args.workspace_id ? String(args.workspace_id) : undefined,
        user_id: args.user_id ? String(args.user_id) : undefined,
        title: args.title ? String(args.title) : undefined,
      });
      recordRuntimeEvent({
        timestamp: new Date().toISOString(),
        category: 'mcp',
        event: 'conversation_create',
        sessionId: sessionIdHeader || undefined,
        method,
        workspaceId: args.workspace_id ? String(args.workspace_id) : undefined,
        status: 'ok',
        details: { conversationId },
      });
      response.body = rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ conversation_id: conversationId }, null, 2) }] });
      return response;
    }

    if (name === 'conversation_history') {
      if (!stateDb) {
        response.statusCode = 500;
        response.body = rpcError(id, -32000, 'state db not initialized');
        return response;
      }
      const conversationId = String(args.conversation_id || '');
      if (!conversationId) {
        response.statusCode = 400;
        response.body = rpcError(id, -32602, 'conversation_id is required');
        return response;
      }
      const conversation = stateDb.prepare(`
        SELECT conversation_id, workspace_id, user_id, title, created_at, updated_at
        FROM conversations
        WHERE conversation_id = ?
        LIMIT 1
      `).get(conversationId);
      const messages = stateDb.prepare(`
        SELECT id, conversation_id, role, content, created_at
        FROM conversation_messages
        WHERE conversation_id = ?
        ORDER BY id ASC
      `).all(conversationId);
      recordRuntimeEvent({
        timestamp: new Date().toISOString(),
        category: 'mcp',
        event: 'conversation_history',
        sessionId: sessionIdHeader || undefined,
        method,
        status: 'ok',
        details: { conversationId, messageCount: Array.isArray(messages) ? messages.length : 0 },
      });
      response.body = rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({ conversation, messages }, null, 2) }] });
      return response;
    }

    if (name === 'conversation_list') {
      if (!stateDb) {
        response.statusCode = 500;
        response.body = rpcError(id, -32000, 'state db not initialized');
        return response;
      }
      const limit = Math.max(1, Number(args.limit) || 50);
      const rows = args.workspace_id
        ? stateDb.prepare(`
            SELECT conversation_id, workspace_id, user_id, title, created_at, updated_at
            FROM conversations
            WHERE workspace_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
          `).all(String(args.workspace_id), limit)
        : stateDb.prepare(`
            SELECT conversation_id, workspace_id, user_id, title, created_at, updated_at
            FROM conversations
            ORDER BY updated_at DESC
            LIMIT ?
          `).all(limit);
      recordRuntimeEvent({
        timestamp: new Date().toISOString(),
        category: 'mcp',
        event: 'conversation_list',
        sessionId: sessionIdHeader || undefined,
        method,
        status: 'ok',
        details: { count: Array.isArray(rows) ? rows.length : 0 },
      });
      response.body = rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] });
      return response;
    }

    if (name === 'ssot_read') {
      const text = rag?.readSSOT() || '';
      recordRuntimeEvent({
        timestamp: new Date().toISOString(),
        category: 'mcp',
        event: 'ssot_read',
        sessionId: sessionIdHeader || undefined,
        method,
        status: 'ok',
      });
      response.body = rpcResult(id, { content: [{ type: 'text', text }] });
      return response;
    }

    if (name === 'project_status') {
      recordRuntimeEvent({
        timestamp: new Date().toISOString(),
        category: 'mcp',
        event: 'project_status',
        sessionId: sessionIdHeader || undefined,
        method,
        status: 'ok',
      });
      response.body = rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(currentStatus(), null, 2) }] });
      return response;
    }

    if (name === 'agent_routes') {
      const routes = getMawlanaRouter()?.getAllRoutes() || {};
      recordRuntimeEvent({
        timestamp: new Date().toISOString(),
        category: 'mcp',
        event: 'agent_routes',
        sessionId: sessionIdHeader || undefined,
        method,
        status: 'ok',
      });
      response.body = rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(routes, null, 2) }] });
      return response;
    }

    response.statusCode = 404;
    response.body = rpcError(id, -32601, 'Unknown tool', { name });
    return response;
  }

  if (method.startsWith('notifications/')) {
    response._noBody = true;
    return response;
  }

  response.statusCode = 404;
  response.body = rpcError(id, -32601, 'Method not found', { method });
  return response;
}

export const handleMcpJsonRpc = async (req: Request, res: Response) => {
  const body = req.body as JsonRpcRequest;

  try {
    if (!body || typeof body !== 'object') {
      return res.status(400).json(rpcError(null, -32600, 'Invalid Request'));
    }

    const sessionIdHeader = String(req.get('Mcp-Session-Id') || req.get('mcp-session-id') || '').trim();
    const acceptSse = (req.get('Accept') || '').includes('text/event-stream');
    const lastEventId = String(req.get('Last-Event-ID') || req.get('last-event-id') || '').trim() || undefined;

      // If client wants SSE and session supports it, stream the response
    if (acceptSse || lastEventId) {
      const result = await handleJsonRpcMethod(body, sessionIdHeader);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      if (result._sessionId) {
        res.setHeader('Mcp-Session-Id', result._sessionId);
        res.setHeader('MCP-Protocol-Version', result._protocolVersion);

        // Attach SSE response to session for server→client push
        const session = mcpSessions.get(result._sessionId);
        if (session) {
          session.sseResponse = res;
          session.lastEventId = lastEventId || '0';
          mcpSessions.set(result._sessionId, session);
        }
      }

      if (result._noBody) {
        sendSseEvent(res, 'done', {});
        res.end();
        return;
      }

      if (result.statusCode) {
        res.status(result.statusCode);
      }

      sendSseEvent(res, 'message', result.body);
      sendSseEvent(res, 'done', {});
      res.end();
      return;
    }

    // Normal JSON response
    const result = await handleJsonRpcMethod(body, sessionIdHeader);

    if (result._sessionId) {
      res.setHeader('Mcp-Session-Id', result._sessionId);
      res.setHeader('MCP-Protocol-Version', result._protocolVersion);
    }

    if (result._noBody) {
      return res.status(204).end();
    }

    if (result.statusCode) {
      return res.status(result.statusCode).json(result.body);
    }

    return res.json(result.body);
  } catch (err: any) {
    return res.status(500).json(rpcError(null, -32000, err?.message || 'Internal error'));
  }
};

export const handleMcpSseStream = async (req: Request, res: Response) => {
  const accept = req.get('Accept') || '*/*';
  const acceptJson = accept.includes('application/json') || accept === '*/*';
  const acceptSse = accept.includes('text/event-stream') || req.get('Upgrade') === 'text/event-stream';

  // Default to JSON (backward compat) unless SSE is explicitly requested
  if (acceptJson && !acceptSse) {
    return handleMcpInfo(req, res);
  }

  const sessionIdHeader = String(req.get('Mcp-Session-Id') || req.get('mcp-session-id') || '').trim();
  const lastEventId = String(req.get('Last-Event-ID') || req.get('last-event-id') || '0').trim();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial endpoint info
  sendSseEvent(res, 'endpoint', { url: '/mcp', protocol: MCP_PROTOCOL_VERSION, capabilities: ['streaming'] });

  if (sessionIdHeader && mcpSessions.has(sessionIdHeader)) {
    const session = mcpSessions.get(sessionIdHeader)!;
    session.sseResponse = res;
    session.lastEventId = lastEventId;
    mcpSessions.set(sessionIdHeader, session);

    sendSseEvent(res, 'resumed', { sessionId: sessionIdHeader, lastEventId });
  }

  // Keep connection alive with periodic heartbeats
  const heartbeat = setInterval(() => {
    sendSseEvent(res, 'heartbeat', { timestamp: new Date().toISOString() });
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    if (sessionIdHeader && mcpSessions.has(sessionIdHeader)) {
      const session = mcpSessions.get(sessionIdHeader)!;
      session.sseResponse = null;
      mcpSessions.set(sessionIdHeader, session);
    }
  });
};

export const handleMcpDeleteSession = async (req: Request, res: Response) => {
  const sessionId = String(req.params?.sessionId || req.get('Mcp-Session-Id') || req.get('mcp-session-id') || '').trim();

  if (!sessionId || !mcpSessions.has(sessionId)) {
    return res.status(404).json(rpcError(null, -32602, 'Session not found', { sessionId }));
  }

  const session = mcpSessions.get(sessionId)!;

  // Close SSE connection if open
  if (session.sseResponse) {
    try {
      sendSseEvent(session.sseResponse, 'session/terminated', { sessionId, reason: 'client requested' });
      session.sseResponse.end();
    } catch { /* ignore */ }
  }

  mcpSessions.delete(sessionId);

  recordRuntimeEvent({
    timestamp: new Date().toISOString(),
    category: 'mcp',
    event: 'session_terminated',
    sessionId,
    clientName: sessionClientName(session),
    status: 'ok',
  });

  return res.json(rpcResult(null, { terminated: true, sessionId }));
};
