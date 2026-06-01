import Groq from 'groq-sdk';
import { ChatCompletionCreateParams, ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';
import { LogEntry, ModelMeta, RateLimitState, ServerStatus } from '../types';
import { writeLog, cleanupOldLogs } from './fileLogger';

const MODEL_META: Record<string, { context_window: number; max_tokens: number; category: ModelMeta['category'] }> = {
  // Production models — context_window values from Groq official docs (https://console.groq.com/docs/models)
  // All production models have 131,072 context window as of 2026-05
  'openai/gpt-oss-20b': { context_window: 131072, max_tokens: 65536, category: 'balanced' },
  'openai/gpt-oss-120b': { context_window: 131072, max_tokens: 65536, category: 'balanced' },
  'openai/gpt-oss-safeguard-20b': { context_window: 131072, max_tokens: 65536, category: 'guard' },
  'groq/compound-mini': { context_window: 131072, max_tokens: 8192, category: 'fast' },
  'groq/compound': { context_window: 131072, max_tokens: 8192, category: 'balanced' },
  'qwen/qwen3-32b': { context_window: 131072, max_tokens: 40960, category: 'balanced' },
  'llama-3.1-8b-instant': { context_window: 131072, max_tokens: 131072, category: 'fast' },
  'llama-3.3-70b-versatile': { context_window: 131072, max_tokens: 32768, category: 'balanced' },
  'meta-llama/llama-4-scout-17b-16e-instruct': { context_window: 131072, max_tokens: 8192, category: 'balanced' },
  'meta-llama/llama-prompt-guard-2-86m': { context_window: 512, max_tokens: 512, category: 'guard' },
  'meta-llama/llama-prompt-guard-2-22m': { context_window: 512, max_tokens: 512, category: 'guard' },
  'allam-2-7b': { context_window: 8192, max_tokens: 8192, category: 'fast' },
  'whisper-large-v3': { context_window: 0, max_tokens: 0, category: 'audio' },
  'whisper-large-v3-turbo': { context_window: 0, max_tokens: 0, category: 'audio' },

  // Preview models
  'llama3-8b-8192': { context_window: 8192, max_tokens: 8192, category: 'fast' },
  'llama-3.2-1b-preview': { context_window: 8192, max_tokens: 8192, category: 'fast' },
  'llama-3.2-3b-preview': { context_window: 8192, max_tokens: 8192, category: 'fast' },
  'gemma-7b-it': { context_window: 8192, max_tokens: 8192, category: 'fast' },
  'gemma2-9b-it': { context_window: 8192, max_tokens: 8192, category: 'fast' },
  'llama3-70b-8192': { context_window: 8192, max_tokens: 8192, category: 'balanced' },
  'llama-3.1-70b-versatile': { context_window: 8192, max_tokens: 8192, category: 'balanced' },
  'mixtral-8x7b-32768': { context_window: 32768, max_tokens: 32768, category: 'balanced' },
  'llama-3.2-11b-vision-preview': { context_window: 8192, max_tokens: 8192, category: 'vision' },
  'llama-3.2-90b-vision-preview': { context_window: 8192, max_tokens: 8192, category: 'vision' },
  'llama-guard-3-8b': { context_window: 8192, max_tokens: 8192, category: 'guard' },
  'nomic-embed-text-v1_5': { context_window: 0, max_tokens: 0, category: 'embedding' },
};

const ACCOUNT_RATE_LIMITS: Record<string, { rpm: number; tpm: number }> = {
  // Developer plan rates from Groq official docs (https://console.groq.com/docs/rate-limits)
  // Override with GROQ_MODEL_LIMIT_OVERRIDES env var if your org differs
  'openai/gpt-oss-20b': { rpm: 30, tpm: 250000 },
  'openai/gpt-oss-120b': { rpm: 30, tpm: 250000 },
  'openai/gpt-oss-safeguard-20b': { rpm: 30, tpm: 150000 },
  'groq/compound-mini': { rpm: 200, tpm: 200000 },
  'groq/compound': { rpm: 200, tpm: 200000 },
  'qwen/qwen3-32b': { rpm: 60, tpm: 300000 },
  'llama-3.1-8b-instant': { rpm: 30, tpm: 250000 },
  'llama-3.3-70b-versatile': { rpm: 30, tpm: 300000 },
  'meta-llama/llama-4-scout-17b-16e-instruct': { rpm: 30, tpm: 300000 },
  'meta-llama/llama-prompt-guard-2-86m': { rpm: 100, tpm: 30000 },
  'meta-llama/llama-prompt-guard-2-22m': { rpm: 100, tpm: 30000 },
  'allam-2-7b': { rpm: 30, tpm: 6000 },
  'whisper-large-v3': { rpm: 300, tpm: 0 },
  'whisper-large-v3-turbo': { rpm: 400, tpm: 0 },

  'llama3-8b-8192': { rpm: 30, tpm: 30000 },
  'llama-3.2-1b-preview': { rpm: 30, tpm: 30000 },
  'llama-3.2-3b-preview': { rpm: 30, tpm: 30000 },
  'gemma-7b-it': { rpm: 30, tpm: 15000 },
  'gemma2-9b-it': { rpm: 30, tpm: 15000 },
  'llama3-70b-8192': { rpm: 30, tpm: 6000 },
  'llama-3.1-70b-versatile': { rpm: 30, tpm: 6000 },
  'mixtral-8x7b-32768': { rpm: 30, tpm: 5000 },
  'llama-3.2-11b-vision-preview': { rpm: 30, tpm: 7000 },
  'llama-3.2-90b-vision-preview': { rpm: 30, tpm: 7000 },
  'llama-guard-3-8b': { rpm: 30, tpm: 15000 },
  'nomic-embed-text-v1_5': { rpm: 30, tpm: 50000 },
  'default': { rpm: 30, tpm: 10000 },
};

const RATE_LIMIT_OVERRIDES = parseLimitOverrides(process.env.GROQ_MODEL_LIMIT_OVERRIDES);
const DEFAULT_CHAT_MAX_TOKENS = readPositiveInt(process.env.DEFAULT_CHAT_MAX_TOKENS, 512);

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLimitOverrides(value: string | undefined): Record<string, { rpm?: number; tpm?: number }> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, { rpm?: number; tpm?: number }>;
  } catch (err) {
    console.warn('Invalid GROQ_MODEL_LIMIT_OVERRIDES JSON; using built-in rate limits.');
    return {};
  }
}

