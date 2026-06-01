import "./config.js";
import { MCPClient } from "mcp-use";

async function main() {
  const client = new MCPClient({
    mcpServers: {
      "agent-server": {
        command: "node",
        args: [`${process.cwd()}/dist/server.js`],
      },
    },
  });

  await client.createAllSessions();
  const session = client.getSession("agent-server");

  // List available tools
  const tools = await session.listTools();
  console.log("Available tools:");
  for (const t of tools) {
    console.log(`  ${t.name}: ${t.description?.split(".")[0]}`);
  }

  // 1. Quick health check — no network call to proxy
  console.log("\n─── ping_agent ───────────────────────────────");
  const ping = await session.callTool("ping_agent", {});
  console.log(ping);

  // 2. Verify session — makes a real request to the proxy
  console.log("\n─── verify_session ────────────────────────────");
  const verify = await session.callTool("verify_session", {});
  console.log(verify);

  // 3. Run the agent with a simple task
  console.log("\n─── run_agent ─────────────────────────────────");
  const result = await session.callTool("run_agent", {
    prompt: "What is 17 multiplied by 23? Show your reasoning step by step.",
  });
  console.log(result);

  await client.closeAllSessions();
}

main().catch(console.error);
