import { Router, Request, Response } from 'express';
import multer from 'multer';
import {
  handleChatCompletion,
  handleTextCompletion,
  handleTranscription,
  handleTranslation,
  handleEmbeddings,
  handleListModels,
  handleGetModel,
  handleDashboard,
  getService,
} from '../controllers/openaiController';
import {
  handleAgentChat,
  handleSetDirectory,
  handleGrantPermission,
  handleProjectStatus,
  handleRescan,
  handleReadSSOT,
  handleAgentRoutes,
  handleCreateConversation,
  handleGetConversationHistory,
  handleListConversations,
  handleIndexWorkspace,
  handleSearchWorkspace,
} from '../controllers/agentController';
import { handleMcpJsonRpc, handleMcpInfo, handleMcpSseStream, handleMcpDeleteSession } from '../controllers/mcpController';
import { clearRuntimeEvents, readRuntimeEvents } from '../services/runtimeEventLog';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Health
router.get('/health', (req: Request, res: Response) => {
  const service = getService();
  res.json({
    status: 'ok',
    service: 'groq-openai-bridge',
    version: '2.0.0',
    uptime_ms: service ? Date.now() - service.startedAtMs : 0,
    models_loaded: service ? service.getModels().length : 0,
  });
});

// OpenAI-compatible endpoints
router.post('/v1/chat/completions', handleChatCompletion);
router.post('/v1/completions', handleTextCompletion);
router.post('/v1/audio/transcriptions', upload.single('file'), handleTranscription);
router.post('/v1/audio/translations', upload.single('file'), handleTranslation);
router.post('/v1/embeddings', handleEmbeddings);
router.get('/v1/models', handleListModels);
router.get('/v1/models/:model', handleGetModel);

// Dashboard
router.get('/dashboard', handleDashboard);

// Internal API
router.get('/api/logs', (req: Request, res: Response) => {
  const service = getService();
  res.json({ logs: service?.getLogs().slice(-200) || [] });
});

router.get('/api/events', (req: Request, res: Response) => {
  res.json({ events: readRuntimeEvents(200) });
});

router.delete('/api/events', (req: Request, res: Response) => {
  clearRuntimeEvents();
  res.json({ success: true });
});

router.delete('/api/logs', (req: Request, res: Response) => {
  const service = getService();
  if (service) service.logs = [];
  res.json({ success: true });
});

router.get('/api/rate-limits', (req: Request, res: Response) => {
  const service = getService();
  res.json(service?.getRateLimits() || []);
});

router.post('/api/auto-select', (req: Request, res: Response) => {
  const service = getService();
  if (service) {
    service.autoSelect = req.body.enabled === true;
    res.json({ auto_select: service.autoSelect });
  } else {
    res.status(500).json({ error: 'Service not initialized' });
  }
});

router.get('/api/status', (req: Request, res: Response) => {
  const service = getService();
  res.json(service?.getStatus() || { status: 'degraded' as const });
});

// ─── Agent & RAG Endpoints ────────────────────────────────
router.post('/v1/agent/chat', handleAgentChat);
router.post('/v1/agent/directory', handleSetDirectory);
router.post('/v1/agent/permission', handleGrantPermission);
router.get('/v1/agent/status', handleProjectStatus);
router.post('/v1/agent/rescan', handleRescan);
router.get('/v1/agent/ssot', handleReadSSOT);
router.get('/v1/agent/routes', handleAgentRoutes);
router.post('/v1/agent/conversations', handleCreateConversation);
router.get('/v1/agent/conversations', handleListConversations);
router.get('/v1/agent/conversations/:conversation_id', handleGetConversationHistory);
router.post('/v1/agent/index', handleIndexWorkspace);
router.post('/v1/agent/search', handleSearchWorkspace);

// MCP-style JSON-RPC endpoints for editor/tool clients
// Streamable HTTP Transport (MCP spec 2025-03-26)
// GET  /mcp          → SSE stream for server→client events (optional, for stateful sessions)
// POST /mcp          → JSON-RPC request/response (supports Accept: text/event-stream for SSE)
// DELETE /mcp/:id    → Session termination
router.get('/mcp', handleMcpSseStream);
router.post('/mcp', handleMcpJsonRpc);
router.get('/mcp/info', handleMcpInfo);
router.delete('/mcp/:sessionId', handleMcpDeleteSession);

export default router;
