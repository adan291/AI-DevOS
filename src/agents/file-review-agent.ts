/**
 * File Review Agent
 *
 * ReviewerAgent variant used by POST /api/review: same role and LLM plumbing
 * (provider, ModelRouter, timeout), but with a prompt that asks for strict JSON.
 */

import { ReviewerAgent } from './reviewer-agent.js';
import { FILE_REVIEW_SYSTEM_PROMPT } from './prompts/file-review.js';
import { config } from '../config/index.js';

export class FileReviewAgent extends ReviewerAgent {
  /**
   * Send a ready-made prompt and return the raw model output.
   * Throws on timeout or provider errors.
   */
  async complete(prompt: string, taskDescription = 'Revisión de código de ficheros'): Promise<string> {
    this.currentTaskDescription = taskDescription;
    return this.executeWithRetry(prompt);
  }

  /** Provider/model that will answer (the router decides per request when enabled). */
  describeModel(): string {
    if (this.modelRouter?.isAvailable()) {
      return 'model-router';
    }
    switch (this.provider) {
      case 'ollama':
        return `ollama/${config.OLLAMA_MODEL()}`;
      case 'anthropic':
        return `anthropic/${this.anthropicModel}`;
      case 'openai':
        return `openai/${this.openaiModel}`;
      default:
        return `groq/${this.groqModel}`;
    }
  }

  protected getSystemPrompt(): string {
    return FILE_REVIEW_SYSTEM_PROMPT;
  }

  /** A batch of files takes longer than a chat answer (REVIEW_TIMEOUT_MS, 180 s by default). */
  protected timeoutMs(): number {
    return config.REVIEW_TIMEOUT_MS();
  }
}
