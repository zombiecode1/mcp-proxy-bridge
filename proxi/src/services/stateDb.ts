// SQLite state store for agent/persona/models/rate-limits/memory.
// This is intentionally local-first: a single file per workspace (or per instance).

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database: any = require('better-sqlite3');

export type StateDb = any;

export function initStateDb(dbPath: string): StateDb {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.prepare(`
    CREATE TABLE IF NOT EXISTS agent_personas (
      persona_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS models (
      model_id TEXT PRIMARY KEY,
      owned_by TEXT,
      category TEXT,
      context_window INTEGER,
      max_tokens INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS model_rate_limits (
      model_id TEXT PRIMARY KEY,
      rpm INTEGER,
      tpm INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS workspaces (
      workspace_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      directory TEXT NOT NULL,
      trusted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS conversations (
      conversation_id TEXT PRIMARY KEY,
      workspace_id TEXT,
      user_id TEXT,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS rag_documents (
      document_id TEXT PRIMARY KEY,
      workspace_id TEXT,
      source_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      chunk_count INTEGER DEFAULT 0,
      indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS rag_chunks (
      chunk_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      workspace_id TEXT,
      source_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      embedding_dim INTEGER NOT NULL,
      token_count INTEGER DEFAULT 0,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_workspace
    ON rag_chunks(workspace_id, source_path, chunk_index);
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_document
    ON rag_chunks(document_id);
  `).run();

  return db;
}

export function upsertPersona(db: StateDb, persona: { persona_id: string; name: string; system_prompt: string }) {
  db.prepare(`
    INSERT INTO agent_personas(persona_id, name, system_prompt, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(persona_id) DO UPDATE SET
      name=excluded.name,
      system_prompt=excluded.system_prompt,
      updated_at=CURRENT_TIMESTAMP
  `).run(persona.persona_id, persona.name, persona.system_prompt);
}

export function upsertModels(db: StateDb, models: Array<{ id: string; owned_by?: string; category?: string; context_window?: number; max_tokens?: number }>) {
  const stmt = db.prepare(`
    INSERT INTO models(model_id, owned_by, category, context_window, max_tokens, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(model_id) DO UPDATE SET
      owned_by=excluded.owned_by,
      category=excluded.category,
      context_window=excluded.context_window,
      max_tokens=excluded.max_tokens,
      updated_at=CURRENT_TIMESTAMP
  `);
  const tx = db.transaction((items: any[]) => {
    for (const m of items) {
      if (!m?.id) continue;
      stmt.run(m.id, m.owned_by || null, m.category || null, m.context_window || null, m.max_tokens || null);
    }
  });
  tx(models as any);
}

export function upsertModelRateLimits(db: StateDb, limits: Array<{ model: string; rpm?: number; tpm?: number }>) {
  const stmt = db.prepare(`
    INSERT INTO model_rate_limits(model_id, rpm, tpm, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(model_id) DO UPDATE SET
      rpm=excluded.rpm,
      tpm=excluded.tpm,
      updated_at=CURRENT_TIMESTAMP
  `);
  const tx = db.transaction((items: any[]) => {
    for (const lim of items) {
      if (!lim?.model) continue;
      stmt.run(lim.model, lim.rpm ?? null, lim.tpm ?? null);
    }
  });
  tx(limits as any);
}

export function upsertWorkspaceTrust(
  db: StateDb,
  ws: { workspace_id: string; user_id: string; directory: string; trusted: boolean }
) {
  db.prepare(`
    INSERT INTO workspaces(workspace_id, user_id, directory, trusted, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(workspace_id) DO UPDATE SET
      user_id=excluded.user_id,
      directory=excluded.directory,
      trusted=excluded.trusted,
      updated_at=CURRENT_TIMESTAMP
  `).run(ws.workspace_id, ws.user_id, ws.directory, ws.trusted ? 1 : 0);
}

export function isWorkspaceTrusted(db: StateDb, workspace_id: string, user_id: string, directory: string): boolean {
  const row = db.prepare(`
    SELECT trusted FROM workspaces
    WHERE workspace_id = ? AND user_id = ? AND directory = ?
    LIMIT 1
  `).get(workspace_id, user_id, directory);
  return !!row?.trusted;
}

export function ensureConversation(db: StateDb, convo: { conversation_id: string; workspace_id?: string; user_id?: string; title?: string }) {
  db.prepare(`
    INSERT INTO conversations(conversation_id, workspace_id, user_id, title, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(conversation_id) DO UPDATE SET
      updated_at=CURRENT_TIMESTAMP
  `).run(convo.conversation_id, convo.workspace_id || null, convo.user_id || null, convo.title || null);
}

export function addConversationMessage(db: StateDb, msg: { conversation_id: string; role: string; content: string }) {
  db.prepare(`
    INSERT INTO conversation_messages(conversation_id, role, content)
    VALUES (?, ?, ?)
  `).run(msg.conversation_id, msg.role, msg.content);
}

