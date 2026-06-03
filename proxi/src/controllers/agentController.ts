import { Request, Response } from 'express';
import { AgentService } from '../services/agentService';
import { DiskRAGService } from '../services/ragService';
import { MawlanaRouter } from '../services/mawlanaRouter';
import { getService } from './openaiController';
import { ChatCompletionCreateParams } from 'groq-sdk/resources/chat/completions';
import { getIdentity } from '../services/identityService';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { initStateDb, setStateDb, upsertModels, upsertModelRateLimits, upsertPersona, isWorkspaceTrusted, ensureConversation, addConversationMessage, upsertWorkspaceTrust } from '../services/stateDb';
import { startWorkspaceWatcher, WorkspaceWatcher } from '../services/workspaceWatcher';
import { VectorIndexService } from '../services/vectorIndexService';

function stripThinkBlocks(text: string): string {
  if (!text) return text;
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '');
}

let agentService: AgentService;
let ragService: DiskRAGService;
let mawlanaRouter: MawlanaRouter;
let vectorIndexService: VectorIndexService;
let stateDb: any;
const workspaceWatchers: Map<string, WorkspaceWatcher> = new Map();

export const initializeAgentSystem = (workingDir?: string) => {
  const groq = getService();
  if (!groq) throw new Error('GroqService not initialized');

  ragService = new DiskRAGService();
  mawlanaRouter = new MawlanaRouter(groq);
  agentService = new AgentService(groq, ragService);

  if (workingDir) {
    ragService.setWorkingDirectory(workingDir);
  }

  // Initialize local SQLite state DB under the working directory.
  try {
    const baseDir = path.resolve(workingDir || process.cwd());
    const zdir = path.join(baseDir, '.zombiecoder');
    if (!fs.existsSync(zdir)) fs.mkdirSync(zdir, { recursive: true });
    const dbPath = path.join(zdir, 'state.db');
    stateDb = initStateDb(dbPath);
    setStateDb(stateDb);
    vectorIndexService = new VectorIndexService(stateDb);

    const identity = getIdentity();
    if (identity?.system_identity) {
      upsertPersona(stateDb, {
        persona_id: 'default',
        name: identity.system_identity.name || 'ZombieCoder',
        system_prompt: identity.system_identity.system_prompt || '',
      });
    }

    upsertModels(stateDb, groq.getModels());
    upsertModelRateLimits(stateDb, groq.getConfiguredRateLimits());
  } catch (e: any) {
    console.warn('state db init failed:', e?.message || e);
  }

  return { agentService, ragService, mawlanaRouter };
};

export const getAgentService = () => agentService;
export const getRagService = () => ragService;
export const getMawlanaRouter = () => mawlanaRouter;
export const getVectorIndexService = () => vectorIndexService;
export const getStateDb = () => stateDb;

function resolveConversationId(conversation_id?: string): string {
  return conversation_id && String(conversation_id).trim() ? String(conversation_id).trim() : crypto.randomUUID();
}