export class GroqService {
  client: Groq;
  models: ModelMeta[] = [];
  logs: LogEntry[] = [];
  private rateCounters: Map<string, { count: number; tokens: number; resetAt: number }> = new Map();
  totalRequests = 0;
  startedAt = Date.now();
  private _autoSelect = true;

  constructor(apiKey: string) {
    this.client = new Groq({ apiKey });
  }

  get autoSelect(): boolean { return this._autoSelect; }
  set autoSelect(v: boolean) { this._autoSelect = v; }
  get startedAtMs(): number { return this.startedAt; }

  async initialize(): Promise<void> {
    try {
      const response = await this.client.models.list();
      this.models = response.data
        .filter(m => !m.id.startsWith('_'))
        .map(m => {
          const meta = MODEL_META[m.id.toLowerCase()] || {
            context_window: 8192,
            max_tokens: 8192,
            category: 'other' as ModelMeta['category'],
          };
          return {
            id: m.id,
            object: 'model' as const,
            created: m.created,
            owned_by: m.owned_by || 'groq',
            ...meta,
          };
        });
      console.log(`✅ Loaded ${this.models.length} models from Groq`);
    } catch (err) {
      console.error('❌ Failed to load models from Groq:', err);
      console.log('📋 Using built-in model list');
      this.models = Object.entries(MODEL_META).map(([id, meta]) => ({
        id,
        object: 'model' as const,
        created: Math.floor(Date.now() / 1000),
        owned_by: 'groq',
        ...meta,
      }));
    }
  }

  private categorisedModels(category: ModelMeta['category']): string[] {
    return this.models.filter(m => m.category === category).map(m => m.id);
  }

