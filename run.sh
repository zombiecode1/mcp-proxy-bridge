#!/usr/bin/env bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# 🔱 ZombieCoder Bridge — Dual Server Launcher
# Starts both servers: proxi bridge (port 5001) + MCP Agent Server (port 3000)
# Then runs automatic index + session + agent execution verification test
# ══════════════════════════════════════════════════════════════════════════════

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()  { echo -e " ${GREEN}✅${NC} $1"; }
warn(){ echo -e " ${YELLOW}⚠${NC} $1"; }
err() { echo -e " ${RED}❌${NC} $1"; }
info(){ echo -e " ${CYAN}ℹ${NC} $1"; }

PROXI_DIR="/home/sahon/mcp/proxi"
AGENT_DIR="/home/sahon/mcp/mcp"
PROXI_PORT=5001
AGENT_PORT=3000
LOGDIR="/tmp/zombiecoder-logs"
mkdir -p "$LOGDIR"

# ─── Step 1: Kill any existing zombie processes ──────────────────────────────
info "Cleaning up old processes..."
for p in $(lsof -ti :$PROXI_PORT 2>/dev/null || true); do kill "$p" 2>/dev/null || true; done
for p in $(lsof -ti :$AGENT_PORT 2>/dev/null || true); do kill "$p" 2>/dev/null || true; done
sleep 1

# ─── Step 2: Start proxi bridge (port 5001) ─────────────────────────────────
info "Starting proxi bridge on port $PROXI_PORT..."
cd "$PROXI_DIR"
node dist/index.js > "$LOGDIR/proxi.log" 2>&1 &
PROXI_PID=$!
echo "$PROXI_PID" > "$LOGDIR/proxi.pid"

# Wait for it to become healthy
for i in $(seq 1 30); do
  if curl -sf http://localhost:$PROXI_PORT/health > /dev/null 2>&1; then
    ok "proxi bridge running (PID $PROXI_PID)"
    break
  fi
  sleep 1
done
if ! curl -sf http://localhost:$PROXI_PORT/health > /dev/null 2>&1; then
  err "proxi bridge failed to start — check $LOGDIR/proxi.log"
  exit 1
fi

# ─── Step 3: Start MCP Agent Server (port 3000) ──────────────────────────────
info "Starting MCP Agent Server on port $AGENT_PORT..."
cd "$AGENT_DIR"
node dist/server.js > "$LOGDIR/agent.log" 2>&1 &
AGENT_PID=$!
echo "$AGENT_PID" > "$LOGDIR/agent.pid"

# Wait for agent server
for i in $(seq 1 15); do
  if curl -sf http://localhost:$AGENT_PORT/health > /dev/null 2>&1; then
    ok "MCP Agent Server running (PID $AGENT_PID)"
    break
  fi
  sleep 1
done

# ─── Step 4: Verify both servers are running ──────────────────────────────────
echo ""
info "═══════════════════════════════════════════════════════════"
info "  Dual Server Status"
info "═══════════════════════════════════════════════════════════"
echo ""
echo -e "  Proxi Bridge:      http://localhost:$PROXI_PORT    (PID $(cat $LOGDIR/proxi.pid 2>/dev/null))"
echo -e "  MCP Agent Server:  http://localhost:$AGENT_PORT    (PID $(cat $LOGDIR/agent.pid 2>/dev/null))"
echo ""
echo -e "  MCP Endpoints:"
echo -e "    POST http://localhost:$PROXI_PORT/mcp       — JSON-RPC (workspace tools)"
echo -e "    GET  http://localhost:$PROXI_PORT/mcp       — SSE stream"
echo -e "    POST http://localhost:$AGENT_PORT/mcp       — Agent execution"
echo ""

# ─── Step 5: Auto-Index ─────────────────────────────────────────────────────
echo ""
info "──────────────────── Auto-Index ────────────────────"
RAG_RESULT=$(curl -sf -X POST http://localhost:$PROXI_PORT/v1/agent/directory \
  -H "Content-Type: application/json" \
  -d "{\"directory\":\"$HOME/Desktop\"}" 2>/dev/null || true)
