import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadDotenv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, ".env"),
    path.resolve(here, "..", ".env"),
    path.resolve(process.cwd(), ".env"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
  }

  dotenv.config();
}

loadDotenv();

function required(name: string): string {
  const v = process.env[name];
  if (v && v.trim().length > 0) return v.trim();
  throw new Error(`Environment variable ${name} is required but not set.`);
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : fallback;
}

function normaliseBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export const config = {
  // OpenAI-compatible endpoint — normalised to end with /v1
  openaiBaseUrl: normaliseBaseUrl(optional("OPENAI_BASE_URL", "https://api.openai.com")),

  // API key — proxy-no-auth is accepted when the proxy ignores the header
  openaiApiKey: optional("OPENAI_API_KEY", "proxy-no-auth"),

  // "auto" tells the proxy to pick the best model for the request
  agentModel: optional("AGENT_MODEL", "auto"),

  agentMaxSteps: parseInt(optional("AGENT_MAX_STEPS", "10"), 10),
  agentTemperature: parseFloat(optional("AGENT_TEMPERATURE", "0")),

  serverPort: parseInt(optional("MCP_SERVER_PORT", "3000"), 10),
  serverHost: optional("MCP_SERVER_HOST", "localhost"),

  // OAuth authentication (optional — leave empty to disable)
  mcpOauthSecret: optional("MCP_OAUTH_SECRET", ""),
  mcpOauthIssuer: optional("MCP_OAUTH_ISSUER", ""),

  // Public URL when behind Cloudflare tunnel / reverse proxy
  // Leave empty to derive from serverHost:serverPort (dev mode)
  mcpPublicUrl: optional("MCP_PUBLIC_URL", ""),
};