export const handleAgentChat = async (req: Request, res: Response) => {
  try {
    const { messages, model, directory, category, legacy, user_id, workspace_id, conversation_id } = req.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: 'messages array is required', type: 'invalid_request_error' } });
    }

    if (directory) {
      const trusted = stateDb && user_id && workspace_id
        ? isWorkspaceTrusted(stateDb, String(workspace_id), String(user_id), path.resolve(String(directory)))
        : false;

      const result = await ragService.setWorkingDirectory(directory, { autoInit: trusted });
      if (result.needsPermission) {
        return res.json({
          requiresPermission: true,
          message: ragService.requestPermissionMessage('scan'),
          directory,
        });
      }

      if (vectorIndexService) {
        try {
          await vectorIndexService.indexDirectory(path.resolve(String(directory)), {
            workspaceId: workspace_id ? String(workspace_id) : undefined,
          });
        } catch (e: any) {
          console.warn('workspace index failed:', e?.message || e);
        }
      }
    }

    // Legacy agent JSON wrapper mode (kept for backward compatibility).
    if (legacy === true) {
      let selectedModel = model || undefined;
      if (mawlanaRouter && !model) {
        const route = await mawlanaRouter.route(messages, category);
        selectedModel = route.model;
      }
      const result = await agentService.processMessage(messages, selectedModel);
      return res.json(result);
    }

    // OpenAI-compatible mode: behave like /v1/chat/completions, but with optional routing + RAG injection.
    // IMPORTANT: do not forward agent-specific keys (directory/category/legacy/etc) to Groq.
    const body: any = req.body || {};
    const params: ChatCompletionCreateParams = {
      model: body.model,
      messages,
      temperature: body.temperature,
      top_p: body.top_p,
      max_tokens: body.max_tokens ?? body.max_completion_tokens,
      stop: body.stop,
      stream: body.stream,
      n: body.n,
      presence_penalty: body.presence_penalty,
      frequency_penalty: body.frequency_penalty,
      logprobs: body.logprobs,
      top_logprobs: body.top_logprobs,
      response_format: body.response_format,
      seed: body.seed,
      tools: body.tools,
      tool_choice: body.tool_choice,
      parallel_tool_calls: body.parallel_tool_calls,
      user: body.user,
    } as any;

    // Model routing
    if (!params.model || params.model === 'auto') {
      const route = await mawlanaRouter.route(messages, category);
      params.model = route.model;

      // RAG injection (SSOT.md)
      if (route.needsRag) {
        const lastMsg = String(messages[messages.length - 1]?.content || '');
        let ragContext = '';

        if (vectorIndexService && ragService.currentDir) {
          try {
            const indexed = await vectorIndexService.search(lastMsg, {
              workspaceId: workspace_id ? String(workspace_id) : undefined,
              limit: 5,
            });
            ragContext = indexed.matches
              .map((item) => `- ${item.source_path} [chunk ${item.chunk_index}] (score ${item.score.toFixed(4)}): ${item.chunk_text}`)
              .join('\n');
          } catch (e: any) {
            console.warn('vector search failed:', e?.message || e);
          }
        }

        if (!ragContext && ragService.ssotExists()) {
          ragContext = ragService.searchSSOT(lastMsg);
        }

        if (ragContext) {
          const sysIdx = params.messages.findIndex((m: any) => m.role === 'system');
          const docBlock = `Project context:\n${ragContext}`;
          if (sysIdx === -1) {
            params.messages.unshift({ role: 'system', content: docBlock } as any);
          } else {
            params.messages[sysIdx].content = String(params.messages[sysIdx].content || '') + `\n\n${docBlock}`;
          }
        }
      }
    }

    // Identity anchoring: ensure the system identity prompt is the first system message
    try {
      const identity = getIdentity();
      const sys = identity?.system_identity?.system_prompt;
      if (sys) {
        params.messages = Array.isArray(params.messages) ? params.messages : [];
        const first = params.messages[0];
        const needsInsert = !(first && first.role === 'system' && String(first.content || '').includes('ZombieCoder'));
        if (needsInsert) {
          params.messages.unshift({ role: 'system', content: sys } as any);
        }
      }
    } catch (e) {
      // do not fail the request if identity anchoring has an issue
      console.warn('identity anchor failed:', (e as any)?.message || e);
    }

    const groq = getService();
    if (!groq) throw new Error('GroqService not initialized');

    // Persist conversation memory (best-effort).
    const convoId = stateDb ? resolveConversationId(conversation_id) : (conversation_id ? String(conversation_id) : null);
    if (stateDb && convoId) {
      ensureConversation(stateDb, {
        conversation_id: convoId,
        workspace_id: workspace_id ? String(workspace_id) : undefined,
        user_id: user_id ? String(user_id) : undefined,
      });
      const lastUser = messages[messages.length - 1];
      if (lastUser?.role && typeof lastUser?.content === 'string') {
        addConversationMessage(stateDb, { conversation_id: convoId, role: String(lastUser.role), content: String(lastUser.content) });
      }
    }

    const isStream = params.stream === true;
    if (isStream) {
      const stream = await groq.createChatCompletion(params);
      res.setHeader('X-Conversation-Id', convoId || '');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      let aborted = false;
      req.on('close', () => { aborted = true; });

      for await (const chunk of stream as any) {
        if (aborted) break;
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      if (!aborted) {
        res.write('data: [DONE]\n\n');
        return res.end();
      }
    }

    const completion: any = await groq.createChatCompletion(params);
    if (Array.isArray(completion?.choices)) {
      for (const c of completion.choices) {
        const content = c?.message?.content;
        if (typeof content === 'string') c.message.content = stripThinkBlocks(content);
      }
    }

    if (stateDb && convoId) {
      const assistant = completion?.choices?.[0]?.message?.content;
      if (typeof assistant === 'string' && assistant.trim()) {
        addConversationMessage(stateDb, { conversation_id: convoId, role: 'assistant', content: assistant });
      }
    }

    return res.json({
      ...completion,
      conversation_id: convoId,
    });
  } catch (err: any) {
    console.error('❌ Agent error:', err.stack || err.message);
    res.status(err.status || 500).json({
      error: { message: err.message || 'Agent processing failed', type: 'server_error' },
    });
  }
};