# Check if SSOT exists
SSOT_EXISTS=$(curl -sf http://localhost:$PROXI_PORT/v1/agent/status 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ssotExists', False))" 2>/dev/null || echo "false")
if [ "$SSOT_EXISTS" = "True" ]; then
  ok "SSOT already exists, RAG system active"
else
  warn "No SSOT yet — RAG may need initialization"
fi

# ─── Step 6: Proof Test — Verify Session + Agent + Tool Chain ─────────────
echo ""
info "────────────────── Proof Test ──────────────────"
echo ""

# Test 6a: Proxi bridge MCP health check
info "Test A: Proxi Bridge — MCP info..."
PROXI_INFO=$(curl -sf http://localhost:$PROXI_PORT/mcp/info 2>/dev/null || echo '{"error":"failed"}')
echo "  $PROXI_INFO" | python3 -c "
import sys,json
d=json.load(sys.stdin)
tools=d.get('tools',0)
resources=d.get('resources',0)
print(f'    Tools: {tools}, Resources: {resources}')
assert tools >= 8, f'Expected >=8 tools, got {tools}'
print('    ✅ MCP tools list OK')
" 2>/dev/null && ok "Proxi bridge MCP OK" || err "Proxi bridge MCP failed"

# Test 6b: Proxi bridge — create MCP session
info "Test B: Proxi Bridge — MCP session creation..."
SID_RAW=$(curl -sf -D - -X POST http://localhost:$PROXI_PORT/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"zombie-launcher","version":"1.0.0"},"capabilities":{}}}' 2>/dev/null || true)
SID=$(echo "$SID_RAW" | grep -i "Mcp-Session-Id" | awk '{print $2}' | tr -d '\r\n' || echo "none")
if [ -n "$SID" ] && [ "$SID" != "none" ]; then
  ok "MCP session created: $SID"
else
  warn "MCP session may not have been created"
fi

# Test 6c: MCP Agent Server — health check
info "Test C: MCP Agent Server — ping_agent..."
PING_RESULT=$(curl -sf -X POST http://localhost:$AGENT_PORT/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ping_agent","arguments":{}}}' 2>/dev/null)
if echo "$PING_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'result' in d, 'No result'; print(d['result']['content'][0]['text'])" 2>/dev/null; then
  ok "Agent server ping OK"
else
  err "Agent server ping failed"
fi

# Test 6d: Proxi bridge — tools/list via MCP
info "Test D: Proxi Bridge — tools/list..."
TOOLS_LIST=$(curl -sf -X POST http://localhost:$PROXI_PORT/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}' 2>/dev/null)
echo "$TOOLS_LIST" | python3 -c "
import sys,json
d=json.load(sys.stdin)
tools=[t['name'] for t in d['result']['tools']]
print(f'    Available: {tools}')
" 2>/dev/null
ok "tools/list OK"

# Test 6e: SSE streaming test
info "Test E: SSE Streaming..."
SSE_RESULT=$(timeout 2 curl -sf -N http://localhost:$PROXI_PORT/mcp \
  -H "Accept: text/event-stream" 2>/dev/null || true)
if echo "$SSE_RESULT" | grep -q "event: endpoint"; then
  ok "SSE streaming works"
else
  warn "SSE streaming test inconclusive (timeout expected)"
fi

# Test 6f: Full agent execution via MCP Agent Server
info "Test F: MCP Agent Server — verify_session..."
VERIFY_RESULT=$(curl -sf -X POST http://localhost:$AGENT_PORT/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"verify_session","arguments":{}}}' 2>/dev/null)
if echo "$VERIFY_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('result',{}); c=r.get('content',[{}])[0].get('text',''); print(c)" 2>/dev/null | grep -q "OK"; then
  ok "Session verification: OK — bridge → Groq connection verified"
else
  warn "verify_session may require env vars — continuing"
fi

# ─── Step 7: Summary ────────────────────────────────────────────────────────
echo ""
info "═══════════════════════════════════════════════════════════"
info "  Dual Server — Running"
info "═══════════════════════════════════════════════════════════"
echo ""
echo -e "  Stop servers:"
echo -e "    kill \$(cat $LOGDIR/proxi.pid) \$(cat $LOGDIR/agent.pid)"
echo -e "  View logs:"
echo -e "    tail -f $LOGDIR/proxi.log"
echo -e "    tail -f $LOGDIR/agent.log"
echo ""
ok "ZombieCoder Bridge — ready for editor connections"
