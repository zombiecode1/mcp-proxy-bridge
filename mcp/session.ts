import { ChatOpenAI } from "@langchain/openai";
import { config } from "./config.js";

export interface SessionCheckResult {
  ok: boolean;
  model: string;
  baseUrl: string;
  error?: string;
}

/**
 * Sends a minimal one-token request to the configured endpoint.
 * This validates that the base URL is reachable, the API key (or lack of one)
 * is accepted, and the model string is recognised by the server.
 */
export async function verifySession(
  overrideModel?: string,
  overrideBaseUrl?: string,
  overrideApiKey?: string
): Promise<SessionCheckResult> {
  const baseUrl = overrideBaseUrl ?? config.openaiBaseUrl;
  const apiKey = overrideApiKey ?? config.openaiApiKey;
  const model = overrideModel ?? config.agentModel;

  try {
    const llm = new ChatOpenAI({
      model,
      apiKey,
      temperature: 0,
      maxTokens: 1,
      configuration: { baseURL: baseUrl },
    });

    await llm.invoke("ping");

    return { ok: true, model, baseUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, model, baseUrl, error: message };
  }
}
