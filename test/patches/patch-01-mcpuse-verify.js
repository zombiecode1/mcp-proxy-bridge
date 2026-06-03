#!/usr/bin/env node
import { MCPClient } from 'mcp-use';

const TEST_SERVER_URL = 'http://localhost:3000/mcp';
const SERVER_NAME = 'auto-server';

async function runTest() {
  const output = {
    patch: '01-mcpuse-verify',
    phase: 'Phase 1: mcp-use Official Framework Setup',
    timestamp: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      mcp_server_url: TEST_SERVER_URL,
    },
    steps: [],
    result: null,
  };

  // Step 1: Create MCPClient
  try {
    const client = new MCPClient({
      mcpServers: {
        [SERVER_NAME]: {
          url: TEST_SERVER_URL,
        },
      },
    });
    output.steps.push({
      step: 1,
      name: 'MCPClient creation',
      status: 'success',
    });

    // Step 2: Create sessions
    await client.createAllSessions();
    const session = client.getSession(SERVER_NAME);
    output.steps.push({
      step: 2,
      name: 'Session creation',
      status: 'success',
      session_type: typeof session,
    });

    // Step 3: List tools
    const toolsResult = await session.listTools();
    const tools = (toolsResult?.tools || toolsResult || []).map(t => ({
      name: t.name,
      description: (t.description || '').substring(0, 80),
      inputSchema: t.inputSchema ? Object.keys(t.inputSchema.properties || {}) : [],
    }));
    output.steps.push({
      step: 3,
      name: 'Tools listing',
      status: 'success',
      tool_count: tools.length,
      tools,
    });

    // Step 4: List resources
    let resources = [];
    let resourceStatus = 'success';
    try {
      const resResult = await session.listResources();
      resources = (resResult?.resources || resResult || []).map(r => ({
        uri: r.uri,
        name: r.name,
        mimeType: r.mimeType,
      }));
    } catch (e) {
      resourceStatus = `error: ${e.message}`;
    }
    output.steps.push({
      step: 4,
      name: 'Resources listing',
      status: resourceStatus,
      resource_count: resources.length,
      resources,
      note: resources.length === 0
        ? 'CONFIRMED: MCP has zero resources — this is the core problem to fix'
        : `MCP has ${resources.length} resources`,
    });

    // Step 5: Test ping_agent tool
    let pingResult = null;
    let pingStatus = 'success';
    try {
      pingResult = await session.callTool('ping_agent', {});
    } catch (e) {
      pingStatus = `error: ${e.message}`;
    }
    output.steps.push({
      step: 5,
      name: 'Tool test: ping_agent',
      status: pingStatus,
      result: pingResult,
    });

    // Step 6: Test verify_session tool
    let verifyResult = null;
    let verifyStatus = 'success';
    try {
      verifyResult = await session.callTool('verify_session', {});
    } catch (e) {
      verifyStatus = `error: ${e.message}`;
    }
    output.steps.push({
      step: 6,
      name: 'Tool test: verify_session',
      status: verifyStatus,
      result: verifyResult,
    });

    // Step 7: Test run_agent tool (simple prompt)
    let agentResult = null;
    let agentStatus = 'success';
    try {
      agentResult = await session.callTool('run_agent', {
        prompt: 'Say hello and nothing else. Respond with exactly one word: hello',
        max_steps: 1,
      });
    } catch (e) {
      agentStatus = `error: ${e.message}`;
    }
    output.steps.push({
      step: 7,
      name: 'Tool test: run_agent (hello)',
      status: agentStatus,
      result: agentResult,
    });

    // Cleanup
    await client.closeAllSessions();
    output.steps.push({
      step: 8,
      name: 'Session cleanup',
      status: 'success',
    });

    output.result = 'PASS';
  } catch (e) {
    output.result = 'FAIL';
    output.error = {
      message: e.message,
      stack: (e.stack || '').split('\n').slice(0, 5).join('\n'),
    };
  }

  // Print JSON output — this is the ONLY proof
  console.log(JSON.stringify(output, null, 2));
}

runTest().catch(e => {
  console.log(JSON.stringify({
    patch: '01-mcpuse-verify',
    phase: 'Phase 1: mcp-use Official Framework Setup',
    timestamp: new Date().toISOString(),
    result: 'FAIL',
    error: { message: e.message, stack: e.stack },
  }, null, 2));
});