export const handleCreateConversation = async (req: Request, res: Response) => {
  try {
    const { workspace_id, user_id, title, conversation_id } = req.body || {};
    if (!stateDb) {
      return res.status(500).json({ error: { message: 'state db not initialized', type: 'server_error' } });
    }

    const convoId = resolveConversationId(conversation_id);
    ensureConversation(stateDb, {
      conversation_id: convoId,
      workspace_id: workspace_id ? String(workspace_id) : undefined,
      user_id: user_id ? String(user_id) : undefined,
      title: title ? String(title) : undefined,
    });

    return res.status(201).json({ conversation_id: convoId });
  } catch (err: any) {
    return res.status(500).json({ error: { message: err.message || 'failed to create conversation', type: 'server_error' } });
  }
};

export const handleGetConversationHistory = async (req: Request, res: Response) => {
  try {
    const { conversation_id } = req.params;
    if (!stateDb || !conversation_id) {
      return res.status(400).json({ error: { message: 'conversation_id is required', type: 'invalid_request_error' } });
    }

    const convo = stateDb.prepare(`
      SELECT conversation_id, workspace_id, user_id, title, created_at, updated_at
      FROM conversations
      WHERE conversation_id = ?
      LIMIT 1
    `).get(String(conversation_id));

    if (!convo) {
      return res.status(404).json({ error: { message: 'conversation not found', type: 'not_found' } });
    }

    const messages = stateDb.prepare(`
      SELECT id, conversation_id, role, content, created_at
      FROM conversation_messages
      WHERE conversation_id = ?
      ORDER BY id ASC
    `).all(String(conversation_id));

    return res.json({ conversation: convo, messages });
  } catch (err: any) {
    return res.status(500).json({ error: { message: err.message || 'failed to fetch conversation', type: 'server_error' } });
  }
};

export const handleListConversations = async (req: Request, res: Response) => {
  try {
    if (!stateDb) {
      return res.status(500).json({ error: { message: 'state db not initialized', type: 'server_error' } });
    }
    const { workspace_id, limit } = req.query;
    const rows = workspace_id
      ? stateDb.prepare(`
          SELECT conversation_id, workspace_id, user_id, title, created_at, updated_at
          FROM conversations
          WHERE workspace_id = ?
          ORDER BY updated_at DESC
          LIMIT ?
        `).all(String(workspace_id), Math.max(1, Number(limit) || 50))
      : stateDb.prepare(`
          SELECT conversation_id, workspace_id, user_id, title, created_at, updated_at
          FROM conversations
          ORDER BY updated_at DESC
          LIMIT ?
        `).all(Math.max(1, Number(limit) || 50));

    return res.json({ conversations: rows });
  } catch (err: any) {
    return res.status(500).json({ error: { message: err.message || 'failed to list conversations', type: 'server_error' } });
  }
};

export const handleIndexWorkspace = async (req: Request, res: Response) => {
  try {
    const { directory, workspace_id } = req.body || {};
    if (!directory) {
      return res.status(400).json({ error: { message: 'directory is required', type: 'invalid_request_error' } });
    }
    if (!vectorIndexService) {
      return res.status(500).json({ error: { message: 'vector index not initialized', type: 'server_error' } });
    }

    const result = await vectorIndexService.indexDirectory(path.resolve(String(directory)), {
      workspaceId: workspace_id ? String(workspace_id) : undefined,
    });

    return res.json({ ok: true, result, stats: vectorIndexService.getStats() });
  } catch (err: any) {
    return res.status(500).json({ error: { message: err.message || 'failed to index workspace', type: 'server_error' } });
  }
};

export const handleSearchWorkspace = async (req: Request, res: Response) => {
  try {
    const { query, workspace_id, limit } = req.body || {};
    if (!query) {
      return res.status(400).json({ error: { message: 'query is required', type: 'invalid_request_error' } });
    }
    if (!vectorIndexService) {
      return res.status(500).json({ error: { message: 'vector index not initialized', type: 'server_error' } });
    }

    const result = await vectorIndexService.search(String(query), {
      workspaceId: workspace_id ? String(workspace_id) : undefined,
      limit: Number(limit) || 5,
    });

    return res.json({ ok: true, result, stats: vectorIndexService.getStats() });
  } catch (err: any) {
    return res.status(500).json({ error: { message: err.message || 'failed to search workspace', type: 'server_error' } });
  }
};

