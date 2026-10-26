/**
 * Unit Tests for Fallback Strategy
 * 
 * Example-based tests that verify specific behaviors with concrete examples.
 * Tests rate limit error detection, retry-after extraction, fallback model selection,
 * and escalation from simple to medium to complex.
 * 
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.5**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FallbackStrategy, RateLimitError } from './fallback-strategy-impl.js';
import { MAX_FALLBACK_ATTEMPTS } from './fallback-strategy.js';
import type { IModelRegistry, ModelConfig } from './model-registry.js';
import type { IProviderHealthChecker, ProviderHealth } from './provider-health.js';
import type { ModelSelection, ComplexityLevel, Provider } from './model-router.js';
import type { FallbackAttempt } from './fallback-strategy.js';

// ============================================================================
// Mock Implementations
// ============================================================================

const VALID_PROVIDERS: Provider[] = ['groq', 'anthropic', 'openai'];

/**
 * Creates a mock ModelRegistry that returns configurable models
 */
function createMockModelRegistry(
  modelsPerLevel: Partial<Record<ComplexityLevel, ModelConfig[]>> = {}
): IModelRegistry {
  const defaultModels: Record<ComplexityLevel, ModelConfig[]> = {
    simple: [
      { provider: 'groq', model: 'llama-3.3-70b-versatile', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 1 },
      { provider: 'anthropic', model: 'claude-3-5-haiku', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.005, maxTokens: 8192, priority: 2 },
      { provider: 'openai', model: 'gpt-4o-mini', costPer1KInputTokens: 0.00015, costPer1KOutputTokens: 0.0006, maxTokens: 16384, priority: 3 },
    ],
    medium: [
      { provider: 'groq', model: 'llama-3.3-70b-versatile', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 1 },
      { provider: 'anthropic', model: 'claude-sonnet-4', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.015, maxTokens: 8192, priority: 2 },
      { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 3 },
    ],
    complex: [
      { provider: 'anthropic', model: 'claude-opus-4', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 1 },
      { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 2 },
      { provider: 'groq', model: 'llama-3.3-70b-versatile', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 3 },
    ],
  };

  const models = { ...defaultModels, ...modelsPerLevel };

  return {
    getModels: (level: ComplexityLevel) => models[level] || [],
    getAgentOverride: () => null,
    updateConfig: vi.fn(),
    setAgentOverride: vi.fn(),
    validate: vi.fn(),
  };
}

/**
 * Creates a mock ProviderHealthChecker
 */
function createMockHealthChecker(
  availableProviders: Provider[] = VALID_PROVIDERS
): IProviderHealthChecker {
  const healthStatus = new Map<Provider, ProviderHealth>();
  
  for (const provider of VALID_PROVIDERS) {
    healthStatus.set(provider, {
      provider,
      available: availableProviders.includes(provider),
      lastCheck: new Date(),
      consecutiveFailures: 0,
    });
  }

  return {
    isAvailable: (provider: Provider) => availableProviders.includes(provider),
    getHealthStatus: () => healthStatus,
    markUnavailable: vi.fn(),
    startHealthChecks: vi.fn(),
    stopHealthChecks: vi.fn(),
  };
}

/**
 * Helper to create a ModelSelection
 */
