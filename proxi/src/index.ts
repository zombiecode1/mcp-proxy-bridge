import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import routes from './routes/index';
import { authenticate } from './middleware/authMiddleware';
import { loggingMiddleware } from './middleware/loggingMiddleware';
import { initializeService, getService } from './controllers/openaiController';
import { cleanupOldLogs } from './services/fileLogger';
import identityMiddleware from './middleware/identityMiddleware';
import { loadIdentity } from './services/identityService';
import { initializeAgentSystem, getAgentService } from './controllers/agentController';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());

if (!GROQ_API_KEY) {
  console.error('GROQ_API_KEY is required in .env file');
  process.exit(1);
}

app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(loggingMiddleware);
// Load identity manifest early and attach identity headers to responses
loadIdentity();
app.use(identityMiddleware);

// /health is implemented in routes/index.ts (includes model/service stats)

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use(['/v1', '/api', '/dashboard'], authenticate);

app.use(routes);

async function start() {
  const service = initializeService(GROQ_API_KEY!);
  await service.initialize();
  cleanupOldLogs();
  setInterval(cleanupOldLogs, 3600000);

  // Initialize Agent & RAG system
  const DEFAULT_WORKSPACE = process.env.WORKSPACE_DIR || process.cwd();
  initializeAgentSystem(DEFAULT_WORKSPACE);
  const agentSvc = getAgentService();
  const persona = agentSvc?.getPersonaName() || 'ZombieCoder';

  app.listen(PORT, () => {
    const models = service.getModels();
    const lines = [
      '='.repeat(58),
      '  Groq OpenAI-Compatible Bridge',
      '='.repeat(58),
      `  Server:      http://localhost:${PORT}`,
      `  Models:      ${models.length} available`,
      `  Auth:        Optional (auto-uses env GROQ_API_KEY)`,
      `  CORS:        ${CORS_ORIGINS.join(', ')}`,
      `  Dashboard:   http://localhost:${PORT}/dashboard`,
      '',
      '  Endpoints:',
      `  POST /v1/chat/completions    - Chat (tools, vision, JSON mode, streaming)`,
      `  POST /v1/completions         - Text completions (legacy)`,
      `  POST /v1/audio/transcriptions  - Speech-to-text`,
      `  POST /v1/audio/translations    - Audio translation`,
      `  POST /v1/embeddings          - Text embeddings`,
      `  GET  /v1/models              - List models`,
      `  GET  /v1/models/:id          - Get model`,
      '',
      `  ${'='.repeat(52)}`,
      `  🌟 ZombieCoder Agent System (${persona})`,
      `  ${'='.repeat(52)}`,
      `  POST /v1/agent/chat          - Agent chat (RAG + Persona + Tool calling)`,
      `  POST /v1/agent/directory     - Set working directory`,
      `  POST /v1/agent/permission    - Grant/deny permission`,
      `  GET  /v1/agent/status        - Agent system status`,
      `  POST /v1/agent/rescan        - Rescan project`,
      `  GET  /v1/agent/ssot          - Read SSOT.md`,
      `  GET  /v1/agent/routes        - Available agent routes`,
      '',
      '  Features:',
      '  - Full OpenAI format pass-through (tools, streaming, images)',
      '  - Smart auto model routing based on input',
      '  - Per-model rate limit management',
      '  - Real-time dashboard & logging',
      '  - Disk-based RAG (SSOT.md) - single source of truth',
      '  - ZombieCoder agent persona with identity anchoring',
      '  - Permission-based project scanning',
      '  - No vendor lock-in - use any OpenAI-compatible client',
      '='.repeat(58),
    ];
    console.log(lines.join('\n'));
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
