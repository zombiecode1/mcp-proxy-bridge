import "./config.js";
import { MCPServer, text, error, oauthProxy, FileSystemSessionStore } from "mcp-use/server";
import { z } from "zod";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { config } from "./config.js";
import { runAgent } from "./agent.js";
import { verifySession } from "./session.js";
import { SYSTEM_PROMPT } from "./utils/system-prompt.js";

// ─── Runtime paths ────────────────────────────────────────────────────────────

const runtimeDir = path.resolve(process.cwd(), ".zombiecoder");
const sessionsDir = path.join(runtimeDir, "sessions");

// ─── CORS middleware ──────────────────────────────────────────────────────────

function corsMiddleware() {
  return async (c: any, next: any) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, DELETE, HEAD, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-Requested-With, Mcp-Session-Id");
    c.header("Access-Control-Expose-Headers", "*");
    c.header("Access-Control-Max-Age", "86400");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  };
}

// ─── SSE Bearer auth middleware ───────────────────────────────────────────────

let _secretKey: Uint8Array | null = null;

function sseAuthMiddleware() {
  return async (c: any, next: any) => {
    if (c.req.method === "HEAD" || c.req.method === "POST") return next();

    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      c.header("WWW-Authenticate", 'Bearer error="unauthorized"');
      return c.json({ error: "Missing Authorization header" }, 401);
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1]) {
      c.header("WWW-Authenticate", 'Bearer error="invalid_request"');
      return c.json({ error: "Invalid Authorization header format" }, 401);
    }

    try {
      if (!_secretKey) {
        c.header("WWW-Authenticate", 'Bearer error="server_error"');
        return c.json({ error: "Server not configured for authentication" }, 500);
      }
      const { payload } = await jwtVerify(parts[1], _secretKey, {
        issuer: "mcp-agent-server",
      });
      const user = {
        userId: (payload.sub as string) || "anonymous",
        email: (payload.email as string) || undefined,
        name: (payload.name as string) || undefined,
      };
      c.set("auth", { user, payload, accessToken: parts[1], scopes: [], permissions: [] });
      c.set("user", user);
      c.set("payload", payload);
      c.set("accessToken", parts[1]);
      await next();
    } catch (e) {
      c.header("WWW-Authenticate", 'Bearer error="invalid_token"');
      return c.json({ error: `Invalid token: ${(e as Error).message}` }, 401);
    }
  };
}

// ─── OAuth 2.1 (optional) ─────────────────────────────────────────────────────

