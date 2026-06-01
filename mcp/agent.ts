import { MCPAgent, MCPClient } from "mcp-use";
import { ChatOpenAI } from "@langchain/openai";
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./utils/system-prompt.js";

export interface McpServerDef {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AgentRunOptions {
  prompt: string;
  servers?: Record<string, McpServerDef>;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  maxSteps?: number;
  systemPrompt?: string;
  onStep?: (tool: string, input: unknown) => void;
}

export interface AgentRunResult {
  output: string;
  success: boolean;
  error?: string;
}

export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const model       = options.model       ?? config.agentModel;
  const baseUrl     = options.baseUrl     ?? config.openaiBaseUrl;
  const apiKey      = options.apiKey      ?? config.openaiApiKey;
  const temperature = options.temperature ?? config.agentTemperature;
  const maxSteps    = options.maxSteps    ?? config.agentMaxSteps;
  const servers     = options.servers     ?? {};
  const systemPrompt = options.systemPrompt ?? SYSTEM_PROMPT;

  const llm = new ChatOpenAI({
    model,
    apiKey,
    temperature,
    // streaming: true enables token-level events from streamEvents()
    streaming: true,
    configuration: { baseURL: baseUrl },
  });

  const client = new MCPClient({ mcpServers: servers });

  try {
    await client.createAllSessions();

    const agent = new MCPAgent({
      llm,
      client,
      maxSteps,
      // autoInitialize: true lets the agent bootstrap tool discovery on first run
      autoInitialize: true,
      memoryEnabled: false,
      systemPrompt,
    });

    let finalOutput = "";

    if (options.onStep) {
      // Step streaming: each yielded step carries tool name + input
      for await (const step of agent.stream(options.prompt)) {
        options.onStep(step.action.tool, step.action.toolInput);
      }
      // After streaming, run() to get the final text output
      finalOutput = await agent.run({ prompt: options.prompt });
    } else {
      // Low-level event streaming: collect on_chat_model_stream chunks
      const chunks: string[] = [];
      for await (const event of agent.streamEvents(options.prompt)) {
        if (event.event === "on_chat_model_stream") {
          const chunk = event.data?.chunk?.text ?? event.data?.chunk?.content ?? "";
          if (chunk) chunks.push(chunk);
        }
      }
      finalOutput = chunks.join("") || await agent.run({ prompt: options.prompt });
    }

    return { output: finalOutput, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: "", success: false, error: message };
  } finally {
    await client.closeAllSessions();
  }
}