export function listConversationMessages(db: StateDb, conversation_id: string, limit = 200) {
  return db.prepare(`
    SELECT id, conversation_id, role, content, created_at
    FROM conversation_messages
    WHERE conversation_id = ?
    ORDER BY id ASC
    LIMIT ?
  `).all(conversation_id, limit);
}

export function getConversation(db: StateDb, conversation_id: string) {
  return db.prepare(`
    SELECT conversation_id, workspace_id, user_id, title, created_at, updated_at
    FROM conversations
    WHERE conversation_id = ?
    LIMIT 1
  `).get(conversation_id);
}

export function listConversations(db: StateDb, limit = 50, workspace_id?: string) {
  if (workspace_id) {
    return db.prepare(`
      SELECT conversation_id, workspace_id, user_id, title, created_at, updated_at
      FROM conversations
      WHERE workspace_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(workspace_id, limit);
  }
  return db.prepare(`
    SELECT conversation_id, workspace_id, user_id, title, created_at, updated_at
    FROM conversations
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);
}

export function upsertRagDocument(
  db: StateDb,
  doc: {
    document_id: string;
    workspace_id?: string | null;
    source_path: string;
    content_hash: string;
    chunk_count: number;
  }
) {
  db.prepare(`
    INSERT INTO rag_documents(document_id, workspace_id, source_path, content_hash, chunk_count, indexed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(document_id) DO UPDATE SET
      workspace_id=excluded.workspace_id,
      source_path=excluded.source_path,
      content_hash=excluded.content_hash,
      chunk_count=excluded.chunk_count,
      indexed_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP
  `).run(doc.document_id, doc.workspace_id || null, doc.source_path, doc.content_hash, doc.chunk_count);
}

export function deleteRagChunksForDocument(db: StateDb, document_id: string) {
  db.prepare(`DELETE FROM rag_chunks WHERE document_id = ?`).run(document_id);
}

export function upsertRagChunk(
  db: StateDb,
  chunk: {
    chunk_id: string;
    document_id: string;
    workspace_id?: string | null;
    source_path: string;
    chunk_index: number;
    chunk_text: string;
    content_hash: string;
    embedding_json: string;
    embedding_dim: number;
    token_count: number;
    metadata_json?: string | null;
  }
) {
  db.prepare(`
    INSERT INTO rag_chunks(
      chunk_id, document_id, workspace_id, source_path, chunk_index, chunk_text,
      content_hash, embedding_json, embedding_dim, token_count, metadata_json,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(chunk_id) DO UPDATE SET
      document_id=excluded.document_id,
      workspace_id=excluded.workspace_id,
      source_path=excluded.source_path,
      chunk_index=excluded.chunk_index,
      chunk_text=excluded.chunk_text,
      content_hash=excluded.content_hash,
      embedding_json=excluded.embedding_json,
      embedding_dim=excluded.embedding_dim,
      token_count=excluded.token_count,
      metadata_json=excluded.metadata_json,
      updated_at=CURRENT_TIMESTAMP
  `).run(
    chunk.chunk_id,
    chunk.document_id,
    chunk.workspace_id || null,
    chunk.source_path,
    chunk.chunk_index,
    chunk.chunk_text,
    chunk.content_hash,
    chunk.embedding_json,
    chunk.embedding_dim,
    chunk.token_count,
    chunk.metadata_json || null,
  );
}

export function listRagChunks(db: StateDb, workspace_id?: string | null, limit = 500) {
  if (workspace_id) {
    return db.prepare(`
      SELECT chunk_id, document_id, workspace_id, source_path, chunk_index, chunk_text,
             content_hash, embedding_json, embedding_dim, token_count, metadata_json,
             created_at, updated_at
      FROM rag_chunks
      WHERE workspace_id = ?
      ORDER BY updated_at DESC, chunk_index ASC
      LIMIT ?
    `).all(workspace_id, limit);
  }
  return db.prepare(`
    SELECT chunk_id, document_id, workspace_id, source_path, chunk_index, chunk_text,
           content_hash, embedding_json, embedding_dim, token_count, metadata_json,
           created_at, updated_at
    FROM rag_chunks
    ORDER BY updated_at DESC, chunk_index ASC
    LIMIT ?
  `).all(limit);
}

export function getRagIndexStats(db: StateDb) {
  const docs = db.prepare(`SELECT COUNT(*) as count FROM rag_documents`).get()?.count || 0;
  const chunks = db.prepare(`SELECT COUNT(*) as count FROM rag_chunks`).get()?.count || 0;
  const workspaces = db.prepare(`SELECT COUNT(DISTINCT workspace_id) as count FROM rag_chunks WHERE workspace_id IS NOT NULL`).get()?.count || 0;
  return { documents: docs, chunks, workspaces };
}