export const handleSetDirectory = async (req: Request, res: Response) => {
  try {
    const { directory, user_id, workspace_id } = req.body;
    if (!directory) {
      return res.status(400).json({ error: { message: 'directory is required', type: 'invalid_request_error' } });
    }
    const resolvedDir = path.resolve(String(directory));
    const trusted = stateDb && user_id && workspace_id
      ? isWorkspaceTrusted(stateDb, String(workspace_id), String(user_id), resolvedDir)
      : false;

    const result = await ragService.setWorkingDirectory(directory, { autoInit: trusted });

    if (result.needsPermission) {
      return res.json({
        requiresPermission: true,
        message: ragService.requestPermissionMessage('scan'),
        directory: resolvedDir,
        zombieDirExists: ragService.zombieDirExists(),
      });
    }

    // Start (or reuse) a watcher for auto SSOT refresh when the workspace is trusted or already initialized.
    try {
      const key = `${workspace_id || ''}:${resolvedDir}`;
      if (!workspaceWatchers.has(key)) {
        workspaceWatchers.set(key, startWorkspaceWatcher({
          directory: resolvedDir,
          rag: ragService,
          index: vectorIndexService,
          workspaceId: workspace_id ? String(workspace_id) : undefined,
        }));
      }
    } catch (e: any) {
      console.warn('watcher start failed:', e?.message || e);
    }

    return res.json({
      ok: true,
      directory: resolvedDir,
      ssotExists: ragService.ssotExists(),
      message: 'Directory ready. Agent can work.',
    });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message, type: 'server_error' } });
  }
};

export const handleGrantPermission = async (req: Request, res: Response) => {
  try {
    const { grant, scope, user_id, workspace_id, directory } = req.body;
    if (!grant) {
      return res.json({ ok: false, message: 'Permission not granted.' });
    }
    ragService.grantPermission(scope || 'scan');

    // If the caller provides user/workspace context, mark the workspace as trusted for this directory.
    try {
      if (stateDb && user_id && workspace_id && directory) {
        upsertWorkspaceTrust(stateDb, {
          workspace_id: String(workspace_id),
          user_id: String(user_id),
          directory: path.resolve(String(directory)),
          trusted: true,
        });
      }
    } catch (e: any) {
      console.warn('workspace trust update failed:', e?.message || e);
    }

    if (scope === 'scan' && !ragService.ssotExists()) {
      const scanResult = await ragService.scanProject();
      const template = ragService.generateSSOTTemplate(scanResult);
      ragService.saveSSOT(template);

      return res.json({
        ok: true,
        message: 'Permission granted. Project scanned. SSOT.md created.',
        ssotPath: path.join(ragService.currentDir, '.zombiecoder', 'SSOT.md'),
        fileCount: scanResult.files.length,
      });
    }

    res.json({ ok: true, message: `Permission granted for: ${scope}` });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message, type: 'server_error' } });
  }
};

export const handleProjectStatus = async (req: Request, res: Response) => {
  try {
    res.json({
      hasWorkingDir: ragService.hasWorkingDir,
      workingDir: ragService.currentDir || null,
      zombieDirExists: ragService.zombieDirExists(),
      ssotExists: ragService.ssotExists(),
      hasScanPermission: ragService.hasPermission('scan'),
      hasWritePermission: ragService.hasPermission('write'),
      persona: agentService?.getPersonaName() || 'none',
    });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message, type: 'server_error' } });
  }
};

export const handleRescan = async (req: Request, res: Response) => {
  try {
    if (!ragService.hasPermission('scan')) {
      return res.status(403).json({ error: { message: 'No scan permission. Grant permission first.', type: 'permission_error' } });
    }
    const scanResult = await ragService.scanProject();
    const template = ragService.generateSSOTTemplate(scanResult);
    ragService.saveSSOT(template);
    if (vectorIndexService) {
      try {
        const workspaceRow = stateDb && ragService.currentDir
          ? stateDb.prepare(`
              SELECT workspace_id
              FROM workspaces
              WHERE directory = ?
              ORDER BY updated_at DESC
              LIMIT 1
            `).get(path.resolve(ragService.currentDir))
          : null;
        await vectorIndexService.indexDirectory(ragService.currentDir || process.cwd(), {
          workspaceId: workspaceRow?.workspace_id ? String(workspaceRow.workspace_id) : undefined,
        });
      } catch (e: any) {
        console.warn('rescan index failed:', e?.message || e);
      }
    }
    res.json({ ok: true, message: 'Project rescanned and SSOT.md updated.', fileCount: scanResult.files.length });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message, type: 'server_error' } });
  }
};

export const handleReadSSOT = async (req: Request, res: Response) => {
  try {
    const content = ragService.readSSOT();
    if (!content) {
      return res.status(404).json({ error: { message: 'SSOT.md not found. Scan project first.', type: 'not_found' } });
    }
    res.set('Content-Type', 'text/markdown');
    res.send(content);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message, type: 'server_error' } });
  }
};

export const handleAgentRoutes = async (req: Request, res: Response) => {
  const routes = mawlanaRouter?.getAllRoutes() || {};
  res.json({ routes, persona: agentService?.getPersonaName() || 'ZombieCoder' });
};