  selectBestModel(inputText: string): string {
    const len = inputText.length;
    let candidates: string[];

    if (len < 100) {
      candidates = this.categorisedModels('fast');
    } else if (len < 500) {
      candidates = this.categorisedModels('balanced');
    } else {
      const powerful = this.categorisedModels('balanced');
      const vision = this.categorisedModels('vision');
      candidates = [...powerful, ...vision];
    }

    return candidates[0] || 'llama-3.3-70b-versatile';
  }

  private extractInputText(messages: ChatCompletionMessageParam[]): string {
    return messages.map(m => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content.map(c => {
          if (c.type === 'text') return c.text;
          if (c.type === 'image_url') return '[image]';
          return '';
        }).join(' ');
      }
      return '';
    }).join('\n');
  }

  private getRateLimit(model: string): { rpm: number; tpm: number } {
    const base = ACCOUNT_RATE_LIMITS[model] || ACCOUNT_RATE_LIMITS['default'];
    const override = RATE_LIMIT_OVERRIDES[model];
    return {
      rpm: override?.rpm ?? base.rpm,
      tpm: override?.tpm ?? base.tpm,
    };
  }

  private async checkAndUpdateRateLimit(model: string, tokens: number = 0): Promise<void> {
    const now = Date.now();
    const key = model || 'default';
    let counter = this.rateCounters.get(key);

    if (!counter || now > counter.resetAt) {
      counter = { count: 0, tokens: 0, resetAt: now + 60000 };
      this.rateCounters.set(key, counter);
    }

    const limits = this.getRateLimit(model);

    if (counter.count >= limits.rpm) {
      const err: any = new Error(`Rate limit exceeded for ${model}: ${limits.rpm} RPM`);
      err.status = 429;
      err.type = 'rate_limit_error';
      err.code = 'rate_limit_exceeded';
      throw err;
    }

    if (limits.tpm > 0 && counter.tokens + tokens > limits.tpm) {
      const err: any = new Error(`Token rate limit exceeded for ${model}: ${limits.tpm} TPM`);
      err.status = 429;
      err.type = 'rate_limit_error';
      err.code = 'token_rate_limit_exceeded';
      throw err;
    }

    counter.count++;
    counter.tokens += tokens;
  }

  async createChatCompletion(
    params: ChatCompletionCreateParams
  ): Promise<any> {
    const effectiveParams = { ...params };

    // If the client doesn't specify a max output token budget, default conservatively.
    // This avoids "Requested ... TPM" failures on models with strict per-request token budgets.
    const maxCompletion = (effectiveParams as any).max_completion_tokens;
    if (effectiveParams.max_tokens == null && maxCompletion == null) {
      effectiveParams.max_tokens = DEFAULT_CHAT_MAX_TOKENS;
    }

    if (!effectiveParams.model || effectiveParams.model === 'auto') {
      if (this._autoSelect) {
        const inputText = this.extractInputText(effectiveParams.messages);
        effectiveParams.model = this.selectBestModel(inputText);
      } else {
        const balanced = this.categorisedModels('balanced');
        effectiveParams.model = balanced[0] || 'llama-3.3-70b-versatile';
      }
    }

    const inputTokens = this.estimateTokens(
      this.extractInputText(effectiveParams.messages)
    );
    const requestedOutputTokens = Number((effectiveParams as any).max_completion_tokens ?? effectiveParams.max_tokens ?? 0) || 0;
    const requestedTokens = inputTokens + requestedOutputTokens;

    // Pre-emptively route away from models with TPM limits too low for the request
    const currentLimits = this.getRateLimit(effectiveParams.model);
    if (currentLimits && currentLimits.tpm > 0 && requestedTokens > currentLimits.tpm) {
      // Find a model with higher TPM limit that can handle this request
      const betterModel = Object.entries(ACCOUNT_RATE_LIMITS)
        .filter(([id]) => {
          const cat = MODEL_META[id]?.category;
          const effectiveLimit = this.getRateLimit(id);
          return id !== 'default' &&
            effectiveLimit.tpm > currentLimits.tpm &&
            (cat === 'balanced' || cat === 'fast');
        })
        .sort(([aId], [bId]) => this.getRateLimit(bId).tpm - this.getRateLimit(aId).tpm)
        .find(([id]) => this.models.some(m => m.id === id));
      if (betterModel) {
        const betterLimit = this.getRateLimit(betterModel[0]);
        console.warn(`⚠️ Request (${requestedTokens}t) exceeds '${effectiveParams.model}' TPM limit (${currentLimits.tpm}). Routing to '${betterModel[0]}' (${betterLimit.tpm} TPM).`);
        effectiveParams.model = betterModel[0];
      }
    }

    await this.checkAndUpdateRateLimit(effectiveParams.model, requestedTokens);

    // Auto-route non-chat models (guard, audio, embedding) to a suitable chat model
    let resolvedModel = this.models.find(m => m.id === effectiveParams.model);
    const nonChatCategories = ['guard', 'audio', 'embedding'];
    if (resolvedModel && nonChatCategories.includes(resolvedModel.category)) {
      const fallback = this.selectBestModel(this.extractInputText(effectiveParams.messages));
      console.warn(`⚠️ Model '${effectiveParams.model}' (${resolvedModel.category}) is not a chat model. Routing to '${fallback}'`);
      effectiveParams.model = fallback;
      resolvedModel = this.models.find(m => m.id === fallback) || resolvedModel;
    }

    // Auto-admit context window overflow instead of throwing
    if (resolvedModel && resolvedModel.context_window > 0) {
      const maxOutput = (effectiveParams.max_tokens || resolvedModel.max_tokens) as number;
      if (inputTokens + maxOutput > resolvedModel.context_window) {
        // Try switching to any model with larger context window (TPM-aware preferred, but not required)
        const candidates = this.models
          .filter(m => m.id !== effectiveParams.model && m.context_window > 0 && m.max_tokens > 0)
          .sort((a, b) => {
            const aFitsInput = inputTokens <= a.context_window;
            const bFitsInput = inputTokens <= b.context_window;
            if (aFitsInput !== bFitsInput) return bFitsInput ? 1 : -1;
            // Among those that fit, prefer higher TPM availability
            const aTpmOk = this.getRateLimit(a.id).tpm === 0 || inputTokens + Math.min(maxOutput, a.max_tokens) <= this.getRateLimit(a.id).tpm;
            const bTpmOk = this.getRateLimit(b.id).tpm === 0 || inputTokens + Math.min(maxOutput, b.max_tokens) <= this.getRateLimit(b.id).tpm;
            if (aTpmOk !== bTpmOk) return aTpmOk ? -1 : 1;
            return b.context_window - a.context_window;
          });

        // Must have enough TPM to handle at least the input tokens
        const bestFit = candidates.find(m => {
          if (inputTokens > m.context_window) return false;
          const tpm = this.getRateLimit(m.id).tpm;
          return tpm === 0 || inputTokens <= tpm;
        });
        const anyLarger = candidates.find(m => m.context_window > resolvedModel!.context_window);

        if (bestFit) {
          console.warn(`⚠️ Context exceeded for '${effectiveParams.model}'. Switching to '${bestFit.id}' (context: ${bestFit.context_window}, TPM: ${this.getRateLimit(bestFit.id).tpm}).`);
          effectiveParams.model = bestFit.id;
          resolvedModel = bestFit;
        } else if (inputTokens < resolvedModel.context_window) {
          // Input fits, but not with requested max_tokens — reduce max_tokens
          const available = resolvedModel.context_window - inputTokens;
          const adjusted = Math.max(1, Math.min(available, maxOutput, resolvedModel.max_tokens));
          console.warn(`⚠️ Reducing max_tokens from ${maxOutput} to ${adjusted} for '${effectiveParams.model}'.`);
          effectiveParams.max_tokens = adjusted;
        } else {
          // Input alone exceeds context — try any larger context model with sufficient TPM, else cap and send
          const anyLargerWithTpm = candidates.find(m => {
            if (m.context_window <= resolvedModel!.context_window) return false;
            const tpm = this.getRateLimit(m.id).tpm;
            return tpm === 0 || inputTokens <= tpm;
          });
          if (anyLargerWithTpm) {
            console.warn(`⚠️ Input (${inputTokens}t) exceeds '${effectiveParams.model}' context. Switching to '${anyLargerWithTpm.id}' (${anyLargerWithTpm.context_window} context).`);
            effectiveParams.model = anyLargerWithTpm.id;
            resolvedModel = anyLargerWithTpm;
          } else if (anyLarger) {
            // Only switch if the larger model's TPM can handle at least the input alone
            const largerTpm = this.getRateLimit(anyLarger.id).tpm;
            if (largerTpm === 0 || inputTokens <= largerTpm) {
              console.warn(`⚠️ Input (${inputTokens}t) exceeds '${effectiveParams.model}' context. Switching to '${anyLarger.id}' (context: ${anyLarger.context_window}).`);
              effectiveParams.model = anyLarger.id;
              resolvedModel = anyLarger;
            } else {
              const safeMax = Math.min(maxOutput, resolvedModel.max_tokens);
              console.warn(`⚠️ Input (${inputTokens}t) exceeds '${effectiveParams.model}' context (${resolvedModel.context_window}). No larger model with sufficient TPM. Capping max_tokens to ${safeMax}.`);
              effectiveParams.max_tokens = safeMax;
            }
          } else {
            const safeMax = Math.min(maxOutput, resolvedModel.max_tokens);
            console.warn(`⚠️ Input (${inputTokens}t) exceeds all available contexts. Sending with max_tokens=${safeMax}.`);
            effectiveParams.max_tokens = safeMax;
          }
        }
      } else {
        // Input + max_output fits context, but ensure max_tokens ≤ model limit
        if (maxOutput > resolvedModel.max_tokens) {
          console.warn(`⚠️ Capping max_tokens from ${maxOutput} to ${resolvedModel.max_tokens} for '${effectiveParams.model}'.`);
          effectiveParams.max_tokens = resolvedModel.max_tokens;
        }
      }
    } else if (resolvedModel && resolvedModel.max_tokens > 0) {
      // No context window info, but cap max_tokens to model limit
      const currentMax = (effectiveParams as any).max_completion_tokens ?? effectiveParams.max_tokens ?? 0;
      if (currentMax > resolvedModel.max_tokens) {
        console.warn(`⚠️ Capping max_tokens from ${currentMax} to ${resolvedModel.max_tokens} for '${effectiveParams.model}'.`);
        effectiveParams.max_tokens = resolvedModel.max_tokens;
        delete (effectiveParams as any).max_completion_tokens;
      }
    }

    // Re-check TPM after any model routing changes; reduce max_tokens if needed to stay within limit
    if (resolvedModel) {
      const tpmLimit = this.getRateLimit(effectiveParams.model).tpm;
      const currentMaxOut = effectiveParams.max_tokens || resolvedModel.max_tokens || 0;
      if (tpmLimit > 0 && inputTokens + currentMaxOut > tpmLimit) {
        const safeMax = Math.max(1, tpmLimit - inputTokens);
        const adjusted = Math.min(currentMaxOut, safeMax, resolvedModel.max_tokens || currentMaxOut);
        if (adjusted < currentMaxOut) {
          console.warn(`⚠️ Reducing max_tokens from ${currentMaxOut} to ${adjusted} to stay within '${effectiveParams.model}' TPM limit (${tpmLimit}).`);
          effectiveParams.max_tokens = adjusted;
        }
      }
    }

    const isStream = effectiveParams.stream === true;
    console.log(`🔍 SENDING: model=${effectiveParams.model}, max_tokens=${effectiveParams.max_tokens}, inputTokens=${inputTokens}, stream=${isStream}`);
    const result = await this.client.chat.completions.create(effectiveParams as any);

    if (isStream) {
      this.totalRequests++;
      return result as any;
    }

    const completion = result as any;
    this.totalRequests++;

    this.addLog({
      method: 'POST',
      path: '/v1/chat/completions',
      model: effectiveParams.model,
      status: 200,
      duration_ms: 0,
      tokens: (completion.usage?.total_tokens || 0),
      success: true,
    });

    return completion;
  }

  async createTranscription(fileBuffer: Buffer, fileName: string, params: any): Promise<any> {
    const model = params.model || 'whisper-large-v3';
    await this.checkAndUpdateRateLimit(model, 0);

    const file = await Groq.toFile(fileBuffer, fileName);
    const result = await this.client.audio.transcriptions.create({
      file,
      model: model as any,
      language: params.language,
      prompt: params.prompt,
      response_format: params.response_format,
      temperature: params.temperature,
      timestamp_granularities: params.timestamp_granularities,
    } as any);

    this.totalRequests++;
    this.addLog({
      method: 'POST',
      path: '/v1/audio/transcriptions',
      model,
      status: 200,
      duration_ms: 0,
      tokens: 0,
      success: true,
    });

    return { text: result.text };
  }

  async createTranslation(fileBuffer: Buffer, fileName: string, params: any): Promise<any> {
    const model = params.model || 'whisper-large-v3';
    await this.checkAndUpdateRateLimit(model, 0);

    const file = await Groq.toFile(fileBuffer, fileName);
    const result = await this.client.audio.translations.create({
      file,
      model: model as any,
      prompt: params.prompt,
      response_format: params.response_format,
      temperature: params.temperature,
    } as any);

    this.totalRequests++;
    this.addLog({
      method: 'POST',
      path: '/v1/audio/translations',
      model,
      status: 200,
      duration_ms: 0,
      tokens: 0,
      success: true,
    });

    return { text: result.text };
  }

  async createEmbeddings(params: { model: string; input: string | string[]; encoding_format?: string; user?: string }): Promise<any> {
    const effectiveParams = { ...params } as any;

    if (!effectiveParams.model) {
      // Pick the first available embedding model, if any.
      const embed = this.models.find(m => m.category === 'embedding')?.id;
      if (!embed) {
        const err: any = new Error('No embeddings model is available for this Groq account.');
        err.status = 404;
        err.type = 'invalid_request_error';
        err.code = 'model_not_found';
        throw err;
      }
      effectiveParams.model = embed;
    }

    const model = effectiveParams.model;
    if (!this.models.some(m => m.id === model)) {
      const err: any = new Error(`The model \`${model}\` does not exist or you do not have access to it.`);
      err.status = 404;
      err.type = 'invalid_request_error';
      err.code = 'model_not_found';
      throw err;
    }

    await this.checkAndUpdateRateLimit(model, 0);
    const result = await this.client.embeddings.create(effectiveParams);

    this.totalRequests++;
    this.addLog({
      method: 'POST',
      path: '/v1/embeddings',
      model,
      status: 200,
      duration_ms: 0,
      tokens: result.usage?.total_tokens || 0,
      success: true,
    });

    return result;
  }

  getModels(): ModelMeta[] {
    return this.models;
  }

  getModel(id: string): ModelMeta | undefined {
    return this.models.find(m => m.id === id);
  }

  getRateLimits(): RateLimitState[] {
    const now = Date.now();
    return Array.from(this.rateCounters.entries()).map(([model, counter]) => {
      const limits = this.getRateLimit(model);
      return {
        model,
        rpm: limits.rpm,
        tpm: limits.tpm,
        current_rpm: counter.count,
        current_tpm: counter.tokens,
        resets_in_seconds: Math.max(0, Math.ceil((counter.resetAt - now) / 1000)),
      };
    });
  }

  getConfiguredRateLimits(): Array<{ model: string; rpm: number; tpm: number }> {
    return this.models.map(m => {
      const lim = this.getRateLimit(m.id);
      return { model: m.id, rpm: lim.rpm, tpm: lim.tpm };
    });
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }

  getStatus(): ServerStatus {
    return {
      status: this.models.length > 0 ? 'ok' : 'degraded',
      uptime: Date.now() - this.startedAt,
      models_count: this.models.length,
      total_requests: this.totalRequests,
      auto_select: this._autoSelect,
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }

  addLog(entry: Omit<LogEntry, 'timestamp'>): void {
    const log: LogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    this.logs.push(log);
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-500);
    }
    writeLog(log);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
