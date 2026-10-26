/**
 * Fallback Strategy Implementation
 * 
 * Manages fallback logic when models fail.
 * Handles rate limit errors, non-rate-limit errors, and complexity escalation.
 */

import type { ModelSelection, ComplexityLevel } from './model-router.js';
import type {
  FallbackAction,
  FallbackAttempt,
  IFallbackStrategy,
} from './fallback-strategy.js';
import { MAX_FALLBACK_ATTEMPTS } from './fallback-strategy.js';
import type { IModelRegistry, ModelConfig } from './model-registry.js';
import type { IProviderHealthChecker } from './provider-health.js';

/** Default retry-after duration in milliseconds when not specified */
const DEFAULT_RETRY_AFTER_MS = 1000;

/** Complexity level escalation order */
const COMPLEXITY_ESCALATION: Record<ComplexityLevel, ComplexityLevel | null> = {
  simple: 'medium',
  medium: 'complex',
  complex: null, // Cannot escalate beyond complex
};

/**
 * Custom error class for rate limit errors
 * Allows attaching retry-after information
 */
export class RateLimitError extends Error {
  public readonly retryAfterMs: number | null;
  public readonly statusCode: number;

  constructor(message: string, retryAfterMs: number | null = null, statusCode: number = 429) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
    this.statusCode = statusCode;
  }
}

/**
 * FallbackStrategy Implementation
 * 
 * Determines the next action when a model fails:
 * - Rate limit errors: wait and retry once, then fallback
 * - Non-rate-limit errors: immediate fallback to next model
 * - All models exhausted: escalate to higher complexity level
 * - All fallbacks exhausted: return comprehensive failure
 * 
 * @implements {IFallbackStrategy}
 */
export class FallbackStrategy implements IFallbackStrategy {
  private modelRegistry: IModelRegistry;
  private healthChecker: IProviderHealthChecker;
  private rateLimitRetried: Set<string>; // Track models that have been retried after rate limit

  constructor(modelRegistry: IModelRegistry, healthChecker: IProviderHealthChecker) {
    this.modelRegistry = modelRegistry;
    this.healthChecker = healthChecker;
    this.rateLimitRetried = new Set();
  }

  /**
   * Determine next action after a model failure.
   * 
   * Logic:
   * 1. If rate limit error and not yet retried: wait and retry
   * 2. If rate limit error already retried OR non-rate-limit error: fallback to next model
   * 3. If all models at current level exhausted: escalate to higher complexity
   * 4. If max attempts reached or no more options: fail with comprehensive report
   * 
   * @param error - The error that occurred
   * @param currentModel - The model that failed
   * @param attempts - Previous fallback attempts
   * @returns The action to take
   */
  async getNextAction(
    error: Error,
    currentModel: ModelSelection,
    attempts: FallbackAttempt[]
  ): Promise<FallbackAction> {
    const modelKey = `${currentModel.provider}:${currentModel.model}`;

    // Check if we've exceeded max fallback attempts
    if (attempts.length >= MAX_FALLBACK_ATTEMPTS) {
      return this.createFailAction(attempts, currentModel, error);
    }

    // Handle rate limit errors
    if (this.isRateLimitError(error)) {
      // If we haven't retried this model after rate limit, wait and retry
      if (!this.rateLimitRetried.has(modelKey)) {
        this.rateLimitRetried.add(modelKey);
        const retryAfterMs = this.getRetryAfterMs(error) ?? DEFAULT_RETRY_AFTER_MS;
        return { type: 'retry', delayMs: retryAfterMs };
      }
      // Already retried after rate limit, proceed to fallback
    }

    // Try to find next available model at the same complexity level
    const nextModel = this.findNextAvailableModel(currentModel.complexity, attempts, currentModel);
    if (nextModel) {
      return { type: 'fallback', model: nextModel };
    }

    // No more models at current level, try to escalate
    const escalatedLevel = COMPLEXITY_ESCALATION[currentModel.complexity];
    if (escalatedLevel && (escalatedLevel === 'medium' || escalatedLevel === 'complex')) {
      // Check if there are available models at the escalated level
      const escalatedModel = this.findNextAvailableModel(escalatedLevel, attempts, null);
      if (escalatedModel) {
        return { type: 'escalate', toLevel: escalatedLevel };
      }
    }

    // No more options, return fail
    return this.createFailAction(attempts, currentModel, error);
  }

