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
  const maxSteps    = Math.max(options.maxSteps ?? config.agentMaxSteps, 3);
  const servers     = options.servers     ?? {};
  const systemPrompt = options.systemPrompt ?? SYSTEM_PROMPT;

  const llm = new ChatOpenAI({
    model,
    apiKey,
    temperature,
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
      // Use generator protocol so we can capture the return value (final output)
      const gen = agent.stream(options.prompt);
      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          finalOutput = (value as string) || "";
          break;
        }
        options.onStep((value as any).action.tool, (value as any).action.toolInput);
      }
    } else {
      finalOutput = await agent.run({ prompt: options.prompt });
    }

    return { output: finalOutput, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: "", success: false, error: message };
  } finally {
    await client.closeAllSessions();
  }
}