let oauthConfig = undefined;
if (config.mcpOauthSecret) {
  _secretKey = new TextEncoder().encode(config.mcpOauthSecret);
  const publicUrl = config.mcpPublicUrl || `http://${config.serverHost}:${config.serverPort}`;

  oauthConfig = oauthProxy({
    issuer: "mcp-agent-server",
    authEndpoint: `${publicUrl}/authorize`,
    tokenEndpoint: `${publicUrl}/token`,
    clientId: "mcp-agent-server",
    clientSecret: config.mcpOauthSecret,
    scopes: ["openid", "profile", "tools:*"],

    async verifyToken(token: string) {
      if (!_secretKey) throw new Error("Secret key not initialized");
      const { payload } = await jwtVerify(token, _secretKey, {
        issuer: "mcp-agent-server",
      });
      return { payload: payload as Record<string, unknown> };
    },

    getUserInfo(payload) {
      return {
        userId: (payload.sub as string) || "anonymous",
        email: (payload.email as string) || undefined,
        name: (payload.name as string) || undefined,
      };
    },
  });
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new MCPServer({
  name: "mcp-agent-server",
  title: "OpenAI-Compatible Agent Server",
  version: "1.0.0",
  description:
    "MCP server that exposes an AI agent powered by any OpenAI-compatible endpoint " +
    "(OpenAI, Groq Bridge Proxy, LM Studio, Ollama, etc.).",
  sessionStore: new FileSystemSessionStore({
    path: ".mcp-use/sessions.json",
  }),
  ...(oauthConfig ? { oauth: oauthConfig } : {}),
});

// ─── SSE + CORS middleware (only when OAuth is enabled) ───────────────────────
// Registered BEFORE listen() so they apply before internal route mounting.

if (oauthConfig) {
  server.use("/mcp/*", corsMiddleware());
  server.use("/sse/*", corsMiddleware());
  server.use("/sse/*", sseAuthMiddleware());

  server.post("/auth/token", async (c: any) => {
    let body: Record<string, string> = {};
    const ct = (c.req.header("Content-Type") || "").toLowerCase();

    if (ct.includes("json")) {
      try { body = await c.req.json(); } catch { /* fall through */ }
    } else {
      const text = await c.req.text().catch(() => "");
      if (text) {
        for (const [k, v] of new URLSearchParams(text)) {
          body[k] = v;
        }
      }
    }

    if (body.grant_type !== "client_credentials") {
      return c.json({ error: "unsupported_grant_type", error_description: "Only client_credentials is supported" }, 400);
    }

    if (!body.client_secret) {
      return c.json({ error: "invalid_client", error_description: "Client secret required" }, 401);
    }
    const a = Buffer.from(body.client_secret);
    const b = Buffer.from(config.mcpOauthSecret || "");
    const match = a.length === b.length && timingSafeEqual(a, b);
    if (!match) {
      return c.json({ error: "invalid_client", error_description: "Invalid client credentials" }, 401);
    }

    try {
      const token = await new SignJWT({
        sub: body.client_id || "mcp-agent-server",
        email: `${body.client_id || "cli-user"}@mcp.local`,
        name: "CLI Client",
        scope: body.scope || "openid profile tools:*",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("mcp-agent-server")
        .setExpirationTime("1h")
        .sign(_secretKey!); // safe: only reached when _secretKey is initialized

      return c.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 3600,
        scope: body.scope || "openid profile tools:*",
      });
    } catch (e) {
      return c.json({ error: "server_error", error_description: "Failed to generate token" }, 500);
    }
  });
}

const runtimeManifestPath = path.join(runtimeDir, "runtime.json");

async function writeRuntimeManifest(): Promise<void> {
  const publicUrl = config.mcpPublicUrl || `http://${config.serverHost}:${config.serverPort}`;
  const manifest: Record<string, unknown> = {
    workspaceRoot: process.cwd(),
    server: {
      host: config.serverHost,
      port: config.serverPort,
      mcpUrl: `${publicUrl}/mcp`,
      inspectorUrl: `${publicUrl}/inspector`,
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

  if (oauthConfig) {
    manifest.auth = {
      tokenUrl: `${publicUrl}/auth/token`,
      type: "client_credentials",
      issuer: "mcp-agent-server",
    };
  }

  await mkdir(runtimeDir, { recursive: true });
  await writeFile(runtimeManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

// ─── Conversation persistence helpers ────────────────────────────────────────

interface ConversationEntry {
  role: string;
  content: string;
  timestamp: string;
}

const conversationLocks = new Set<string>();

async function acquireConversationLock(id: string, timeout = 5000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (conversationLocks.has(id)) {
    if (Date.now() > deadline) return false;
    await new Promise(r => setTimeout(r, 50));
  }
  conversationLocks.add(id);
  return true;
}

function releaseConversationLock(id: string): void {
  conversationLocks.delete(id);
}

async function loadConversation(id: string): Promise<ConversationEntry[]> {
  try {
    const data = await readFile(path.join(sessionsDir, `${id}.json`), "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveConversation(id: string, entries: ConversationEntry[]): Promise<void> {
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(path.join(sessionsDir, `${id}.json`), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
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
      model: z.string().optional().describe("Override AGENT_MODEL for this check"),
      base_url: z.string().optional().describe("Override OPENAI_BASE_URL for this check"),
      api_key: z.string().optional().describe("Override OPENAI_API_KEY for this check"),
    }),
  },
  async ({ model, base_url, api_key }, ctx) => {
    await ctx.log("info", "verify_session: probing endpoint...");
    const result = await verifySession(model, base_url, api_key);
    if (!result.ok) {
      await ctx.log("error", `verify_session: FAILED — ${result.error}`);
      return error(`Session verification failed.\nbase_url : ${result.baseUrl}\nmodel    : ${result.model}\nreason   : ${result.error}`);
    }
    await ctx.log("info", `verify_session: OK — ${result.baseUrl} / ${result.model}`);
    return text(`Session OK\nbase_url : ${result.baseUrl}\nmodel    : ${result.model}`);
  }
);

// ─── Tool: run_agent ──────────────────────────────────────────────────────────

server.tool(
  {
    name: "run_agent",
    description:
      "Execute an AI agent against a prompt. The agent discovers available MCP tools, " +
      "reasons step-by-step, and returns a final answer. Supports persistent conversations " +
      "via conversation_id.",
    schema: z.object({
      prompt: z.string().describe("The task or question for the agent to solve"),

      conversation_id: z
        .string()
        .optional()
        .describe(
          "Persistent conversation ID. When provided, previous exchanges are prepended " +
            "so the agent remembers context across calls. A new ID creates a fresh conversation."
        ),

      servers: z
        .record(z.string(), McpServerDefSchema)
        .optional()
        .describe(
          "MCP servers the agent may call during its run. " +
            'Example: { "playwright": { "command": "npx", "args": ["@playwright/mcp@latest"] } }'
        ),

      model: z.string().optional().describe("Model name override."),
      base_url: z.string().optional().describe("Base URL override."),
      api_key: z.string().optional().describe("API key override."),

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
        .describe("Maximum reasoning iterations. Defaults to AGENT_MAX_STEPS env var or 10."),

      system_prompt: z
        .string()
        .optional()
        .describe("Custom system prompt to prepend to the agent's instructions."),
    }),
  },
  async (
    { prompt, conversation_id, servers, model, base_url, api_key, temperature, max_steps, system_prompt },
    ctx
  ) => {
    await ctx.log("info", `run_agent: starting — model=${model ?? config.agentModel}`);

    // ── Load previous conversation (if conversation_id provided) ──
    let enrichedPrompt = prompt;
    if (conversation_id) {
      const locked = await acquireConversationLock(conversation_id);
      if (!locked) {
        return error("Could not acquire conversation lock — try again");
      }
      try {
        const history = await loadConversation(conversation_id);
        if (history.length > 0) {
          enrichedPrompt =
            `[Previous conversation — ${history.length} exchanges]\n` +
            history.map((e) => `[${e.role}]: ${e.content}`).join("\n") +
            `\n\n[Continue — do NOT repeat the above. Answer the NEW prompt below.]\n\n${prompt}`;
          await ctx.log("info", `run_agent: loaded ${history.length} prior exchanges for ${conversation_id}`);
        }
      } finally {
        releaseConversationLock(conversation_id);
      }
    }

    // ── Execute ──
    const result = await runAgent({
      prompt: enrichedPrompt,
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

    // ── Persist conversation ──
    if (conversation_id) {
      const locked = await acquireConversationLock(conversation_id);
      if (!locked) {
        await ctx.log("warn", `run_agent: could not acquire lock for saving — ${conversation_id}`);
      } else {
        try {
          const history = await loadConversation(conversation_id);
          history.push({ role: "user", content: prompt, timestamp: new Date().toISOString() });
          history.push({
            role: "assistant",
            content: result.success ? result.output : `Error: ${result.error}`,
            timestamp: new Date().toISOString(),
          });
          await saveConversation(conversation_id, history);
          await ctx.log("info", `run_agent: saved ${history.length} total exchanges for ${conversation_id}`);
        } finally {
          releaseConversationLock(conversation_id);
        }
      }
    }

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

    const lines = [
      `status       : OK`,
      `base_url     : ${config.openaiBaseUrl}`,
      `model        : ${config.agentModel}`,
      `max_steps    : ${config.agentMaxSteps}`,
      `temperature  : ${config.agentTemperature}`,
      `api_key_set  : ${keyPresent}`,
    ];

    if (ctx.auth) {
      lines.push(
        `auth_user    : ${ctx.auth.user.userId}`,
        `auth_email   : ${ctx.auth.user.email ?? "—"}`,
        `auth_scopes  : ${ctx.auth.scopes.join(" ") || "—"}`
      );
    }

    return text(lines.join("\n"));
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function bootstrap() {
  await writeRuntimeManifest();

  await server.listen(config.serverPort);

  const publicUrl = config.mcpPublicUrl || `http://${config.serverHost}:${config.serverPort}`;

  console.log(`MCP Agent Server  →  ${publicUrl}`);
  console.log(`Inspector         →  ${publicUrl}/inspector`);
  console.log(`Endpoint          →  ${config.openaiBaseUrl}`);
  console.log(`Model             →  ${config.agentModel}`);
  console.log(`Session store     →  FileSystemSessionStore (persistent)`);
  console.log(`Runtime state     →  ${runtimeManifestPath}`);

  if (oauthConfig) {
    console.log(`Auth              →  OAuth 2.1 enabled (Bearer JWT)`);
    console.log(`  Token endpoint  →  ${publicUrl}/auth/token`);
    console.log(`  SSE protected   →  Bearer auth required on /sse`);
    console.log(`  CORS enabled    →  /mcp/* + /sse/* `);
  }
}

bootstrap().catch((err) => {
  console.error("[SERVER] Failed to bootstrap:", err);
  process.exit(1);
});