  /**
   * Check if error is a rate limit error (HTTP 429).
   * 
   * Detects rate limit errors by:
   * 1. Checking if error is a RateLimitError instance
   * 2. Checking for 429 status code in error properties
   * 3. Checking for rate limit keywords in error message
   */
  isRateLimitError(error: Error): boolean {
    // Check if it's our custom RateLimitError
    if (error instanceof RateLimitError) {
      return true;
    }

    // Check for status code 429 in various error formats
    const errorAny = error as unknown as Record<string, unknown>;
    
    // Check common status code properties
    if (errorAny.statusCode === 429 || errorAny.status === 429 || errorAny.code === 429) {
      return true;
    }

    // Check nested response object (common in HTTP client errors)
    if (errorAny.response && typeof errorAny.response === 'object') {
      const response = errorAny.response as Record<string, unknown>;
      if (response.status === 429 || response.statusCode === 429) {
        return true;
      }
    }

    // Check error message for rate limit indicators
    const message = error.message.toLowerCase();
    if (
      message.includes('rate limit') ||
      message.includes('rate_limit') ||
      message.includes('ratelimit') ||
      message.includes('too many requests') ||
      message.includes('429')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Extract retry-after duration from rate limit error.
   * 
   * Looks for retry-after information in:
   * 1. RateLimitError.retryAfterMs property
   * 2. Error's retryAfter property (in seconds or milliseconds)
   * 3. Response headers (retry-after header)
   * 4. Error message parsing
   * 
   * @returns Duration in milliseconds, or null if not found
   */
  getRetryAfterMs(error: Error): number | null {
    // Check if it's our custom RateLimitError
    if (error instanceof RateLimitError && error.retryAfterMs !== null) {
      return error.retryAfterMs;
    }

    const errorAny = error as unknown as Record<string, unknown>;

    // Check for retryAfterMs property directly
    if (typeof errorAny.retryAfterMs === 'number' && errorAny.retryAfterMs > 0) {
      return errorAny.retryAfterMs;
    }

    // Check for retryAfter property (could be in seconds)
    if (typeof errorAny.retryAfter === 'number' && errorAny.retryAfter > 0) {
      // If value is small (< 1000), assume it's in seconds
      return errorAny.retryAfter < 1000 ? errorAny.retryAfter * 1000 : errorAny.retryAfter;
    }

    // Check for retry-after in response headers
    if (errorAny.response && typeof errorAny.response === 'object') {
      const response = errorAny.response as Record<string, unknown>;
      
      // Check headers object
      if (response.headers && typeof response.headers === 'object') {
        const headers = response.headers as Record<string, unknown>;
        const retryAfterHeader = headers['retry-after'] ?? headers['Retry-After'];
        
        if (typeof retryAfterHeader === 'string') {
          const parsed = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsed) && parsed > 0) {
            // retry-after header is typically in seconds
            return parsed * 1000;
          }
        } else if (typeof retryAfterHeader === 'number' && retryAfterHeader > 0) {
          return retryAfterHeader < 1000 ? retryAfterHeader * 1000 : retryAfterHeader;
        }
      }
    }

    // Try to parse from error message
    const message = error.message;
    const retryAfterMatch = message.match(/retry[- ]?after[:\s]+(\d+)/i);
    if (retryAfterMatch) {
      const value = parseInt(retryAfterMatch[1], 10);
      if (!isNaN(value) && value > 0) {
        // Assume seconds if small value
        return value < 1000 ? value * 1000 : value;
      }
    }

    return null;
  }

  /**
   * Reset the rate limit retry tracking.
   * Call this when starting a new request cycle.
   */
  resetRetryTracking(): void {
    this.rateLimitRetried.clear();
  }

  /**
   * Find the next available model at a given complexity level.
   * Excludes models that have already been attempted.
   */
  private findNextAvailableModel(
    level: ComplexityLevel,
    attempts: FallbackAttempt[],
    currentModel: ModelSelection | null
  ): ModelSelection | null {
    const models = this.modelRegistry.getModels(level);
    const attemptedKeys = new Set(
      attempts.map((a) => `${a.model.provider}:${a.model.model}`)
    );

    // Also exclude current model if provided
    if (currentModel) {
      attemptedKeys.add(`${currentModel.provider}:${currentModel.model}`);
    }

    for (const model of models) {
      const modelKey = `${model.provider}:${model.model}`;
      
      // Skip if already attempted
      if (attemptedKeys.has(modelKey)) {
        continue;
      }

      // Skip if provider is not available
      if (!this.healthChecker.isAvailable(model.provider)) {
        continue;
      }

      // Found an available model
      return this.modelConfigToSelection(model, level);
    }

    return null;
  }

  /**
   * Convert ModelConfig to ModelSelection.
   */
  private modelConfigToSelection(config: ModelConfig, level: ComplexityLevel): ModelSelection {
    return {
      provider: config.provider,
      model: config.model,
      estimatedCostPer1KTokens: config.costPer1KInputTokens + config.costPer1KOutputTokens,
      complexity: level,
    };
  }

  /**
   * Create a fail action with comprehensive failure reporting.
   */
  private createFailAction(
    attempts: FallbackAttempt[],
    currentModel: ModelSelection,
    currentError: Error
  ): FallbackAction {
    // Build comprehensive failure report
    const attemptDetails = attempts.map((attempt, index) => 
      `${index + 1}. ${attempt.model.provider}/${attempt.model.model}: ${attempt.error}`
    );

    // Add current failure
    attemptDetails.push(
      `${attemptDetails.length + 1}. ${currentModel.provider}/${currentModel.model}: ${currentError.message}`
    );

    const reason = `All fallback attempts exhausted. Attempted models:\n${attemptDetails.join('\n')}`;

    return { type: 'fail', reason };
  }
}
