#!/usr/bin/env node
const BASE = 'http://localhost:5001';

async function run() {
  const output = {
    patch: '03-write-verification',
    phase: 'Phase 3: Write Verification System (SHA-256 + Read-Back)',
    timestamp: new Date().toISOString(),
    tests: [],
    result: null,
  };

  const cases = [
    { name: 'POST write-log with hash', method: 'POST', path: '/db/write-log/hash',
      body: { table_name: 'patch-03-test', record_id: 'verify-demo', action: 'insert', new_hash: 'demo123', source_url: BASE } },
    { name: 'GET verify report', method: 'GET', path: '/db/verify/report' },
    { name: 'POST verify entry (id=4 from prior test)', method: 'POST', path: '/db/verify/4' },
    { name: 'POST verify-read identity', method: 'POST', path: '/db/verify-read',
      body: { table_name: 'identity', record_id: '1', id_col: 'id' } },
    { name: 'POST verify-read agent_notes', method: 'POST', path: '/db/verify-read',
      body: { table_name: 'agent_notes', record_id: '1', id_col: 'id' } },
  ];

  for (const c of cases) {
    try {
      const opts = { method: c.method, headers: {} };
      if (c.body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(c.body); }
      const res = await fetch(BASE + c.path, opts);
      const status = res.status;
      let data;
      try { data = await res.json(); } catch { data = { raw: await res.text() }; }

      const pass = status < 400;
      let summary;
      if (data && data.matches !== undefined) summary = data.matches ? 'HASH MATCH ✅' : 'HASH MISMATCH';
      else if (data && data.current_hash) summary = 'hash=' + data.current_hash.substring(0, 16) + '...';
      else if (data && data.total !== undefined) summary = data.verified + '/' + data.total + ' verified';
      else if (data && data.success !== undefined) summary = 'success';
      else summary = 'ok';

      output.tests.push({
        name: c.name, status, pass, summary,
        data_snippet: JSON.stringify(data).substring(0, 250),
      });
    } catch (e) {
      output.tests.push({ name: c.name, status: 0, pass: false, summary: 'ERROR: ' + e.message });
    }
  }

  // Final verification: write a real entry, compute hash, verify match
  try {
    // Get the identity row hash
    const vr = await fetch(BASE + '/db/verify-read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_name: 'identity', record_id: '1', id_col: 'id' }),
    });
    const vrData = await vr.json();
    const realHash = vrData.current_hash;

    // Write log with real hash
    await fetch(BASE + '/db/write-log/hash', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_name: 'identity', record_id: '1', action: 'phase3-final-verify', new_hash: realHash, source_url: BASE }),
    });

    // Get the log id of the new entry
    const report = await fetch(BASE + '/db/verify/report');
    const reportData = await report.json();
    const newEntryId = reportData.entries[0].id;

    // Verify it should match
    const verifyRes = await fetch(BASE + '/db/verify/' + newEntryId, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const verifyData = await verifyRes.json();

    output.final_verification = {
      entry_id: newEntryId,
      stored_hash: verifyData.entry?.new_hash,
      computed_hash: verifyData.computed_hash,
      matches: verifyData.matches,
      pass: verifyData.matches === true,
    };
  } catch (e) {
    output.final_verification = { error: e.message, pass: false };
  }

  const total = output.tests.length + (output.final_verification ? 1 : 0);
  const passed = output.tests.filter(t => t.pass).length + (output.final_verification?.pass ? 1 : 0);
  output.summary = { total, passed, failed: total - passed, pass_rate: ((passed / total) * 100).toFixed(1) + '%' };
  output.result = passed === total ? 'PASS' : 'FAIL';

  console.log(JSON.stringify(output, null, 2));
}

run().catch(e => console.log(JSON.stringify({
  patch: '03-write-verification', phase: 'Phase 3', timestamp: new Date().toISOString(),
  result: 'FAIL', error: { message: e.message },
}, null, 2)));
