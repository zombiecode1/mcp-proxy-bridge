// SQLite state store for agent/persona/models/rate-limits/memory.
// This is intentionally local-first: a single file per workspace (or per instance).

// @ts-ignore - better-sqlite3 has no @types package
import Database from 'better-sqlite3';

export type StateDb = any;

let _globalDb: StateDb | null = null;
export function setStateDb(db: StateDb) { _globalDb = db; }
export function getStateDb(): StateDb | null { return _globalDb; }

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

  // ─── Phase 2: New Tables ────────────────────────────────
  db.prepare(`
    CREATE TABLE IF NOT EXISTS identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL DEFAULT 'ZombieCoder',
      version TEXT NOT NULL DEFAULT '2.0.0',
      tagline TEXT DEFAULT 'Local-first AI execution engine',
      owner TEXT DEFAULT '',
      organization TEXT DEFAULT '',
      address TEXT DEFAULT '',
      location TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      website TEXT DEFAULT '',
      license TEXT DEFAULT 'MIT',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS llm_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key_env TEXT,
      priority INTEGER NOT NULL DEFAULT 1,
      health_status TEXT DEFAULT 'unknown',
      last_verified DATETIME,
      models_json TEXT,
      is_active INTEGER DEFAULT 1,
      error_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS agent_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      version INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS write_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      old_hash TEXT,
      new_hash TEXT,
      verified INTEGER DEFAULT 0,
      source_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  // Seed default identity row if not exists
  db.prepare(`
    INSERT OR IGNORE INTO identity (id, name, version, tagline)
    VALUES (1, 'ZombieCoder', '2.0.0', 'Local-first AI execution engine');
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

// ═══════════════════════════════════════════════════════════════
// Phase 2 — Multi-Source DB Functions
// ═══════════════════════════════════════════════════════════════

// ─── Identity ──────────────────────────────────────────────
export function getIdentity(db: StateDb) {
  return db.prepare(`SELECT * FROM identity WHERE id = 1`).get() || null;
}

const IDENTITY_ALLOWED_COLUMNS = new Set([
  'name', 'version', 'tagline', 'owner', 'organization',
  'system_identity', 'profile_json', 'updated_at'
]);

export function upsertIdentity(db: StateDb, data: Record<string, any>) {
  const keys = Object.keys(data)
    .filter(k => k !== 'id' && k !== 'created_at' && IDENTITY_ALLOWED_COLUMNS.has(k));
  const sets = keys.map(k => `"${k}"=?`).join(',');
  const vals = keys.map(k => data[k]);
  if (!sets) return;
  db.prepare(`UPDATE identity SET ${sets}, updated_at=CURRENT_TIMESTAMP WHERE id=1`).run(...vals);
}

// ─── LLM Sources ───────────────────────────────────────────
export function listLlmSources(db: StateDb) {
  return db.prepare(`SELECT * FROM llm_sources ORDER BY priority ASC`).all();
}

export function getLlmSource(db: StateDb, id: number) {
  return db.prepare(`SELECT * FROM llm_sources WHERE id = ?`).get(id) || null;
}

export function upsertLlmSource(db: StateDb, src: {
  name: string; base_url: string; api_key_env?: string; priority: number;
}) {
  return db.prepare(`
    INSERT INTO llm_sources(name, base_url, api_key_env, priority, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      base_url=excluded.base_url, api_key_env=excluded.api_key_env,
      priority=excluded.priority, updated_at=CURRENT_TIMESTAMP
  `).run(src.name, src.base_url, src.api_key_env || null, src.priority);
}

export function deleteLlmSource(db: StateDb, id: number) {
  return db.prepare(`DELETE FROM llm_sources WHERE id = ?`).run(id);
}

// ─── Agent Notes ───────────────────────────────────────────
export function listAgentNotes(db: StateDb, workspace_id?: string, category?: string) {
  let sql = `SELECT * FROM agent_notes WHERE 1=1`;
  const params: any[] = [];
  if (workspace_id) { sql += ` AND workspace_id=?`; params.push(workspace_id); }
  if (category) { sql += ` AND category=?`; params.push(category); }
  sql += ` ORDER BY updated_at DESC LIMIT 200`;
  return db.prepare(sql).all(...params);
}

export function getAgentNote(db: StateDb, key: string) {
  return db.prepare(`SELECT * FROM agent_notes WHERE key = ? ORDER BY version DESC LIMIT 1`).get(key) || null;
}

export function upsertAgentNote(db: StateDb, note: {
  workspace_id?: string; key: string; content: string; category?: string;
}) {
  const existing = db.prepare(`SELECT version FROM agent_notes WHERE key = ? ORDER BY version DESC LIMIT 1`).get(note.key) as any;
  const version = (existing?.version || 0) + 1;
  return db.prepare(`
    INSERT INTO agent_notes(workspace_id, key, content, category, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(note.workspace_id || null, note.key, note.content, note.category || 'general', version);
}

export function deleteAgentNote(db: StateDb, key: string) {
  return db.prepare(`DELETE FROM agent_notes WHERE key = ?`).run(key);
}

// ─── Write Log (Verification) ──────────────────────────────
export function listWriteLog(db: StateDb, table_name?: string, limit = 100) {
  let sql = `SELECT * FROM write_log WHERE 1=1`;
  const params: any[] = [];
  if (table_name) { sql += ` AND table_name=?`; params.push(table_name); }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

export function addWriteLog(db: StateDb, entry: {
  table_name: string; record_id: string; action: string;
  old_hash?: string; new_hash?: string; source_url?: string;
}) {
  return db.prepare(`
    INSERT INTO write_log(table_name, record_id, action, old_hash, new_hash, source_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(entry.table_name, entry.record_id, entry.action,
    entry.old_hash || null, entry.new_hash || null, entry.source_url || null);
}

// ═══════════════════════════════════════════════════════════════
// Phase 3 — Write Verification
// ═══════════════════════════════════════════════════════════════

export function addWriteLogWithHash(db: StateDb, entry: {
  table_name: string; record_id: string; action: string;
  old_hash?: string; new_hash?: string; source_url?: string;
}) {
  return db.prepare(`
    INSERT INTO write_log(table_name, record_id, action, old_hash, new_hash, source_url, verified)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(entry.table_name, entry.record_id, entry.action,
    entry.old_hash || null, entry.new_hash || null, entry.source_url || null);
}

export async function verifyWriteLogEntry(db: StateDb, logId: number): Promise<any> {
  const entry = db.prepare(`SELECT * FROM write_log WHERE id = ?`).get(logId) as any;
  if (!entry) return { entry: null, computed_hash: null, matches: false };

  const tableName = entry.table_name;
  const recordId = entry.record_id;
  const pk = TABLE_PK[tableName] || 'id';

  const allowedTables = Object.keys(TABLE_PK);
  if (!allowedTables.includes(tableName)) {
    return { entry, computed_hash: null, matches: false, error: 'table not whitelisted' };
  }

  let row: any = null;
  try {
    row = db.prepare(`SELECT * FROM "${tableName}" WHERE "${pk}" = ? LIMIT 1`).get(recordId) as any;
  } catch {
    return { entry, computed_hash: null, matches: false };
  }
  if (!row) {
    return { entry, computed_hash: null, matches: false, error: 'record not found' };
  }

  const { hashRow: hashRowFn } = await import('./hashUtils');
  const computed = hashRowFn(row);
  const stored = entry.new_hash || '';
  const matches = computed === stored;

  db.prepare(`UPDATE write_log SET verified = ? WHERE id = ?`).run(matches ? 1 : 0, logId);

  return { entry, computed_hash: computed, matches };
}

export function getVerificationReport(db: StateDb): {
  total: number; verified: number; unverified: number; failed: number; entries: any[];
} {
  const all = db.prepare(`SELECT * FROM write_log ORDER BY id DESC`).all() as any[];
  const total = all.length;
  let verified = 0, unverified = 0, failed = 0;
  for (const e of all) {
    if (e.verified === 1) verified++;
    else if (e.verified === -1) failed++;
    else unverified++;
  }
  return { total, verified, unverified, failed, entries: all.slice(0, 50) };
}

// ─── Generic table query helpers ───────────────────────────
const TABLE_PK: Record<string, string> = {
  identity: 'id',
  llm_sources: 'id',
  agent_notes: 'id',
  write_log: 'id',
  agent_personas: 'persona_id',
  models: 'model_id',
  model_rate_limits: 'model_id',
  workspaces: 'workspace_id',
  conversations: 'conversation_id',
  conversation_messages: 'id',
  rag_documents: 'document_id',
  rag_chunks: 'chunk_id',
};

export function getPkForTable(table: string): string {
  return TABLE_PK[table] || 'id';
}

export function listAllFromTable(db: StateDb, table: string, limit = 100) {
  // Whitelist allowed tables for safety
  const allowed = Object.keys(TABLE_PK);
  if (!allowed.includes(table)) throw new Error(`Table '${table}' not in whitelist`);
  const orderCol = TABLE_PK[table];
  return db.prepare(`SELECT * FROM "${table}" ORDER BY "${orderCol}" DESC LIMIT ?`).all(limit);
}

export function getByIdFromTable(db: StateDb, table: string, idCol: string, idVal: string) {
  const allowed = ['identity','llm_sources','agent_notes','write_log',
    'agent_personas','models','model_rate_limits','workspaces',
    'conversations','conversation_messages','rag_documents','rag_chunks'];
  if (!allowed.includes(table)) throw new Error(`Table '${table}' not in whitelist`);
  return db.prepare(`SELECT * FROM "${table}" WHERE "${idCol}" = ? LIMIT 1`).get(idVal) || null;
}
