// ─── Patch 04: OAuth Authentication + LangGraph Recursion Fix ──────────────
// Follows mcp-use official docs for oauthProxy (mcp-use v1.28.0)

import { SignJWT } from "jose";

const SECRET = "zombiecoder-dev-secret-2026";
const ISSUER = "mcp-agent-server";
const BASE   = "http://localhost:3000";

const secretKey = new TextEncoder().encode(SECRET);

const token = await new SignJWT({
  sub: "test-user-01",
  email: "test@zombiecoder.local",
  name: "Test User",
  scope: "tools:* openid profile",
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setIssuer(ISSUER)
  .setExpirationTime("1h")
  .sign(secretKey);

console.log(`\n🔐 Patch 04 — OAuth Auth + Recursion Fix — ${new Date().toISOString()}\n`);

function log(step, ok, msg) {
  console.log(`  ${ok ? "✅" : "❌"} Step ${step}: ${msg}`);
}

const results = [];
let pass = 0, fail = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (ok) pass++; else fail++;
}

const call = async (method, params, authed) => {
  const headers = { "Content-Type": "application/json" };
  if (authed) headers["Authorization"] = "Bearer " + token;
  const r = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const status = r.status;
  const json = await r.json();
  return { status, json };
};

// ─── 1. listTools with auth ────────────────────────────────────────────────
const t1 = await call("tools/list", {}, true);
const t1ok = t1.status === 200 && t1.json.result?.tools?.length >= 3;
record("1-list-tools-auth", t1ok, `tools=${t1.json.result?.tools?.length}`);
log(1, t1ok, `Tools listed: ${t1.json.result?.tools?.length}`);

// ─── 2. listTools WITHOUT auth ──────────────────────────────────────────────
const t2 = await call("tools/list", {}, false);
const t2ok = t2.status === 401;
record("2-list-tools-noauth", t2ok, `status=${t2.status}`);
log(2, t2ok, `401 Unauthorized: ${t2.status}`);

// ─── 3. ping_agent with auth ────────────────────────────────────────────────
const t3 = await call("tools/call", { name: "ping_agent", arguments: {} }, true);
const t3text = t3.json.result?.content?.[0]?.text || "";
const t3ok = t3.status === 200 && t3text.includes("auth_user") && t3text.includes("auth_email");
record("3-ping-agent-auth", t3ok, `auth_user=${t3text.includes("auth_user")}`);
log(3, t3ok, `auth_user present: ${t3text.includes("auth_user")}`);

// ─── 4. run_agent with max_steps=1 (recursion limit fix) ───────────────────
const t4 = await call("tools/call", {
  name: "run_agent",
  arguments: { prompt: "Say hello and nothing else. Exactly one word: hello", max_steps: 1 },
}, true);
const t4text = t4.json.result?.content?.[0]?.text || "";
const t4ok = t4.status === 200 && !t4.json.isError && t4text.toLowerCase().includes("hello") && !t4text.includes("recursion");
record("4-run-agent-fixed", t4ok, `output="${t4text.slice(0, 60)}"`);
log(4, t4ok, `No recursion error! output="${t4text.slice(0, 60)}"`);

// ─── 5. verify_session with auth ────────────────────────────────────────────
const t5 = await call("tools/call", { name: "verify_session", arguments: {} }, true);
const t5ok = t5.status === 200 && !t5.json.isError;
record("5-verify-session-auth", t5ok, `ok=${t5ok}`);
log(5, t5ok, `verify_session: ${t5.json.result?.content?.[0]?.text?.split("\n")[0] || "OK"}`);

// ─── 6. run_agent full (verify end-to-end) ──────────────────────────────────
const t6 = await call("tools/call", {
  name: "run_agent",
  arguments: { prompt: "Say hello and nothing else. Exactly one word: hello" },
}, true);
const t6text = t6.json.result?.content?.[0]?.text || "";
const t6ok = t6.status === 200 && !t6.json.isError && t6text.toLowerCase().includes("hello");
record("6-run-agent-full", t6ok, `output="${t6text.slice(0, 60)}"`);
log(6, t6ok, `output="${t6text.slice(0, 60)}"`);

// ─── 7. OAuth metadata endpoint (should return 200, no hang) ──────────────
const t7 = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
const t7ok = t7.status === 200;
record("7-oauth-metadata", t7ok, `status=${t7.status}`);
log(7, t7ok, `Metadata endpoint: ${t7.status}`);

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n📊 Results: ${pass}/${pass+fail} passed, ${fail} failed\n`);

// Save proof
const proof = {
  patch: "04",
  title: "OAuth Authentication + LangGraph Recursion Limit Fix",
  timestamp: new Date().toISOString(),
  framework: "mcp-use v1.28.0",
  oauthProvider: "oauthProxy (HS256 JWT, proxy mode)",
  oauthConfig: {
    type: "proxy (local metadata)",
    issuer: ISSUER,
    endpoints: ["/.well-known/*", "/mcp/* (Bearer auth)"],
  },
  fixes: [
    "agent.ts: maxSteps = Math.max(options.maxSteps ?? config.agentMaxSteps, 3) → recursionLimit >= 9",
    "agent.ts: generator protocol instead of for-await + run() to capture stream return value",
    "agent.ts: removed streaming:true (ChatMessageChunk with type 'generic' isn't detected as AIMessage)",
    "server.ts: oauthProxy instead of oauthCustomProvider (no metadata self-fetch loop)",
    "config.ts: added MCP_OAUTH_SECRET / MCP_OAUTH_ISSUER env vars",
  ],
  tests: results,
  summary: { total: pass+fail, passed: pass, failed: fail, allPassed: fail === 0 },
};

import { writeFileSync } from "node:fs";
writeFileSync("/home/sahon/mcp/test/work/patches/patch-04-result.json", JSON.stringify(proof, null, 2));
console.log("📝 Proof → test/work/patches/patch-04-result.json");
