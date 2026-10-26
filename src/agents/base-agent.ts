/**
 * Base Agent Implementation
 * 
 * Abstract base class that implements the Agent interface with LLM integration.
 * Supports both Anthropic (Claude), Groq (Llama), and OpenAI APIs.
 * Includes 60s timeout and error handling with 1 retry on invalid response.
 * 
 * Integrates with ModelRouter for intelligent model selection based on task complexity.
 * Falls back to default model when ModelRouter is unavailable.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config, constants } from '../config/index.js';
import type { Agent, AgentRole, AgentResult } from '../types/agents.js';
import type { FullContext } from '../types/orchestrator.js';
import type { IModelRouter, ModelSelection, ExecutionMetrics, Provider } from '../model-router/model-router.js';

/** Error thrown when agent execution times out */
export class AgentTimeoutError extends Error {
  constructor(role: AgentRole, timeoutMs: number = constants.MAX_AGENT_TIMEOUT) {
    super(`Agent ${role} execution timed out after ${timeoutMs}ms`);
    this.name = 'AgentTimeoutError';
  }
}

/** Error thrown when LLM API returns an invalid response */
export class InvalidResponseError extends Error {
  constructor(role: AgentRole, reason: string) {
    super(`Agent ${role} received invalid response: ${reason}`);
    this.name = 'InvalidResponseError';
  }
}

/** LLM Provider type */
type LLMProvider = 'anthropic' | 'groq' | 'openai' | 'ollama';

/** Abort signal of the execution in progress, scoped per async call chain */
const requestSignal = new AsyncLocalStorage<AbortSignal>();

/** Router used by agents constructed without an explicit one */
let defaultModelRouter: IModelRouter | null = null;

/**
 * Set the ModelRouter that agents use when none is passed to their
 * constructor. Call before agents are created (they are cached).
 */
export function setDefaultModelRouter(router: IModelRouter | null): void {
  defaultModelRouter = router;
}

/** Ollama exposes an OpenAI-compatible API; the key is required by the SDK but ignored. */
function createOllamaClient(): OpenAI {
  return new OpenAI({ apiKey: 'ollama', baseURL: config.OLLAMA_BASE_URL() });
}

/** Callback for streaming chunks */
export type StreamCallback = (chunk: string, fullText: string) => Promise<void>;

/**
 * Abstract base class for all agents.
 * Provides LLM API integration with timeout and retry logic.
 * Integrates with ModelRouter for intelligent model selection.
 */
export abstract class BaseAgent implements Agent {
  abstract readonly role: AgentRole;
  
  protected anthropic: Anthropic | null = null;
  protected groq: OpenAI | null = null;
  protected openai: OpenAI | null = null;
  protected ollama: OpenAI | null = null;
  protected provider: LLMProvider;
  protected anthropicModel: string = 'claude-sonnet-4-20250514';
  protected groqModel: string = config.GROQ_MODEL() || 'llama-3.3-70b-versatile';
  protected openaiModel: string = 'gpt-4o';
  
  /** Optional ModelRouter for intelligent model selection */
  protected modelRouter: IModelRouter | null = null;
  
  /** Current task description for model selection context */
  protected currentTaskDescription: string = '';
  
  constructor(modelRouter?: IModelRouter) {
    this.provider = config.LLM_PROVIDER() as LLMProvider;
    this.modelRouter = modelRouter ?? defaultModelRouter;
    
    // Initialize default provider client
    if (this.provider === 'ollama' && config.OLLAMA_MODEL()) {
      this.ollama = createOllamaClient();
    } else if (this.provider === 'anthropic' && config.ANTHROPIC_API_KEY()) {
      this.anthropic = new Anthropic({
        apiKey: config.ANTHROPIC_API_KEY(),
      });
    } else if (this.provider === 'openai' && this.getOpenAIApiKey()) {
      this.openai = new OpenAI({
        apiKey: this.getOpenAIApiKey(),
      });
    } else {
      // Default to Groq
      this.provider = 'groq';
      this.groq = new OpenAI({
        apiKey: config.GROQ_API_KEY(),
        baseURL: 'https://api.groq.com/openai/v1',
      });
    }
  }
  
  /**
   * Get OpenAI API key from environment.
   * Returns empty string if not configured.
   */
  private getOpenAIApiKey(): string {
    return process.env['OPENAI_API_KEY'] ?? '';
  }
  
  /**
   * Execute the agent with the given context and task description.
   * Implements timeout and retry logic.
   * Uses ModelRouter for intelligent model selection when available.
   */
  async execute(context: FullContext, taskDescription: string, onStream?: StreamCallback): Promise<AgentResult> {
    const prompt = this.buildPrompt(context, taskDescription);
    
    // Store task description for model selection context
    this.currentTaskDescription = taskDescription;
    
    try {
      const output = await this.executeWithRetry(prompt, onStream);
      return this.parseOutput(output);
    } catch (error) {
      return this.handleError(error);
    }
  }
  