function createModelSelection(
  provider: Provider,
  model: string,
  complexity: ComplexityLevel
): ModelSelection {
  return {
    provider,
    model,
    estimatedCostPer1KTokens: 0.001,
    complexity,
  };
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('FallbackStrategy', () => {
  let mockRegistry: IModelRegistry;
  let mockHealthChecker: IProviderHealthChecker;
  let fallbackStrategy: FallbackStrategy;

  beforeEach(() => {
    mockRegistry = createMockModelRegistry();
    mockHealthChecker = createMockHealthChecker();
    fallbackStrategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
  });

  // ==========================================================================
  // Requirement 4.1: Rate Limit Error Detection
  // ==========================================================================
  describe('isRateLimitError()', () => {
    it('should detect RateLimitError instance', () => {
      const error = new RateLimitError('Rate limit exceeded', 5000, 429);
      expect(fallbackStrategy.isRateLimitError(error)).toBe(true);
    });

    it('should detect error with statusCode 429', () => {
      const error = new Error('Too many requests') as Error & { statusCode: number };
      error.statusCode = 429;
      expect(fallbackStrategy.isRateLimitError(error)).toBe(true);
    });

    it('should detect error with status 429', () => {
      const error = new Error('Too many requests') as Error & { status: number };
      error.status = 429;
      expect(fallbackStrategy.isRateLimitError(error)).toBe(true);
    });

    it('should detect error with code 429', () => {
      const error = new Error('Too many requests') as Error & { code: number };
      error.code = 429;
      expect(fallbackStrategy.isRateLimitError(error)).toBe(true);
    });

    it('should detect error with response.status 429', () => {
      const error = new Error('Too many requests') as Error & { response: { status: number } };
      error.response = { status: 429 };
      expect(fallbackStrategy.isRateLimitError(error)).toBe(true);
    });

    it('should detect error with response.statusCode 429', () => {
      const error = new Error('Too many requests') as Error & { response: { statusCode: number } };
      error.response = { statusCode: 429 };
      expect(fallbackStrategy.isRateLimitError(error)).toBe(true);
    });

    it('should detect error message containing "rate limit"', () => {
      const error = new Error('Rate limit exceeded for this API');
      expect(fallbackStrategy.isRateLimitError(error)).toBe(true);
    });

    it('should detect error message containing "rate_limit"', () => {
      const error = new Error('Error: rate_limit_exceeded');
      expect(fallbackStrategy.isRateLimitError(error)).toBe(true);
    });

    it('should detect error message containing "ratelimit"', () => {
      const error = new Error('RateLimit error occurred');
      expect(fallbackStrategy.isRateLimitError(error)).toBe(true);
    });

    it('should detect error message containing "too many requests"', () => {
      const error = new Error('Too many requests, please slow down');
      expect(fallbackStrategy.isRateLimitError(error)).toBe(true);
    });

    it('should detect error message containing "429"', () => {
      const error = new Error('HTTP 429 error');
      expect(fallbackStrategy.isRateLimitError(error)).toBe(true);
    });

    it('should NOT detect generic errors as rate limit', () => {
      const error = new Error('Something went wrong');
      expect(fallbackStrategy.isRateLimitError(error)).toBe(false);
    });

    it('should NOT detect 500 errors as rate limit', () => {
      const error = new Error('Server error') as Error & { statusCode: number };
      error.statusCode = 500;
      expect(fallbackStrategy.isRateLimitError(error)).toBe(false);
    });

    it('should NOT detect 401 errors as rate limit', () => {
      const error = new Error('Unauthorized') as Error & { statusCode: number };
      error.statusCode = 401;
      expect(fallbackStrategy.isRateLimitError(error)).toBe(false);
    });
  });

  // ==========================================================================
  // Requirement 4.1: Retry-After Extraction
  // ==========================================================================
  describe('getRetryAfterMs()', () => {
    it('should extract retryAfterMs from RateLimitError', () => {
      const error = new RateLimitError('Rate limit', 5000, 429);
      expect(fallbackStrategy.getRetryAfterMs(error)).toBe(5000);
    });

    it('should return null for RateLimitError with null retryAfterMs', () => {
      const error = new RateLimitError('Rate limit', null, 429);
      expect(fallbackStrategy.getRetryAfterMs(error)).toBe(null);
    });

    it('should extract retryAfterMs property directly', () => {
      const error = new Error('Rate limit') as Error & { retryAfterMs: number };
      error.retryAfterMs = 3000;
      expect(fallbackStrategy.getRetryAfterMs(error)).toBe(3000);
    });

    it('should convert retryAfter in seconds to milliseconds (small value)', () => {
      const error = new Error('Rate limit') as Error & { retryAfter: number };
      error.retryAfter = 30; // 30 seconds
      expect(fallbackStrategy.getRetryAfterMs(error)).toBe(30000);
    });

    it('should use retryAfter directly if already in milliseconds (large value)', () => {
      const error = new Error('Rate limit') as Error & { retryAfter: number };
      error.retryAfter = 5000; // Already in ms
      expect(fallbackStrategy.getRetryAfterMs(error)).toBe(5000);
    });

    it('should extract retry-after from response headers (string)', () => {
      const error = new Error('Rate limit') as Error & { 
        response: { headers: { 'retry-after': string } } 
      };
      error.response = { headers: { 'retry-after': '60' } };
      expect(fallbackStrategy.getRetryAfterMs(error)).toBe(60000);
    });

    it('should extract Retry-After from response headers (capitalized)', () => {
      const error = new Error('Rate limit') as Error & { 
        response: { headers: { 'Retry-After': string } } 
      };
      error.response = { headers: { 'Retry-After': '45' } };
      expect(fallbackStrategy.getRetryAfterMs(error)).toBe(45000);
    });

    it('should extract retry-after from response headers (number)', () => {
      const error = new Error('Rate limit') as Error & { 
        response: { headers: { 'retry-after': number } } 
      };
      error.response = { headers: { 'retry-after': 30 } };
      expect(fallbackStrategy.getRetryAfterMs(error)).toBe(30000);
    });

    it('should parse retry-after from error message', () => {
      const error = new Error('Rate limit exceeded. Retry-after: 120 seconds');
      expect(fallbackStrategy.getRetryAfterMs(error)).toBe(120000);
    });

    it('should parse retry after from error message (no hyphen)', () => {
      const error = new Error('Please retry after 60 seconds');
      expect(fallbackStrategy.getRetryAfterMs(error)).toBe(60000);
    });

    it('should return null when no retry-after information found', () => {
      const error = new Error('Generic error');
      expect(fallbackStrategy.getRetryAfterMs(error)).toBe(null);
    });

    it('should return null for invalid retry-after header value', () => {
      const error = new Error('Rate limit') as Error & { 
        response: { headers: { 'retry-after': string } } 
      };
      error.response = { headers: { 'retry-after': 'invalid' } };
      expect(fallbackStrategy.getRetryAfterMs(error)).toBe(null);
    });
  });

  // ==========================================================================
  // Requirement 4.1, 4.2: getNextAction() - Fallback Model Selection
  // ==========================================================================
  describe('getNextAction()', () => {
    describe('Rate Limit Handling (Requirement 4.1)', () => {
      it('should return retry action for first rate limit error', async () => {
        const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
        const error = new RateLimitError('Rate limit', 5000, 429);
        const attempts: FallbackAttempt[] = [];

        const action = await fallbackStrategy.getNextAction(error, currentModel, attempts);

        expect(action.type).toBe('retry');
        if (action.type === 'retry') {
          expect(action.delayMs).toBe(5000);
        }
      });

      it('should use default delay (1000ms) when retry-after is null', async () => {
        const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
        const error = new RateLimitError('Rate limit', null, 429);
        const attempts: FallbackAttempt[] = [];

        const action = await fallbackStrategy.getNextAction(error, currentModel, attempts);

        expect(action.type).toBe('retry');
        if (action.type === 'retry') {
          expect(action.delayMs).toBe(1000);
        }
      });

      it('should fallback after second rate limit error on same model', async () => {
        const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
        const error = new RateLimitError('Rate limit', 5000, 429);
        const attempts: FallbackAttempt[] = [];

        // First rate limit - should retry
        const firstAction = await fallbackStrategy.getNextAction(error, currentModel, attempts);
        expect(firstAction.type).toBe('retry');

        // Second rate limit - should fallback
        const secondAction = await fallbackStrategy.getNextAction(error, currentModel, attempts);
        expect(secondAction.type).not.toBe('retry');
        expect(['fallback', 'escalate', 'fail']).toContain(secondAction.type);
      });
    });

    describe('Non-Rate-Limit Fallback (Requirement 4.2)', () => {
      it('should immediately fallback for generic errors', async () => {
        const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
        const error = new Error('Connection failed');
        const attempts: FallbackAttempt[] = [];

        const action = await fallbackStrategy.getNextAction(error, currentModel, attempts);

        expect(action.type).not.toBe('retry');
        expect(['fallback', 'escalate', 'fail']).toContain(action.type);
      });

      it('should immediately fallback for server errors (500)', async () => {
        const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
        const error = new Error('Internal server error') as Error & { statusCode: number };
        error.statusCode = 500;
        const attempts: FallbackAttempt[] = [];

        const action = await fallbackStrategy.getNextAction(error, currentModel, attempts);

        expect(action.type).not.toBe('retry');
      });

      it('should immediately fallback for authentication errors (401)', async () => {
        const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
        const error = new Error('Unauthorized') as Error & { statusCode: number };
        error.statusCode = 401;
        const attempts: FallbackAttempt[] = [];

        const action = await fallbackStrategy.getNextAction(error, currentModel, attempts);

        expect(action.type).not.toBe('retry');
      });

      it('should select next available model from same complexity level', async () => {
        const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
        const error = new Error('Connection failed');
        const attempts: FallbackAttempt[] = [];

        const action = await fallbackStrategy.getNextAction(error, currentModel, attempts);

        expect(action.type).toBe('fallback');
        if (action.type === 'fallback') {
          expect(action.model.complexity).toBe('simple');
          // Should be a different model
          expect(
            action.model.provider !== currentModel.provider ||
            action.model.model !== currentModel.model
          ).toBe(true);
        }
      });

      it('should skip unavailable providers when selecting fallback', async () => {
        // Only groq is available
        const limitedHealthChecker = createMockHealthChecker(['groq']);
        const strategy = new FallbackStrategy(mockRegistry, limitedHealthChecker);
        
        const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
        const error = new Error('Connection failed');
        const attempts: FallbackAttempt[] = [];

        const action = await strategy.getNextAction(error, currentModel, attempts);

        // Should escalate since no other providers available at simple level
        expect(['escalate', 'fail']).toContain(action.type);
      });
    });

    describe('Complexity Escalation (Requirement 4.3)', () => {
      it('should escalate from simple to medium when all simple models exhausted', async () => {
        const currentModel = createModelSelection('openai', 'gpt-4o-mini', 'simple');
        const error = new Error('Connection failed');
        
        // All simple models have been attempted
        const attempts: FallbackAttempt[] = [
          { model: createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple'), error: 'Failed', timestamp: new Date() },
          { model: createModelSelection('anthropic', 'claude-3-5-haiku', 'simple'), error: 'Failed', timestamp: new Date() },
        ];

        const action = await fallbackStrategy.getNextAction(error, currentModel, attempts);

        expect(action.type).toBe('escalate');
        if (action.type === 'escalate') {
          expect(action.toLevel).toBe('medium');
        }
      });

      it('should escalate from medium to complex when all medium models exhausted', async () => {
        const currentModel = createModelSelection('openai', 'gpt-4o', 'medium');
        const error = new Error('Connection failed');
        
        // All medium models have been attempted
        const attempts: FallbackAttempt[] = [
          { model: createModelSelection('groq', 'llama-3.3-70b-versatile', 'medium'), error: 'Failed', timestamp: new Date() },
          { model: createModelSelection('anthropic', 'claude-sonnet-4', 'medium'), error: 'Failed', timestamp: new Date() },
        ];

        const action = await fallbackStrategy.getNextAction(error, currentModel, attempts);

        expect(action.type).toBe('escalate');
        if (action.type === 'escalate') {
          expect(action.toLevel).toBe('complex');
        }
      });

      it('should fail when all complex models exhausted (cannot escalate further)', async () => {
        const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'complex');
        const error = new Error('Connection failed');
        
        // All complex models have been attempted
        const attempts: FallbackAttempt[] = [
          { model: createModelSelection('anthropic', 'claude-opus-4', 'complex'), error: 'Failed', timestamp: new Date() },
          { model: createModelSelection('openai', 'gpt-4o', 'complex'), error: 'Failed', timestamp: new Date() },
        ];

        const action = await fallbackStrategy.getNextAction(error, currentModel, attempts);

        expect(action.type).toBe('fail');
        if (action.type === 'fail') {
          expect(action.reason).toContain('exhausted');
        }
      });
    });

    describe('MAX_FALLBACK_ATTEMPTS Enforcement (Requirement 4.5)', () => {
      it('should fail when max fallback attempts reached', async () => {
        const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
        const error = new Error('Connection failed');
        
        // Create MAX_FALLBACK_ATTEMPTS previous attempts
        const attempts: FallbackAttempt[] = Array.from({ length: MAX_FALLBACK_ATTEMPTS }, (_, i) => ({
          model: createModelSelection('anthropic', `model-${i}`, 'simple'),
          error: 'Failed',
          timestamp: new Date(),
        }));

        const action = await fallbackStrategy.getNextAction(error, currentModel, attempts);

        expect(action.type).toBe('fail');
        if (action.type === 'fail') {
          expect(action.reason).toContain('exhausted');
        }
      });

      it('should include all attempted models in failure reason', async () => {
        const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
        const error = new Error('Final error');
        
        const attempts: FallbackAttempt[] = [
          { model: createModelSelection('anthropic', 'claude-3-5-haiku', 'simple'), error: 'Error 1', timestamp: new Date() },
          { model: createModelSelection('openai', 'gpt-4o-mini', 'simple'), error: 'Error 2', timestamp: new Date() },
          { model: createModelSelection('groq', 'other-model', 'simple'), error: 'Error 3', timestamp: new Date() },
        ];

        const action = await fallbackStrategy.getNextAction(error, currentModel, attempts);

        expect(action.type).toBe('fail');
        if (action.type === 'fail') {
          expect(action.reason).toContain('anthropic');
          expect(action.reason).toContain('openai');
          expect(action.reason).toContain('groq');
        }
      });

      it('should enforce MAX_FALLBACK_ATTEMPTS = 3', () => {
        expect(MAX_FALLBACK_ATTEMPTS).toBe(3);
      });
    });
  });

  // ==========================================================================
  // resetRetryTracking() Functionality
  // ==========================================================================
  describe('resetRetryTracking()', () => {
    it('should allow retry after reset', async () => {
      const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
      const error = new RateLimitError('Rate limit', 5000, 429);
      const attempts: FallbackAttempt[] = [];

      // First rate limit - should retry
      const firstAction = await fallbackStrategy.getNextAction(error, currentModel, attempts);
      expect(firstAction.type).toBe('retry');

      // Second rate limit - should NOT retry
      const secondAction = await fallbackStrategy.getNextAction(error, currentModel, attempts);
      expect(secondAction.type).not.toBe('retry');

      // Reset tracking
      fallbackStrategy.resetRetryTracking();

      // After reset - should retry again
      const actionAfterReset = await fallbackStrategy.getNextAction(error, currentModel, attempts);
      expect(actionAfterReset.type).toBe('retry');
    });

    it('should clear tracking for all models', async () => {
      const model1 = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
      const model2 = createModelSelection('anthropic', 'claude-3-5-haiku', 'simple');
      const error = new RateLimitError('Rate limit', 5000, 429);
      const attempts: FallbackAttempt[] = [];

      // Trigger retry for both models
      await fallbackStrategy.getNextAction(error, model1, attempts);
      await fallbackStrategy.getNextAction(error, model2, attempts);

      // Both should now NOT retry
      const action1 = await fallbackStrategy.getNextAction(error, model1, attempts);
      const action2 = await fallbackStrategy.getNextAction(error, model2, attempts);
      expect(action1.type).not.toBe('retry');
      expect(action2.type).not.toBe('retry');

      // Reset tracking
      fallbackStrategy.resetRetryTracking();

      // Both should retry again
      const action1AfterReset = await fallbackStrategy.getNextAction(error, model1, attempts);
      const action2AfterReset = await fallbackStrategy.getNextAction(error, model2, attempts);
      expect(action1AfterReset.type).toBe('retry');
      expect(action2AfterReset.type).toBe('retry');
    });
  });

  // ==========================================================================
  // RateLimitError Class
  // ==========================================================================
  describe('RateLimitError', () => {
    it('should create error with all properties', () => {
      const error = new RateLimitError('Rate limit exceeded', 5000, 429);
      
      expect(error.message).toBe('Rate limit exceeded');
      expect(error.retryAfterMs).toBe(5000);
      expect(error.statusCode).toBe(429);
      expect(error.name).toBe('RateLimitError');
    });

    it('should create error with default statusCode', () => {
      const error = new RateLimitError('Rate limit exceeded', 5000);
      
      expect(error.statusCode).toBe(429);
    });

    it('should create error with null retryAfterMs', () => {
      const error = new RateLimitError('Rate limit exceeded', null);
      
      expect(error.retryAfterMs).toBe(null);
    });

    it('should be an instance of Error', () => {
      const error = new RateLimitError('Rate limit exceeded', 5000);
      
      expect(error).toBeInstanceOf(Error);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('Edge Cases', () => {
    it('should handle empty attempts array', async () => {
      const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
      const error = new Error('Connection failed');
      const attempts: FallbackAttempt[] = [];

      const action = await fallbackStrategy.getNextAction(error, currentModel, attempts);

      expect(['fallback', 'escalate', 'fail']).toContain(action.type);
    });

    it('should handle registry with single model per level', async () => {
      const singleModelRegistry = createMockModelRegistry({
        simple: [
          { provider: 'groq', model: 'llama-3.3-70b-versatile', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 1 },
        ],
        medium: [
          { provider: 'anthropic', model: 'claude-sonnet-4', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.015, maxTokens: 8192, priority: 1 },
        ],
        complex: [
          { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 1 },
        ],
      });
      const strategy = new FallbackStrategy(singleModelRegistry, mockHealthChecker);
      
      const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
      const error = new Error('Connection failed');
      const attempts: FallbackAttempt[] = [];

      const action = await strategy.getNextAction(error, currentModel, attempts);

      // Should escalate since no other models at simple level
      expect(action.type).toBe('escalate');
      if (action.type === 'escalate') {
        expect(action.toLevel).toBe('medium');
      }
    });

    it('should handle all providers unavailable', async () => {
      const noProvidersHealthChecker = createMockHealthChecker([]);
      const strategy = new FallbackStrategy(mockRegistry, noProvidersHealthChecker);
      
      const currentModel = createModelSelection('groq', 'llama-3.3-70b-versatile', 'simple');
      const error = new Error('Connection failed');
      const attempts: FallbackAttempt[] = [];

      const action = await strategy.getNextAction(error, currentModel, attempts);

      expect(action.type).toBe('fail');
    });

    it('should track retry per model key (provider:model)', async () => {
      // Same model name but different provider should be tracked separately
      const model1 = createModelSelection('groq', 'same-model', 'simple');
      const model2 = createModelSelection('anthropic', 'same-model', 'simple');
      const error = new RateLimitError('Rate limit', 5000, 429);
      const attempts: FallbackAttempt[] = [];

      // First rate limit for model1 - should retry
      const action1 = await fallbackStrategy.getNextAction(error, model1, attempts);
      expect(action1.type).toBe('retry');

      // First rate limit for model2 - should also retry (different provider)
      const action2 = await fallbackStrategy.getNextAction(error, model2, attempts);
      expect(action2.type).toBe('retry');
    });
  });
});
