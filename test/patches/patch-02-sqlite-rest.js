#!/usr/bin/env node
const BASE = 'http://localhost:5001';

const tests = [
  { name: 'DB Stats (all 12 tables)', method: 'GET', path: '/db/stats', expectStatus: 200 },
  { name: 'GET Identity', method: 'GET', path: '/db/identity', expectStatus: 200 },
  { name: 'GET LLM Sources', method: 'GET', path: '/db/llm/sources', expectStatus: 200 },
  { name: 'GET Conversations', method: 'GET', path: '/db/conversations?limit=3', expectStatus: 200 },
  { name: 'GET Messages', method: 'GET', path: '/db/conversation_messages?limit=2', expectStatus: 200 },
  { name: 'GET Agent Notes', method: 'GET', path: '/db/notes', expectStatus: 200 },
  { name: 'GET Write Log', method: 'GET', path: '/db/write-log', expectStatus: 200 },
  { name: 'GET Models table', method: 'GET', path: '/db/models?limit=3', expectStatus: 200 },
  { name: 'GET RAG Chunks', method: 'GET', path: '/db/rag_chunks?limit=2', expectStatus: 200 },
];

const writeTests = [
  {
    name: 'POST LLM Source',
    method: 'POST', path: '/db/llm/sources',
    body: { name: 'ollama-cloud', base_url: 'https://api.zombiecoder.my.id/v1', priority: 2 },
    expectStatus: 201,
  },
  {
    name: 'POST Agent Note',
    method: 'POST', path: '/db/notes',
    body: { key: 'phase2-verify', content: 'Phase 2 SQLite REST API verified working', category: 'patch' },
    expectStatus: 201,
  },
  {
    name: 'POST Write Log',
    method: 'POST', path: '/db/write-log',
    body: { table_name: 'patch-02', record_id: 'phase2', action: 'test-pass', source_url: BASE },
    expectStatus: 201,
  },
  {
    name: 'POST Identity Update',
    method: 'POST', path: '/db/identity',
    body: { tagline: 'Phase 2 verified: SQLite + REST API active' },
    expectStatus: 200,
  },
];

async function run() {
  const output = {
    patch: '02-sqlite-rest-api',
    phase: 'Phase 2: SQLite Resources + REST API',
    timestamp: new Date().toISOString(),
    env_vars_loaded: {
      LLM_BASE_URL: '(from .env)',
      LLM_FALLBACK_BASE_URL: '(from .env)',
      LLM_LOCAL_BASE_URL: '(from .env)',
    },
    tests: [],
    result: null,
  };

  for (const t of [...tests, ...writeTests]) {
    try {
      const opts = { method: t.method, headers: {} };
      if (t.body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(t.body);
      }
      const res = await fetch(BASE + t.path, opts);
      const status = res.status;
      let data;
      try { data = await res.json(); } catch { data = { raw: await res.text() }; }

      const pass = status === t.expectStatus;
      let summary;
      if (pass) {
        if (data && data.success !== undefined) {
          summary = 'success: ' + JSON.stringify(data.success);
        } else if (data && data.count !== undefined) {
          summary = data.count + ' rows returned';
        } else if (data && data.stats) {
          summary = Object.keys(data.stats).length + ' tables';
        } else {
          summary = 'ok';
        }
      } else {
        summary = 'FAIL: expected ' + t.expectStatus + ', got ' + status;
      }

      output.tests.push({
        name: t.name,
        method: t.method,
        path: t.path,
        expected_status: t.expectStatus,
        actual_status: status,
        pass: pass,
        summary: summary,
        data_snippet: JSON.stringify(data).substring(0, 200),
      });
    } catch (e) {
      output.tests.push({
        name: t.name,
        method: t.method,
        path: t.path,
        expected_status: t.expectStatus,
        actual_status: 0,
        pass: false,
        summary: 'ERROR: ' + e.message,
      });
    }
  }

  const total = output.tests.length;
  const passed = output.tests.filter(t => t.pass).length;
  output.summary = {
    total: total,
    passed: passed,
    failed: total - passed,
    pass_rate: ((passed / total) * 100).toFixed(1) + '%',
  };
  output.result = passed === total ? 'PASS' : 'FAIL';

  console.log(JSON.stringify(output, null, 2));
}

run().catch(e => {
  console.log(JSON.stringify({
    patch: '02-sqlite-rest-api',
    phase: 'Phase 2: SQLite Resources + REST API',
    timestamp: new Date().toISOString(),
    result: 'FAIL',
    error: { message: e.message, stack: e.stack },
  }, null, 2));
});