  /**
   * Build the prompt for this agent. Override in subclasses for custom prompts.
   */
  protected abstract buildPrompt(context: FullContext, taskDescription: string): string;
  
  /**
   * Get the system prompt for this agent. Override in subclasses.
   */
  protected abstract getSystemPrompt(): string;
  
  /**
   * Parse the LLM output into an AgentResult. Override for structured output.
   */
  protected parseOutput(output: string): AgentResult {
    return {
      role: this.role,
      output,
      success: true,
    };
  }
  
  /**
   * Execute the prompt with timeout and 1 retry on invalid response.
   */
  protected async executeWithRetry(prompt: string, onStream?: StreamCallback): Promise<string> {
    let lastError: Error | null = null;
    
    // Try up to 2 times (initial + 1 retry)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.executeWithTimeout(prompt, onStream);
      } catch (error) {
        if (error instanceof InvalidResponseError) {
          lastError = error;
          // Retry once on invalid response
          continue;
        }
        // Don't retry on timeout or other errors
        throw error;
      }
    }
    
    // If we get here, both attempts failed with invalid response
    throw lastError ?? new Error('Unknown error during agent execution');
  }
  
  /**
   * Timeout per LLM call. 60 s by default; agents with long inputs override it.
   */
  protected timeoutMs(): number {
    return constants.MAX_AGENT_TIMEOUT;
  }

  /**
   * Execute the prompt with the agent timeout.
   */
  protected async executeWithTimeout(prompt: string, onStream?: StreamCallback): Promise<string> {
    // Abort the HTTP request on timeout so the provider stops generating
    // (and billing) instead of finishing in the background.
    const controller = new AbortController();
    const timeoutMs = this.timeoutMs();
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AgentTimeoutError(this.role, timeoutMs));
      }, timeoutMs);
    });
    
    const executionPromise = requestSignal.run(controller.signal, () =>
      this.callLLMAPI(prompt, onStream)
    );
    
    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }
  
  /**
   * Request options carrying the abort signal of the current execution.
   */
  protected requestOptions(): { signal: AbortSignal } | undefined {
    const signal = requestSignal.getStore();
    return signal ? { signal } : undefined;
  }
  
  /**
   * Call the LLM API with the given prompt.
   * Uses ModelRouter for intelligent model selection when available.
   * Falls back to default provider/model when ModelRouter is unavailable.
   */
  protected async callLLMAPI(prompt: string, onStream?: StreamCallback): Promise<string> {
    // Try to use ModelRouter for intelligent model selection
    let modelSelection: ModelSelection | null = null;
    
    if (this.modelRouter && this.modelRouter.isAvailable()) {
      try {
        modelSelection = await this.modelRouter.selectModel(
          this.currentTaskDescription || prompt.substring(0, 500),
          this.role
        );
      } catch (error) {
        // ModelRouter selection failed, fall back to default
        console.warn(`ModelRouter selection failed, using default: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    if (!this.modelRouter || !modelSelection) {
      return this.callDefaultProvider(prompt, onStream);
    }
    
    // Call the selected model; on failure ask the router for the next one
    // (another provider or a higher level) until it has nothing left.
    const router = this.modelRouter;
    const attempted: ModelSelection[] = [];
    let current: ModelSelection = modelSelection;
    
    for (;;) {
      const startTime = Date.now();
      try {
        const result = await this.callWithSelection(current, prompt, onStream);
        this.recordMetrics(router, current, prompt, result, Date.now() - startTime, attempted.length > 0);
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.recordMetrics(router, current, prompt, '', Date.now() - startTime, attempted.length > 0, err.message);
        
        // A timeout abort or partially streamed answer must not be retried elsewhere
        if (requestSignal.getStore()?.aborted || err instanceof InvalidResponseError) {
          throw err;
        }
        
        attempted.push(current);
        const next = await router.handleFailure(err, current, attempted);
        if (!next) {
          throw err;
        }
        console.warn(`[${this.role}] ${current.provider}/${current.model} failed (${err.message}); trying ${next.provider}/${next.model}`);
        current = next;
      }
    }
  }
  
  /**
   * Record execution metrics without blocking the response.
   */
  private recordMetrics(
    router: IModelRouter,
    selection: ModelSelection,
    prompt: string,
    output: string,
    latencyMs: number,
    fallbackUsed: boolean,
    errorMessage?: string
  ): void {
    const metrics: ExecutionMetrics = {
      provider: selection.provider,
      model: selection.model,
      complexity: selection.complexity,
      // Rough approximation: 4 chars per token
      inputTokens: Math.ceil(prompt.length / 4),
      outputTokens: Math.ceil(output.length / 4),
      latencyMs,
      success: !errorMessage,
      error: errorMessage,
      fallbackUsed,
      agentRole: this.role,
    };
    
    router.recordExecution(metrics).catch((err) => {
      console.warn(`Failed to record execution metrics: ${err instanceof Error ? err.message : 'Unknown error'}`);
    });
  }
  
  /**
   * Call LLM API with the selected model from ModelRouter.
   */
  private async callWithSelection(
    selection: ModelSelection,
    prompt: string,
    onStream?: StreamCallback
  ): Promise<string> {
    // Ensure the appropriate client is initialized for the selected provider
    this.ensureProviderClient(selection.provider);
    
    switch (selection.provider) {
      case 'anthropic':
        return this.callAnthropicAPIWithModel(prompt, selection.model);
      case 'groq':
        return this.callGroqAPIWithModel(prompt, selection.model, onStream);
      case 'openai':
        return this.callOpenAIAPIWithModel(prompt, selection.model, onStream);
      case 'ollama':
        return this.callOllamaAPI(prompt, selection.model, onStream);
      default:
        throw new Error(`Unsupported provider: ${selection.provider}`);
    }
  }
  
  /**
   * Call the default provider (fallback when ModelRouter unavailable).
   */
  private async callDefaultProvider(prompt: string, onStream?: StreamCallback): Promise<string> {
    if (this.provider === 'ollama' && this.ollama) {
      return this.callOllamaAPI(prompt, config.OLLAMA_MODEL(), onStream);
    }
    if (this.provider === 'groq' && this.groq) {
      return this.callGroqAPI(prompt, onStream);
    } else if (this.provider === 'openai' && this.openai) {
      return this.callOpenAIAPI(prompt, onStream);
    }
    return this.callAnthropicAPI(prompt);
  }
  
  /**
   * Ensure the provider client is initialized.
   */
  private ensureProviderClient(provider: Provider): void {
    switch (provider) {
      case 'anthropic':
        if (!this.anthropic && config.ANTHROPIC_API_KEY()) {
          this.anthropic = new Anthropic({
            apiKey: config.ANTHROPIC_API_KEY(),
          });
        }
        break;
      case 'groq':
        if (!this.groq && config.GROQ_API_KEY()) {
          this.groq = new OpenAI({
            apiKey: config.GROQ_API_KEY(),
            baseURL: 'https://api.groq.com/openai/v1',
          });
        }
        break;
      case 'openai':
        if (!this.openai && this.getOpenAIApiKey()) {
          this.openai = new OpenAI({
            apiKey: this.getOpenAIApiKey(),
          });
        }
        break;
      case 'ollama':
        if (!this.ollama) {
          this.ollama = createOllamaClient();
        }
        break;
    }
  }
  
  /**
   * Call a local Ollama model through its OpenAI-compatible API.
   */
  protected async callOllamaAPI(prompt: string, model: string, onStream?: StreamCallback): Promise<string> {
    if (!this.ollama) {
      throw new Error('Ollama client not initialized');
    }
    
    const messages = [
      { role: 'system' as const, content: this.getSystemPrompt() },
      { role: 'user' as const, content: prompt },
    ];
    
    let output = '';
    if (onStream) {
      const stream = await this.ollama.chat.completions.create({
        model,
        max_tokens: 4096,
        stream: true,
        messages,
      }, this.requestOptions());
      
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          output += content;
          await onStream(content, output);
        }
      }
    } else {
      const response = await this.ollama.chat.completions.create({
        model,
        max_tokens: 4096,
        messages,
      }, this.requestOptions());
      output = response.choices[0]?.message?.content ?? '';
    }
    
    if (output.trim().length === 0) {
      throw new InvalidResponseError(this.role, 'Empty response');
    }
    return output;
  }
  
  /**
   * Call the Anthropic Claude API.
   */
  protected async callAnthropicAPI(prompt: string): Promise<string> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }
    
    const response = await this.anthropic.messages.create({
      model: this.anthropicModel,
      max_tokens: 4096,
      system: this.getSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }, this.requestOptions());
    
    // Extract text content from response
    const textContent = response.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new InvalidResponseError(this.role, 'No text content in response');
    }
    
    const output = textContent.text;
    if (!output || output.trim().length === 0) {
      throw new InvalidResponseError(this.role, 'Empty response');
    }
    
    return output;
  }
  
  /**
   * Call the Groq API (OpenAI compatible) with streaming support.
   */
  protected async callGroqAPI(prompt: string, onStream?: StreamCallback): Promise<string> {
    if (!this.groq) {
      throw new Error('Groq client not initialized');
    }
    
    // Use streaming if callback provided
    if (onStream) {
      const stream = await this.groq.chat.completions.create({
        model: this.groqModel,
        max_tokens: 4096,
        stream: true,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }, this.requestOptions());
      
      let fullText = '';
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullText += content;
          await onStream(content, fullText);
        }
      }
      
      if (!fullText || fullText.trim().length === 0) {
        throw new InvalidResponseError(this.role, 'Empty response');
      }
      
      return fullText;
    }
    
    // Non-streaming fallback
    const response = await this.groq.chat.completions.create({
      model: this.groqModel,
      max_tokens: 4096,
      messages: [
        {
          role: 'system',
          content: this.getSystemPrompt(),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }, this.requestOptions());
    
    const output = response.choices[0]?.message?.content;
    if (!output || output.trim().length === 0) {
      throw new InvalidResponseError(this.role, 'Empty response');
    }
    
    return output;
  }
  
  /**
   * Call the OpenAI API with streaming support.
   */
  protected async callOpenAIAPI(prompt: string, onStream?: StreamCallback): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }
    
    // Use streaming if callback provided
    if (onStream) {
      const stream = await this.openai.chat.completions.create({
        model: this.openaiModel,
        max_tokens: 4096,
        stream: true,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }, this.requestOptions());
      
      let fullText = '';
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullText += content;
          await onStream(content, fullText);
        }
      }
      
      if (!fullText || fullText.trim().length === 0) {
        throw new InvalidResponseError(this.role, 'Empty response');
      }
      
      return fullText;
    }
    
    // Non-streaming fallback
    const response = await this.openai.chat.completions.create({
      model: this.openaiModel,
      max_tokens: 4096,
      messages: [
        {
          role: 'system',
          content: this.getSystemPrompt(),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }, this.requestOptions());
    
    const output = response.choices[0]?.message?.content;
    if (!output || output.trim().length === 0) {
      throw new InvalidResponseError(this.role, 'Empty response');
    }
    
    return output;
  }
  
  /**
   * Call the Anthropic Claude API with a specific model.
   * Used by ModelRouter for intelligent model selection.
   */
  private async callAnthropicAPIWithModel(prompt: string, model: string): Promise<string> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }
    
    const response = await this.anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: this.getSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }, this.requestOptions());
    
    // Extract text content from response
    const textContent = response.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new InvalidResponseError(this.role, 'No text content in response');
    }
    
    const output = textContent.text;
    if (!output || output.trim().length === 0) {
      throw new InvalidResponseError(this.role, 'Empty response');
    }
    
    return output;
  }
  
  /**
   * Call the Groq API with a specific model.
   * Used by ModelRouter for intelligent model selection.
   */
  private async callGroqAPIWithModel(
    prompt: string,
    model: string,
    onStream?: StreamCallback
  ): Promise<string> {
    if (!this.groq) {
      throw new Error('Groq client not initialized');
    }
    
    // Use streaming if callback provided
    if (onStream) {
      const stream = await this.groq.chat.completions.create({
        model,
        max_tokens: 4096,
        stream: true,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }, this.requestOptions());
      
      let fullText = '';
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullText += content;
          await onStream(content, fullText);
        }
      }
      
      if (!fullText || fullText.trim().length === 0) {
        throw new InvalidResponseError(this.role, 'Empty response');
      }
      
      return fullText;
    }
    
    // Non-streaming fallback
    const response = await this.groq.chat.completions.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'system',
          content: this.getSystemPrompt(),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }, this.requestOptions());
    
    const output = response.choices[0]?.message?.content;
    if (!output || output.trim().length === 0) {
      throw new InvalidResponseError(this.role, 'Empty response');
    }
    
    return output;
  }
  
  /**
   * Call the OpenAI API with a specific model.
   * Used by ModelRouter for intelligent model selection.
   */
  private async callOpenAIAPIWithModel(
    prompt: string,
    model: string,
    onStream?: StreamCallback
  ): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }
    
    // Use streaming if callback provided
    if (onStream) {
      const stream = await this.openai.chat.completions.create({
        model,
        max_tokens: 4096,
        stream: true,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }, this.requestOptions());
      
      let fullText = '';
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullText += content;
          await onStream(content, fullText);
        }
      }
      
      if (!fullText || fullText.trim().length === 0) {
        throw new InvalidResponseError(this.role, 'Empty response');
      }
      
      return fullText;
    }
    
    // Non-streaming fallback
    const response = await this.openai.chat.completions.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'system',
          content: this.getSystemPrompt(),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }, this.requestOptions());
    
    const output = response.choices[0]?.message?.content;
    if (!output || output.trim().length === 0) {
      throw new InvalidResponseError(this.role, 'Empty response');
    }
    
    return output;
  }
  
  /**
   * Handle errors and return an error AgentResult.
   */
  protected handleError(error: unknown): AgentResult {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return {
      role: this.role,
      output: '',
      success: false,
      error: errorMessage,
    };
  }
}
