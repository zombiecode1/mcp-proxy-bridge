import "./config.js"; // loads dotenv first
import { MCPServer, text, error } from "mcp-use/server";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { runAgent } from "./agent.js";
import { verifySession } from "./session.js";
import { SYSTEM_PROMPT } from "./utils/system-prompt.js";

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new MCPServer({
  name: "mcp-agent-server",
  title: "OpenAI-Compatible Agent Server",
  version: "1.0.0",
  description:
    "MCP server that exposes an AI agent powered by any OpenAI-compatible endpoint " +
    "(OpenAI, Groq Bridge Proxy, LM Studio, Ollama, etc.).",
});

const runtimeDir = path.resolve(process.cwd(), ".zombiecoder");
const runtimeManifestPath = path.join(runtimeDir, "runtime.json");

async function writeRuntimeManifest(): Promise<void> {
  const manifest = {
    workspaceRoot: process.cwd(),
    server: {
      host: config.serverHost,
      port: config.serverPort,
      mcpUrl: `http://${config.serverHost}:${config.serverPort}/mcp`,
      inspectorUrl: `http://${config.serverHost}:${config.serverPort}/inspector`,
    },
    bridge: {
      baseUrl: config.openaiBaseUrl,
      model: config.agentModel,
    },
    tools: ["verify_session", "run_agent", "ping_agent"],
    editorIntegrations: {
      vscode: ".vscode/mcp.json",
      zed: ".zed/settings.json",
      windsurf: "~/.codeium/windsurf/mcp_config.json",
    },
    updatedAt: new Date().toISOString(),
  };

  await mkdir(runtimeDir, { recursive: true });
  await writeFile(runtimeManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

// ─── Zod sub-schemas ─────────────────────────────────────────────────────────

const McpServerDefSchema = z.object({
  command: z.string().describe("Executable to launch the MCP server"),
  args: z.array(z.string()).describe("Arguments passed to the executable"),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Optional extra environment variables for the server process"),
});

// ─── Tool: verify_session ─────────────────────────────────────────────────────

server.tool(
  {
    name: "verify_session",
    description:
      "Verify that the configured OpenAI-compatible endpoint, API key, and model are " +
      "reachable. Returns a status object. Call this before run_agent if you want to " +
      "confirm authentication without running a full agent task.",
    schema: z.object({
      model: z
        .string()
        .optional()
        .describe("Override AGENT_MODEL for this check"),
      base_url: z
        .string()
        .optional()
        .describe("Override OPENAI_BASE_URL for this check"),
      api_key: z
        .string()
        .optional()
        .describe("Override OPENAI_API_KEY for this check"),
    }),
  },
  async ({ model, base_url, api_key }, ctx) => {
    await ctx.log("info", "verify_session: probing endpoint...");

    const result = await verifySession(model, base_url, api_key);

    if (!result.ok) {
      await ctx.log("error", `verify_session: FAILED — ${result.error}`);
      return error(
        `Session verification failed.\n` +
          `base_url : ${result.baseUrl}\n` +
          `model    : ${result.model}\n` +
          `reason   : ${result.error}`
      );
    }

    await ctx.log("info", `verify_session: OK — ${result.baseUrl} / ${result.model}`);

    return text(
      `Session OK\nbase_url : ${result.baseUrl}\nmodel    : ${result.model}`
    );
  }
);

// ─── Tool: run_agent ──────────────────────────────────────────────────────────

server.tool(
  {
    name: "run_agent",
    description:
      "Execute an AI agent against a prompt. The agent discovers available MCP tools, " +
      "reasons step-by-step, and returns a final answer. Progress is streamed as log " +
      "messages during execution so editors show real-time feedback.",
    schema: z.object({
      prompt: z.string().describe("The task or question for the agent to solve"),

      servers: z
        .record(z.string(), McpServerDefSchema)
        .optional()
        .describe(
          "MCP servers the agent may call during its run. " +
            'Example: { "playwright": { "command": "npx", "args": ["@playwright/mcp@latest"] } }'
        ),

      model: z
        .string()
        .optional()
        .describe(
          "Model name as the proxy reports it. Defaults to AGENT_MODEL env var or 'auto'."
        ),

      base_url: z
        .string()
        .optional()
        .describe(
          "Override the base URL of the OpenAI-compatible endpoint for this call."
        ),

      api_key: z
        .string()
        .optional()
        .describe("Override the API key for this call."),

      temperature: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe("Sampling temperature. Defaults to AGENT_TEMPERATURE env var or 0."),

      max_steps: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Maximum reasoning iterations. Defaults to AGENT_MAX_STEPS env var or 10."
        ),

      system_prompt: z
        .string()
        .optional()
        .describe("Custom system prompt to prepend to the agent's instructions."),
    }),
  },
  async (
    { prompt, servers, model, base_url, api_key, temperature, max_steps, system_prompt },
    ctx
  ) => {
    await ctx.log("info", `run_agent: starting — model=${model ?? config.agentModel}`);

    const result = await runAgent({
      prompt,
      servers,
      model,
      baseUrl: base_url,
      apiKey: api_key,
      temperature,
      maxSteps: max_steps,
      systemPrompt: system_prompt ?? SYSTEM_PROMPT,
      onStep: async (tool, input) => {
        await ctx.log("info", `tool_call: ${tool} — ${JSON.stringify(input)}`);
      },
    });

    if (!result.success) {
      await ctx.log("error", `run_agent: failed — ${result.error}`);
      return error(`Agent execution failed: ${result.error}`);
    }

    await ctx.log("info", "run_agent: complete");
    return text(result.output);
  }
);

// ─── Tool: ping_agent ─────────────────────────────────────────────────────────

server.tool(
  {
    name: "ping_agent",
    description:
      "Health check. Returns the active endpoint URL, model, and whether the API key " +
      "variable is set. Does not make a network request — use verify_session for that.",
    schema: z.object({}),
  },
  async (_params, ctx) => {
    await ctx.log("info", "ping_agent called");

    const keyPresent =
      process.env.OPENAI_API_KEY !== undefined &&
      process.env.OPENAI_API_KEY.trim().length > 0;

    return text(
      [
        `status       : OK`,
        `base_url     : ${config.openaiBaseUrl}`,
        `model        : ${config.agentModel}`,
        `max_steps    : ${config.agentMaxSteps}`,
        `temperature  : ${config.agentTemperature}`,
        `api_key_set  : ${keyPresent}`,
      ].join("\n")
    );
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function bootstrap() {
  await writeRuntimeManifest();

  server.listen(config.serverPort);

  console.log(
    `MCP Agent Server  →  http://${config.serverHost}:${config.serverPort}`
  );
  console.log(
    `Inspector         →  http://${config.serverHost}:${config.serverPort}/inspector`
  );
  console.log(`Endpoint          →  ${config.openaiBaseUrl}`);
  console.log(`Model             →  ${config.agentModel}`);
  console.log(`Runtime state     →  ${runtimeManifestPath}`);
}

bootstrap().catch((err) => {
  console.error("[SERVER] Failed to bootstrap:", err);
  process.exit(1);
});
