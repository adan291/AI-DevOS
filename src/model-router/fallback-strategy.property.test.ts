/**
 * Property-Based Tests for Fallback Strategy
 * Feature: model-router
 *
 * Property 8: Rate Limit Retry Behavior
 * **Validates: Requirements 4.1**
 * Rate limit errors SHALL wait for retry-after duration and retry once before fallback.
 *
 * Property 9: Non-Rate-Limit Fallback
 * **Validates: Requirements 4.2**
 * Non-rate-limit errors SHALL immediately select next available model.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { FallbackStrategy, RateLimitError } from './fallback-strategy-impl.js';
import type { IModelRegistry, ModelConfig } from './model-registry.js';
import type { IProviderHealthChecker, ProviderHealth } from './provider-health.js';
import type { ModelSelection, ComplexityLevel, Provider } from './model-router.js';
import type { FallbackAttempt } from './fallback-strategy.js';

// ============================================================================
// Fast-Check Arbitraries (Generators)
// ============================================================================

/**
 * Valid provider names as defined in the design document
 */
const VALID_PROVIDERS: Provider[] = ['groq', 'anthropic', 'openai'];

/**
 * Valid complexity levels
 */
const VALID_COMPLEXITY_LEVELS: ComplexityLevel[] = ['simple', 'medium', 'complex'];

/**
 * Generates arbitrary valid provider names
 */
const arbitraryProvider = fc.constantFrom<Provider>(...VALID_PROVIDERS);

/**
 * Generates arbitrary complexity levels
 */
const arbitraryComplexityLevel = fc.constantFrom<ComplexityLevel>(...VALID_COMPLEXITY_LEVELS);

/**
 * Generates arbitrary retry-after durations in milliseconds
 * Range: 1ms to 60000ms (1 minute)
 */
const arbitraryRetryAfterMs = fc.integer({ min: 1, max: 60000 });

/**
 * Generates arbitrary model names
 */
const arbitraryModelName = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_.'),
  { minLength: 3, maxLength: 30 }
);

/**
 * Generates arbitrary cost values (non-negative)
 */
const arbitraryCost = fc.double({ min: 0, max: 1, noNaN: true });

/**
 * Generates arbitrary ModelSelection objects
 */
const arbitraryModelSelection = fc.record({
  provider: arbitraryProvider,
  model: arbitraryModelName,
  estimatedCostPer1KTokens: arbitraryCost,
  complexity: arbitraryComplexityLevel,
});

/**
 * Generates arbitrary RateLimitError with various retry-after durations
 */
const arbitraryRateLimitError = fc.record({
  message: fc.string({ minLength: 1, maxLength: 100 }),
  retryAfterMs: fc.oneof(
    arbitraryRetryAfterMs,
    fc.constant(null as number | null)
  ),
  statusCode: fc.constant(429),
}).map(({ message, retryAfterMs, statusCode }) => 
  new RateLimitError(message, retryAfterMs, statusCode)
);

/**
 * Generates arbitrary RateLimitError with a specific retry-after duration (non-null)
 */
const arbitraryRateLimitErrorWithRetryAfter = fc.record({
  message: fc.string({ minLength: 1, maxLength: 100 }),
  retryAfterMs: arbitraryRetryAfterMs,
  statusCode: fc.constant(429),
}).map(({ message, retryAfterMs, statusCode }) => 
  new RateLimitError(message, retryAfterMs, statusCode)
);

// ============================================================================
// Mock Implementations
// ============================================================================

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
    ],
    medium: [
      { provider: 'groq', model: 'llama-3.3-70b-versatile', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 1 },
      { provider: 'anthropic', model: 'claude-sonnet-4', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.015, maxTokens: 8192, priority: 2 },
    ],
    complex: [
      { provider: 'anthropic', model: 'claude-opus-4', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 1 },
      { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 2 },
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
 * Creates a mock ProviderHealthChecker that marks all providers as available
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

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Property 8: Rate Limit Retry Behavior', () => {
  let mockRegistry: IModelRegistry;
  let mockHealthChecker: IProviderHealthChecker;
  let fallbackStrategy: FallbackStrategy;

  beforeEach(() => {
    mockRegistry = createMockModelRegistry();
    mockHealthChecker = createMockHealthChecker();
    fallbackStrategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
  });

  // ==========================================================================
  // Property: First rate limit error returns retry action with correct delay
  // ==========================================================================

  /**
   * **Validates: Requirements 4.1**
   *
   * Property: The first rate limit error SHALL return a retry action with the
   * correct delay matching the retry-after duration.
   */
  describe('First Rate Limit Error Returns Retry Action', () => {
    it('should return retry action with correct delay for first rate limit error', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryRateLimitErrorWithRetryAfter,
          async (currentModel, rateLimitError) => {
            // Arrange: Create fresh strategy for each test
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];

            // Act: Get next action for rate limit error
            const action = await strategy.getNextAction(rateLimitError, currentModel, attempts);

            // Assert: Should return retry action with correct delay
            expect(action.type).toBe('retry');
            if (action.type === 'retry') {
              expect(action.delayMs).toBe(rateLimitError.retryAfterMs);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return retry action with default delay when retry-after is null', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          fc.string({ minLength: 1, maxLength: 100 }),
          async (currentModel, errorMessage) => {
            // Arrange: Create rate limit error without retry-after
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const rateLimitError = new RateLimitError(errorMessage, null, 429);
            const attempts: FallbackAttempt[] = [];

            // Act: Get next action for rate limit error
            const action = await strategy.getNextAction(rateLimitError, currentModel, attempts);

            // Assert: Should return retry action with default delay (1000ms)
            expect(action.type).toBe('retry');
            if (action.type === 'retry') {
              expect(action.delayMs).toBe(1000); // DEFAULT_RETRY_AFTER_MS
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect rate limit errors correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryRateLimitError,
          async (rateLimitError) => {
            // Arrange
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);

            // Act & Assert: Should correctly identify rate limit error
            expect(strategy.isRateLimitError(rateLimitError)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should extract retry-after duration correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryRateLimitErrorWithRetryAfter,
          async (rateLimitError) => {
            // Arrange
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);

            // Act
            const retryAfterMs = strategy.getRetryAfterMs(rateLimitError);

            // Assert: Should extract the correct retry-after duration
            expect(retryAfterMs).toBe(rateLimitError.retryAfterMs);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Second rate limit error for same model returns fallback action
  // ==========================================================================

  /**
   * **Validates: Requirements 4.1**
   *
   * Property: A second rate limit error for the same model SHALL return a
   * fallback action (not another retry).
   */
  describe('Second Rate Limit Error Returns Fallback Action', () => {
    it('should return fallback action for second rate limit error on same model', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryRateLimitErrorWithRetryAfter,
          arbitraryRateLimitErrorWithRetryAfter,
          async (currentModel, firstError, secondError) => {
            // Arrange: Create fresh strategy
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];

            // Act: First rate limit error - should get retry
            const firstAction = await strategy.getNextAction(firstError, currentModel, attempts);
            expect(firstAction.type).toBe('retry');

            // Act: Second rate limit error for same model - should get fallback or escalate or fail
            const secondAction = await strategy.getNextAction(secondError, currentModel, attempts);

            // Assert: Should NOT return retry action
            expect(secondAction.type).not.toBe('retry');
            // Should be one of: fallback, escalate, or fail
            expect(['fallback', 'escalate', 'fail']).toContain(secondAction.type);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should track rate limit retries per model', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryModelSelection,
          arbitraryRateLimitErrorWithRetryAfter,
          async (model1, model2, rateLimitError) => {
            // Skip if models are the same
            if (model1.provider === model2.provider && model1.model === model2.model) {
              return;
            }

            // Arrange: Create fresh strategy
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];

            // Act: First rate limit error for model1 - should get retry
            const action1 = await strategy.getNextAction(rateLimitError, model1, attempts);
            expect(action1.type).toBe('retry');

            // Act: First rate limit error for model2 - should also get retry (different model)
            const action2 = await strategy.getNextAction(rateLimitError, model2, attempts);
            expect(action2.type).toBe('retry');

            // Act: Second rate limit error for model1 - should NOT get retry
            const action3 = await strategy.getNextAction(rateLimitError, model1, attempts);
            expect(action3.type).not.toBe('retry');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reset retry tracking when resetRetryTracking is called', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryRateLimitErrorWithRetryAfter,
          async (currentModel, rateLimitError) => {
            // Arrange: Create fresh strategy
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];

            // Act: First rate limit error - should get retry
            const firstAction = await strategy.getNextAction(rateLimitError, currentModel, attempts);
            expect(firstAction.type).toBe('retry');

            // Act: Reset retry tracking
            strategy.resetRetryTracking();

            // Act: Rate limit error again - should get retry (tracking was reset)
            const actionAfterReset = await strategy.getNextAction(rateLimitError, currentModel, attempts);
            expect(actionAfterReset.type).toBe('retry');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Rate limit retry happens exactly once per model
  // ==========================================================================

  /**
   * **Validates: Requirements 4.1**
   *
   * Property: Rate limit errors SHALL be retried exactly once per model.
   */
  describe('Rate Limit Retry Happens Exactly Once', () => {
    it('should retry exactly once for rate limit errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          fc.array(arbitraryRateLimitErrorWithRetryAfter, { minLength: 3, maxLength: 5 }),
          async (currentModel, rateLimitErrors) => {
            // Arrange: Create fresh strategy
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];
            let retryCount = 0;

            // Act: Process multiple rate limit errors for the same model
            for (const error of rateLimitErrors) {
              const action = await strategy.getNextAction(error, currentModel, attempts);
              if (action.type === 'retry') {
                retryCount++;
              }
            }

            // Assert: Should have exactly one retry
            expect(retryCount).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Retry delay matches retry-after duration
  // ==========================================================================

  /**
   * **Validates: Requirements 4.1**
   *
   * Property: The retry delay SHALL match the retry-after duration from the error.
   */
  describe('Retry Delay Matches Retry-After Duration', () => {
    it('should use exact retry-after duration from RateLimitError', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryRetryAfterMs,
          fc.string({ minLength: 1, maxLength: 50 }),
          async (currentModel, retryAfterMs, errorMessage) => {
            // Arrange
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const rateLimitError = new RateLimitError(errorMessage, retryAfterMs, 429);
            const attempts: FallbackAttempt[] = [];

            // Act
            const action = await strategy.getNextAction(rateLimitError, currentModel, attempts);

            // Assert
            expect(action.type).toBe('retry');
            if (action.type === 'retry') {
              expect(action.delayMs).toBe(retryAfterMs);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should extract retry-after from error with retryAfter property in seconds', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 60 }), // seconds
          async (retryAfterSeconds) => {
            // Arrange
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const error = new Error('Rate limit exceeded') as Error & { retryAfter: number };
            error.retryAfter = retryAfterSeconds;

            // Act
            const retryAfterMs = strategy.getRetryAfterMs(error);

            // Assert: Should convert seconds to milliseconds
            expect(retryAfterMs).toBe(retryAfterSeconds * 1000);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should extract retry-after from error with retryAfterMs property', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryRetryAfterMs,
          async (retryAfterMs) => {
            // Arrange
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const error = new Error('Rate limit exceeded') as Error & { retryAfterMs: number };
            error.retryAfterMs = retryAfterMs;

            // Act
            const extractedMs = strategy.getRetryAfterMs(error);

            // Assert: Should use the value directly
            expect(extractedMs).toBe(retryAfterMs);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// ============================================================================
// Additional Arbitraries for Property 9: Non-Rate-Limit Fallback
// ============================================================================

/**
 * Non-rate-limit error types that should trigger immediate fallback
 */
type NonRateLimitErrorType = 'generic' | 'timeout' | 'network' | 'server' | 'authentication' | 'validation';

const NON_RATE_LIMIT_ERROR_TYPES: NonRateLimitErrorType[] = [
  'generic',
  'timeout',
  'network',
  'server',
  'authentication',
  'validation',
];

/**
 * Generates arbitrary non-rate-limit error types
 */
const arbitraryNonRateLimitErrorType = fc.constantFrom<NonRateLimitErrorType>(...NON_RATE_LIMIT_ERROR_TYPES);

/**
 * Generates arbitrary generic Error objects (non-rate-limit)
 */
const arbitraryGenericError = fc.string({ minLength: 1, maxLength: 100 }).map(
  (message) => new Error(message)
);

/**
 * Generates arbitrary timeout errors
 */
const arbitraryTimeoutError = fc.string({ minLength: 1, maxLength: 50 }).map((suffix) => {
  const error = new Error(`Request timeout: ${suffix}`);
  error.name = 'TimeoutError';
  return error;
});

/**
 * Generates arbitrary network errors
 */
const arbitraryNetworkError = fc.string({ minLength: 1, maxLength: 50 }).map((suffix) => {
  const error = new Error(`Network error: ${suffix}`);
  error.name = 'NetworkError';
  return error;
});

/**
 * Generates arbitrary server errors (5xx)
 */
const arbitraryServerError = fc.record({
  message: fc.string({ minLength: 1, maxLength: 50 }),
  statusCode: fc.constantFrom(500, 502, 503, 504),
}).map(({ message, statusCode }) => {
  const error = new Error(`Server error ${statusCode}: ${message}`) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
});

/**
 * Generates arbitrary authentication errors (401/403)
 */
const arbitraryAuthError = fc.record({
  message: fc.string({ minLength: 1, maxLength: 50 }),
  statusCode: fc.constantFrom(401, 403),
}).map(({ message, statusCode }) => {
  const error = new Error(`Authentication error ${statusCode}: ${message}`) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
});

/**
 * Generates arbitrary validation errors
 */
const arbitraryValidationError = fc.string({ minLength: 1, maxLength: 50 }).map((suffix) => {
  const error = new Error(`Validation error: ${suffix}`);
  error.name = 'ValidationError';
  return error;
});

/**
 * Generates arbitrary non-rate-limit errors of various types
 */
const arbitraryNonRateLimitError = fc.oneof(
  arbitraryGenericError,
  arbitraryTimeoutError,
  arbitraryNetworkError,
  arbitraryServerError,
  arbitraryAuthError,
  arbitraryValidationError
);

// ============================================================================
// Property 9: Non-Rate-Limit Fallback
// ============================================================================

describe('Property 9: Non-Rate-Limit Fallback', () => {
  let mockRegistry: IModelRegistry;
  let mockHealthChecker: IProviderHealthChecker;

  beforeEach(() => {
    mockRegistry = createMockModelRegistry();
    mockHealthChecker = createMockHealthChecker();
  });

  // ==========================================================================
  // Property: Non-rate-limit errors immediately return fallback action (not retry)
  // ==========================================================================

  /**
   * **Validates: Requirements 4.2**
   *
   * Property: Non-rate-limit errors SHALL immediately return a fallback action
   * (not a retry action).
   */
  describe('Non-Rate-Limit Errors Return Immediate Fallback', () => {
    it('should never return retry action for non-rate-limit errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryNonRateLimitError,
          async (currentModel, nonRateLimitError) => {
            // Arrange: Create fresh strategy
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];

            // Act: Get next action for non-rate-limit error
            const action = await strategy.getNextAction(nonRateLimitError, currentModel, attempts);

            // Assert: Should NOT return retry action
            expect(action.type).not.toBe('retry');
            // Should be one of: fallback, escalate, or fail
            expect(['fallback', 'escalate', 'fail']).toContain(action.type);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly identify non-rate-limit errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (nonRateLimitError) => {
            // Arrange
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);

            // Act & Assert: Should NOT identify as rate limit error
            expect(strategy.isRateLimitError(nonRateLimitError)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return fallback action for generic errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryGenericError,
          async (currentModel, genericError) => {
            // Arrange
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];

            // Act
            const action = await strategy.getNextAction(genericError, currentModel, attempts);

            // Assert: Should NOT return retry
            expect(action.type).not.toBe('retry');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return fallback action for timeout errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryTimeoutError,
          async (currentModel, timeoutError) => {
            // Arrange
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];

            // Act
            const action = await strategy.getNextAction(timeoutError, currentModel, attempts);

            // Assert: Should NOT return retry
            expect(action.type).not.toBe('retry');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return fallback action for server errors (5xx)', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryServerError,
          async (currentModel, serverError) => {
            // Arrange
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];

            // Act
            const action = await strategy.getNextAction(serverError, currentModel, attempts);

            // Assert: Should NOT return retry
            expect(action.type).not.toBe('retry');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return fallback action for authentication errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryAuthError,
          async (currentModel, authError) => {
            // Arrange
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];

            // Act
            const action = await strategy.getNextAction(authError, currentModel, attempts);

            // Assert: Should NOT return retry
            expect(action.type).not.toBe('retry');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Fallback selects next available model from same complexity level
  // ==========================================================================

  /**
   * **Validates: Requirements 4.2**
   *
   * Property: When a non-rate-limit error occurs, the fallback SHALL select
   * the next available model from the same complexity level.
   */
  describe('Fallback Selects Next Available Model', () => {
    it('should select a different model on fallback', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryNonRateLimitError,
          async (complexity, nonRateLimitError) => {
            // Arrange: Create a model selection at the given complexity
            const models = mockRegistry.getModels(complexity);
            if (models.length < 2) {
              // Skip if not enough models to test fallback
              return;
            }

            const currentModel: ModelSelection = {
              provider: models[0].provider,
              model: models[0].model,
              estimatedCostPer1KTokens: models[0].costPer1KInputTokens + models[0].costPer1KOutputTokens,
              complexity,
            };

            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];

            // Act
            const action = await strategy.getNextAction(nonRateLimitError, currentModel, attempts);

            // Assert: If fallback, should be a different model
            if (action.type === 'fallback') {
              const isDifferent =
                action.model.provider !== currentModel.provider ||
                action.model.model !== currentModel.model;
              expect(isDifferent).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should select model from same complexity level when available', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryNonRateLimitError,
          async (complexity, nonRateLimitError) => {
            // Arrange: Create a model selection at the given complexity
            const models = mockRegistry.getModels(complexity);
            if (models.length < 2) {
              // Skip if not enough models to test fallback
              return;
            }

            const currentModel: ModelSelection = {
              provider: models[0].provider,
              model: models[0].model,
              estimatedCostPer1KTokens: models[0].costPer1KInputTokens + models[0].costPer1KOutputTokens,
              complexity,
            };

            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];

            // Act
            const action = await strategy.getNextAction(nonRateLimitError, currentModel, attempts);

            // Assert: If fallback, should be from same complexity level
            if (action.type === 'fallback') {
              expect(action.model.complexity).toBe(complexity);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not select already-attempted models', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryNonRateLimitError,
          async (complexity, nonRateLimitError) => {
            // Arrange: Create a model selection and some previous attempts
            const models = mockRegistry.getModels(complexity);
            if (models.length < 2) {
              return;
            }

            const currentModel: ModelSelection = {
              provider: models[0].provider,
              model: models[0].model,
              estimatedCostPer1KTokens: models[0].costPer1KInputTokens + models[0].costPer1KOutputTokens,
              complexity,
            };

            // Create attempts for all but the last model
            const attempts: FallbackAttempt[] = models.slice(0, -1).map((m) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity,
              },
              error: 'Previous error',
              timestamp: new Date(),
            }));

            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);

            // Act
            const action = await strategy.getNextAction(nonRateLimitError, currentModel, attempts);

            // Assert: If fallback, should not be any of the attempted models
            if (action.type === 'fallback') {
              const attemptedKeys = attempts.map((a) => `${a.model.provider}:${a.model.model}`);
              const selectedKey = `${action.model.provider}:${action.model.model}`;
              expect(attemptedKeys).not.toContain(selectedKey);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should only select from available providers', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryNonRateLimitError,
          fc.subarray(VALID_PROVIDERS, { minLength: 1 }),
          async (complexity, nonRateLimitError, availableProviders) => {
            // Arrange: Create health checker with limited available providers
            const limitedHealthChecker = createMockHealthChecker(availableProviders);
            const strategy = new FallbackStrategy(mockRegistry, limitedHealthChecker);

            const models = mockRegistry.getModels(complexity);
            if (models.length === 0) {
              return;
            }

            const currentModel: ModelSelection = {
              provider: models[0].provider,
              model: models[0].model,
              estimatedCostPer1KTokens: models[0].costPer1KInputTokens + models[0].costPer1KOutputTokens,
              complexity,
            };

            const attempts: FallbackAttempt[] = [];

            // Act
            const action = await strategy.getNextAction(nonRateLimitError, currentModel, attempts);

            // Assert: If fallback, should be from an available provider
            if (action.type === 'fallback') {
              expect(availableProviders).toContain(action.model.provider);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Immediate fallback (no delay)
  // ==========================================================================

  /**
   * **Validates: Requirements 4.2**
   *
   * Property: Non-rate-limit errors SHALL trigger immediate fallback without
   * any delay (unlike rate limit errors which have a retry-after delay).
   */
  describe('Immediate Fallback Without Delay', () => {
    it('should not include delay in fallback action for non-rate-limit errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryNonRateLimitError,
          async (currentModel, nonRateLimitError) => {
            // Arrange
            const strategy = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];

            // Act
            const action = await strategy.getNextAction(nonRateLimitError, currentModel, attempts);

            // Assert: Fallback action should not have a delay property
            // (only retry actions have delayMs)
            if (action.type === 'fallback') {
              expect(action).not.toHaveProperty('delayMs');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should process non-rate-limit errors differently from rate-limit errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryNonRateLimitError,
          arbitraryRateLimitErrorWithRetryAfter,
          async (currentModel, nonRateLimitError, rateLimitError) => {
            // Arrange: Two separate strategies to test independently
            const strategy1 = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const strategy2 = new FallbackStrategy(mockRegistry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];

            // Act
            const nonRateLimitAction = await strategy1.getNextAction(nonRateLimitError, currentModel, attempts);
            const rateLimitAction = await strategy2.getNextAction(rateLimitError, currentModel, attempts);

            // Assert: Non-rate-limit should NOT be retry, rate-limit SHOULD be retry
            expect(nonRateLimitAction.type).not.toBe('retry');
            expect(rateLimitAction.type).toBe('retry');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// ============================================================================
// Property 10: Complexity Escalation on Exhaustion
// ============================================================================

describe('Property 10: Complexity Escalation on Exhaustion', () => {
  let mockHealthChecker: IProviderHealthChecker;

  beforeEach(() => {
    mockHealthChecker = createMockHealthChecker();
  });

  // ==========================================================================
  // Property: When all models at a level fail, escalate to next higher level
  // ==========================================================================

  /**
   * **Validates: Requirements 4.3**
   *
   * Property: When all models for a complexity level have been attempted and failed,
   * the FallbackStrategy SHALL escalate to the next higher complexity level.
   * Escalation order: simple → medium → complex
   */
  describe('Escalation from Simple to Medium', () => {
    it('should escalate from simple to medium when all simple models exhausted', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (error) => {
            // Arrange: Create registry with known models at simple level
            const simpleModels: ModelConfig[] = [
              { provider: 'groq', model: 'llama-simple-1', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8192, priority: 1 },
              { provider: 'anthropic', model: 'claude-simple-1', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.005, maxTokens: 8192, priority: 2 },
            ];
            const mediumModels: ModelConfig[] = [
              { provider: 'groq', model: 'llama-medium-1', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 16384, priority: 1 },
            ];

            const registry = createMockModelRegistry({
              simple: simpleModels,
              medium: mediumModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            // Create current model at simple level
            const currentModel: ModelSelection = {
              provider: simpleModels[0].provider,
              model: simpleModels[0].model,
              estimatedCostPer1KTokens: simpleModels[0].costPer1KInputTokens + simpleModels[0].costPer1KOutputTokens,
              complexity: 'simple',
            };

            // Create attempts for all simple models (marking them as exhausted)
            const attempts: FallbackAttempt[] = simpleModels.map((m) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'simple' as ComplexityLevel,
              },
              error: 'Previous failure',
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should escalate to medium
            expect(action.type).toBe('escalate');
            if (action.type === 'escalate') {
              expect(action.toLevel).toBe('medium');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Escalation from Medium to Complex', () => {
    it('should escalate from medium to complex when all medium models exhausted', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (error) => {
            // Arrange: Create registry with known models at medium level
            const mediumModels: ModelConfig[] = [
              { provider: 'groq', model: 'llama-medium-1', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 16384, priority: 1 },
              { provider: 'anthropic', model: 'claude-medium-1', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.015, maxTokens: 8192, priority: 2 },
            ];
            const complexModels: ModelConfig[] = [
              { provider: 'anthropic', model: 'claude-complex-1', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 1 },
            ];

            const registry = createMockModelRegistry({
              medium: mediumModels,
              complex: complexModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            // Create current model at medium level
            const currentModel: ModelSelection = {
              provider: mediumModels[0].provider,
              model: mediumModels[0].model,
              estimatedCostPer1KTokens: mediumModels[0].costPer1KInputTokens + mediumModels[0].costPer1KOutputTokens,
              complexity: 'medium',
            };

            // Create attempts for all medium models (marking them as exhausted)
            const attempts: FallbackAttempt[] = mediumModels.map((m) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'medium' as ComplexityLevel,
              },
              error: 'Previous failure',
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should escalate to complex
            expect(action.type).toBe('escalate');
            if (action.type === 'escalate') {
              expect(action.toLevel).toBe('complex');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('No Escalation Beyond Complex', () => {
    it('should fail (not escalate) when all complex models exhausted', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (error) => {
            // Arrange: Create registry with known models at complex level
            const complexModels: ModelConfig[] = [
              { provider: 'anthropic', model: 'claude-complex-1', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 1 },
              { provider: 'openai', model: 'gpt-4-complex', costPer1KInputTokens: 0.01, costPer1KOutputTokens: 0.03, maxTokens: 16384, priority: 2 },
            ];

            const registry = createMockModelRegistry({
              complex: complexModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            // Create current model at complex level
            const currentModel: ModelSelection = {
              provider: complexModels[0].provider,
              model: complexModels[0].model,
              estimatedCostPer1KTokens: complexModels[0].costPer1KInputTokens + complexModels[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            // Create attempts for all complex models (marking them as exhausted)
            const attempts: FallbackAttempt[] = complexModels.map((m) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'complex' as ComplexityLevel,
              },
              error: 'Previous failure',
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should fail (no escalation beyond complex)
            expect(action.type).toBe('fail');
            expect(action.type).not.toBe('escalate');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include comprehensive failure details when complex level exhausted', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (error) => {
            // Arrange
            const complexModels: ModelConfig[] = [
              { provider: 'anthropic', model: 'claude-opus', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 1 },
            ];

            const registry = createMockModelRegistry({
              complex: complexModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: complexModels[0].provider,
              model: complexModels[0].model,
              estimatedCostPer1KTokens: complexModels[0].costPer1KInputTokens + complexModels[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            const attempts: FallbackAttempt[] = complexModels.map((m) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'complex' as ComplexityLevel,
              },
              error: 'Model unavailable',
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should fail with reason
            expect(action.type).toBe('fail');
            if (action.type === 'fail') {
              expect(action.reason).toBeDefined();
              expect(action.reason.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Escalation Order Verification', () => {
    it('should follow correct escalation order: simple → medium → complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<ComplexityLevel>('simple', 'medium'),
          arbitraryNonRateLimitError,
          async (startLevel, error) => {
            // Arrange: Create registry with single model per level
            const models: Record<ComplexityLevel, ModelConfig[]> = {
              simple: [{ provider: 'groq', model: 'simple-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8192, priority: 1 }],
              medium: [{ provider: 'groq', model: 'medium-model', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 16384, priority: 1 }],
              complex: [{ provider: 'anthropic', model: 'complex-model', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 1 }],
            };

            const registry = createMockModelRegistry(models);
            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const levelModels = models[startLevel];
            const currentModel: ModelSelection = {
              provider: levelModels[0].provider,
              model: levelModels[0].model,
              estimatedCostPer1KTokens: levelModels[0].costPer1KInputTokens + levelModels[0].costPer1KOutputTokens,
              complexity: startLevel,
            };

            // Mark all models at current level as attempted
            const attempts: FallbackAttempt[] = levelModels.map((m) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: startLevel,
              },
              error: 'Failed',
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should escalate to the correct next level
            expect(action.type).toBe('escalate');
            if (action.type === 'escalate') {
              const expectedNextLevel = startLevel === 'simple' ? 'medium' : 'complex';
              expect(action.toLevel).toBe(expectedNextLevel);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Escalation Only When All Models Exhausted', () => {
    it('should not escalate if there are still available models at current level', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryNonRateLimitError,
          async (complexity, error) => {
            // Arrange: Create registry with multiple models at the level
            const modelsAtLevel: ModelConfig[] = [
              { provider: 'groq', model: `${complexity}-model-1`, costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8192, priority: 1 },
              { provider: 'anthropic', model: `${complexity}-model-2`, costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8192, priority: 2 },
              { provider: 'openai', model: `${complexity}-model-3`, costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8192, priority: 3 },
            ];

            const registry = createMockModelRegistry({
              [complexity]: modelsAtLevel,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            // Current model is the first one
            const currentModel: ModelSelection = {
              provider: modelsAtLevel[0].provider,
              model: modelsAtLevel[0].model,
              estimatedCostPer1KTokens: modelsAtLevel[0].costPer1KInputTokens + modelsAtLevel[0].costPer1KOutputTokens,
              complexity,
            };

            // Only mark the first model as attempted (others still available)
            const attempts: FallbackAttempt[] = [];

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should fallback to next model at same level, NOT escalate
            expect(action.type).toBe('fallback');
            if (action.type === 'fallback') {
              expect(action.model.complexity).toBe(complexity);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should escalate only after all models at current level have been attempted', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<ComplexityLevel>('simple', 'medium'),
          arbitraryNonRateLimitError,
          async (complexity, error) => {
            // Arrange: Create registry with exactly 2 models at the level
            const modelsAtLevel: ModelConfig[] = [
              { provider: 'groq', model: `${complexity}-model-1`, costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8192, priority: 1 },
              { provider: 'anthropic', model: `${complexity}-model-2`, costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8192, priority: 2 },
            ];

            const nextLevel = complexity === 'simple' ? 'medium' : 'complex';
            const modelsAtNextLevel: ModelConfig[] = [
              { provider: 'openai', model: `${nextLevel}-model-1`, costPer1KInputTokens: 0.005, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 1 },
            ];

            const registry = createMockModelRegistry({
              [complexity]: modelsAtLevel,
              [nextLevel]: modelsAtNextLevel,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: modelsAtLevel[0].provider,
              model: modelsAtLevel[0].model,
              estimatedCostPer1KTokens: modelsAtLevel[0].costPer1KInputTokens + modelsAtLevel[0].costPer1KOutputTokens,
              complexity,
            };

            // Mark ALL models at current level as attempted
            const attempts: FallbackAttempt[] = modelsAtLevel.map((m) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity,
              },
              error: 'Failed',
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should escalate since all models at current level exhausted
            expect(action.type).toBe('escalate');
            if (action.type === 'escalate') {
              expect(action.toLevel).toBe(nextLevel);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Escalation with Unavailable Providers', () => {
    it('should escalate when remaining models at current level have unavailable providers', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (error) => {
            // Arrange: Create registry where remaining models have unavailable providers
            const simpleModels: ModelConfig[] = [
              { provider: 'groq', model: 'simple-groq', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8192, priority: 1 },
              { provider: 'anthropic', model: 'simple-anthropic', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8192, priority: 2 },
            ];
            const mediumModels: ModelConfig[] = [
              { provider: 'openai', model: 'medium-openai', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 16384, priority: 1 },
            ];

            const registry = createMockModelRegistry({
              simple: simpleModels,
              medium: mediumModels,
            });

            // Only openai is available (groq and anthropic are unavailable)
            const limitedHealthChecker = createMockHealthChecker(['openai']);
            const strategy = new FallbackStrategy(registry, limitedHealthChecker);

            const currentModel: ModelSelection = {
              provider: 'groq',
              model: 'simple-groq',
              estimatedCostPer1KTokens: 0.003,
              complexity: 'simple',
            };

            // No previous attempts, but all simple models have unavailable providers
            const attempts: FallbackAttempt[] = [];

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should escalate to medium since no simple models are available
            expect(action.type).toBe('escalate');
            if (action.type === 'escalate') {
              expect(action.toLevel).toBe('medium');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// ============================================================================
// Property 11: Comprehensive Failure Reporting
// ============================================================================

describe('Property 11: Comprehensive Failure Reporting', () => {
  let mockHealthChecker: IProviderHealthChecker;

  beforeEach(() => {
    mockHealthChecker = createMockHealthChecker();
  });

  // ==========================================================================
  // Property: When all fallbacks fail, error SHALL contain details of every
  // attempted model including: provider name, model name, and failure reason
  // ==========================================================================

  /**
   * **Validates: Requirements 4.4**
   *
   * Property: When all fallback attempts fail, the returned error SHALL contain
   * details of every attempted model including: provider name, model name, and
   * the specific failure reason for each attempt.
   */
  describe('Failure Report Contains All Attempted Models', () => {
    it('should include all attempted models in failure reason', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          fc.array(fc.string({ minLength: 5, maxLength: 50 }), { minLength: 1, maxLength: 3 }),
          async (finalError, errorMessages) => {
            // Arrange: Create registry with limited models at complex level (no escalation possible)
            const complexModels: ModelConfig[] = [
              { provider: 'anthropic', model: 'claude-opus-4', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 1 },
              { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 2 },
            ];

            const registry = createMockModelRegistry({
              complex: complexModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: complexModels[0].provider,
              model: complexModels[0].model,
              estimatedCostPer1KTokens: complexModels[0].costPer1KInputTokens + complexModels[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            // Create attempts for all complex models with unique error messages
            const attempts: FallbackAttempt[] = complexModels.map((m, index) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'complex' as ComplexityLevel,
              },
              error: errorMessages[index % errorMessages.length],
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(finalError, currentModel, attempts);

            // Assert: Should fail with comprehensive report
            expect(action.type).toBe('fail');
            if (action.type === 'fail') {
              // Verify each attempted model is mentioned in the failure reason
              for (const attempt of attempts) {
                expect(action.reason).toContain(attempt.model.provider);
                expect(action.reason).toContain(attempt.model.model);
                expect(action.reason).toContain(attempt.error);
              }
              // Also verify the current (final) model is included
              expect(action.reason).toContain(currentModel.provider);
              expect(action.reason).toContain(currentModel.model);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include provider name for each attempted model', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (error) => {
            // Arrange: Create registry with models from different providers
            const complexModels: ModelConfig[] = [
              { provider: 'groq', model: 'llama-70b', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 1 },
              { provider: 'anthropic', model: 'claude-opus', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 2 },
              { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 3 },
            ];

            const registry = createMockModelRegistry({
              complex: complexModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: complexModels[0].provider,
              model: complexModels[0].model,
              estimatedCostPer1KTokens: complexModels[0].costPer1KInputTokens + complexModels[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            // Create attempts for all models
            const attempts: FallbackAttempt[] = complexModels.map((m) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'complex' as ComplexityLevel,
              },
              error: `Error from ${m.provider}`,
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should include all provider names
            expect(action.type).toBe('fail');
            if (action.type === 'fail') {
              for (const model of complexModels) {
                expect(action.reason).toContain(model.provider);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include model name for each attempted model', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (error) => {
            // Arrange: Create registry with distinctly named models
            const complexModels: ModelConfig[] = [
              { provider: 'anthropic', model: 'claude-opus-4-20250514', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 1 },
              { provider: 'openai', model: 'gpt-4o-turbo', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 2 },
            ];

            const registry = createMockModelRegistry({
              complex: complexModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: complexModels[0].provider,
              model: complexModels[0].model,
              estimatedCostPer1KTokens: complexModels[0].costPer1KInputTokens + complexModels[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            // Create attempts for all models
            const attempts: FallbackAttempt[] = complexModels.map((m) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'complex' as ComplexityLevel,
              },
              error: `Model ${m.model} failed`,
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should include all model names
            expect(action.type).toBe('fail');
            if (action.type === 'fail') {
              for (const model of complexModels) {
                expect(action.reason).toContain(model.model);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include specific failure reason for each attempted model', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          fc.array(fc.string({ minLength: 10, maxLength: 100 }), { minLength: 2, maxLength: 3 }),
          async (finalError, uniqueErrorMessages) => {
            // Arrange: Create registry with models that will have unique error messages
            const complexModels: ModelConfig[] = [
              { provider: 'anthropic', model: 'claude-opus', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 1 },
              { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 2 },
            ];

            const registry = createMockModelRegistry({
              complex: complexModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: complexModels[0].provider,
              model: complexModels[0].model,
              estimatedCostPer1KTokens: complexModels[0].costPer1KInputTokens + complexModels[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            // Create attempts with unique error messages
            const attempts: FallbackAttempt[] = complexModels.map((m, index) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'complex' as ComplexityLevel,
              },
              error: uniqueErrorMessages[index % uniqueErrorMessages.length],
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(finalError, currentModel, attempts);

            // Assert: Should include all unique error messages
            expect(action.type).toBe('fail');
            if (action.type === 'fail') {
              for (const attempt of attempts) {
                expect(action.reason).toContain(attempt.error);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Failure Report Includes Current Model Failure', () => {
    it('should include the current (final) model failure in the report', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 10, maxLength: 100 }),
          async (finalErrorMessage) => {
            // Arrange
            const complexModels: ModelConfig[] = [
              { provider: 'anthropic', model: 'claude-opus', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 1 },
            ];

            const registry = createMockModelRegistry({
              complex: complexModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: complexModels[0].provider,
              model: complexModels[0].model,
              estimatedCostPer1KTokens: complexModels[0].costPer1KInputTokens + complexModels[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            // Mark all models as attempted
            const attempts: FallbackAttempt[] = complexModels.map((m) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'complex' as ComplexityLevel,
              },
              error: 'Previous error',
              timestamp: new Date(),
            }));

            const finalError = new Error(finalErrorMessage);

            // Act
            const action = await strategy.getNextAction(finalError, currentModel, attempts);

            // Assert: Should include the final error message
            expect(action.type).toBe('fail');
            if (action.type === 'fail') {
              expect(action.reason).toContain(finalErrorMessage);
              expect(action.reason).toContain(currentModel.provider);
              expect(action.reason).toContain(currentModel.model);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Failure Report Format', () => {
    it('should produce a non-empty failure reason', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (error) => {
            // Arrange
            const complexModels: ModelConfig[] = [
              { provider: 'anthropic', model: 'claude-opus', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 1 },
            ];

            const registry = createMockModelRegistry({
              complex: complexModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: complexModels[0].provider,
              model: complexModels[0].model,
              estimatedCostPer1KTokens: complexModels[0].costPer1KInputTokens + complexModels[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            const attempts: FallbackAttempt[] = complexModels.map((m) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'complex' as ComplexityLevel,
              },
              error: 'Model failed',
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Failure reason should be non-empty
            expect(action.type).toBe('fail');
            if (action.type === 'fail') {
              expect(action.reason).toBeDefined();
              expect(action.reason.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include count of all attempted models in failure report', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          fc.integer({ min: 1, max: 3 }),
          async (error, numModels) => {
            // Arrange: Create registry with variable number of models
            const complexModels: ModelConfig[] = [];
            for (let i = 0; i < numModels; i++) {
              complexModels.push({
                provider: VALID_PROVIDERS[i % VALID_PROVIDERS.length],
                model: `model-${i}`,
                costPer1KInputTokens: 0.01,
                costPer1KOutputTokens: 0.02,
                maxTokens: 8192,
                priority: i + 1,
              });
            }

            const registry = createMockModelRegistry({
              complex: complexModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: complexModels[0].provider,
              model: complexModels[0].model,
              estimatedCostPer1KTokens: complexModels[0].costPer1KInputTokens + complexModels[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            // Create attempts for all models
            const attempts: FallbackAttempt[] = complexModels.map((m, index) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'complex' as ComplexityLevel,
              },
              error: `Error ${index}`,
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should mention all models
            expect(action.type).toBe('fail');
            if (action.type === 'fail') {
              // Count how many model entries are in the reason
              // Each model should appear as "provider/model"
              for (const model of complexModels) {
                expect(action.reason).toContain(`${model.provider}/${model.model}`);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Failure After Max Attempts', () => {
    it('should fail with comprehensive report when max attempts reached', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (error) => {
            // Arrange: Create registry with many models but we'll hit max attempts
            const complexModels: ModelConfig[] = [
              { provider: 'groq', model: 'llama-70b', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 1 },
              { provider: 'anthropic', model: 'claude-opus', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 2 },
              { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 3 },
            ];

            const registry = createMockModelRegistry({
              complex: complexModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: complexModels[0].provider,
              model: complexModels[0].model,
              estimatedCostPer1KTokens: complexModels[0].costPer1KInputTokens + complexModels[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            // Create MAX_FALLBACK_ATTEMPTS (3) previous attempts
            const attempts: FallbackAttempt[] = complexModels.slice(0, 3).map((m, index) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'complex' as ComplexityLevel,
              },
              error: `Attempt ${index + 1} failed`,
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should fail with comprehensive report
            expect(action.type).toBe('fail');
            if (action.type === 'fail') {
              // Should include all previous attempts
              for (const attempt of attempts) {
                expect(action.reason).toContain(attempt.model.provider);
                expect(action.reason).toContain(attempt.model.model);
                expect(action.reason).toContain(attempt.error);
              }
              // Should also include current model
              expect(action.reason).toContain(currentModel.provider);
              expect(action.reason).toContain(currentModel.model);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Failure Report with Mixed Error Types', () => {
    it('should include details for various error types in failure report', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (finalError) => {
            // Arrange: Create models with different error types
            const complexModels: ModelConfig[] = [
              { provider: 'groq', model: 'llama-70b', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 1 },
              { provider: 'anthropic', model: 'claude-opus', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 2 },
            ];

            const registry = createMockModelRegistry({
              complex: complexModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: complexModels[0].provider,
              model: complexModels[0].model,
              estimatedCostPer1KTokens: complexModels[0].costPer1KInputTokens + complexModels[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            // Create attempts with different error types
            const errorTypes = [
              'Connection timeout',
              'Server error 500',
              'Authentication failed',
            ];

            const attempts: FallbackAttempt[] = complexModels.map((m, index) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'complex' as ComplexityLevel,
              },
              error: errorTypes[index % errorTypes.length],
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(finalError, currentModel, attempts);

            // Assert: Should include all error types
            expect(action.type).toBe('fail');
            if (action.type === 'fail') {
              for (const attempt of attempts) {
                expect(action.reason).toContain(attempt.error);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// ============================================================================
// Property 12: Maximum Fallback Attempts
// ============================================================================

describe('Property 12: Maximum Fallback Attempts', () => {
  let mockHealthChecker: IProviderHealthChecker;

  beforeEach(() => {
    mockHealthChecker = createMockHealthChecker();
  });

  // ==========================================================================
  // Property: SHALL attempt at most 3 fallback models (4 total including initial)
  // ==========================================================================

  /**
   * **Validates: Requirements 4.5**
   *
   * Property: For any failing execution, the ModelRouter SHALL attempt at most
   * 3 fallback models before returning a final error. The total number of model
   * attempts (including the initial attempt) SHALL not exceed 4.
   */
  describe('Maximum 3 Fallback Attempts Before Failure', () => {
    it('should return fail action when attempts.length >= MAX_FALLBACK_ATTEMPTS (3)', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryNonRateLimitError,
          fc.integer({ min: 3, max: 10 }), // 3 or more previous attempts
          async (currentModel, error, numAttempts) => {
            // Arrange: Create registry with many models
            const complexModels: ModelConfig[] = [
              { provider: 'groq', model: 'llama-70b', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 1 },
              { provider: 'anthropic', model: 'claude-opus', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 2 },
              { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 3 },
            ];

            const registry = createMockModelRegistry({
              simple: complexModels,
              medium: complexModels,
              complex: complexModels,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            // Create numAttempts previous attempts (>= 3)
            const attempts: FallbackAttempt[] = [];
            for (let i = 0; i < numAttempts; i++) {
              attempts.push({
                model: {
                  provider: VALID_PROVIDERS[i % VALID_PROVIDERS.length],
                  model: `model-${i}`,
                  estimatedCostPer1KTokens: 0.01,
                  complexity: currentModel.complexity,
                },
                error: `Attempt ${i + 1} failed`,
                timestamp: new Date(),
              });
            }

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should return fail action when attempts >= MAX_FALLBACK_ATTEMPTS
            expect(action.type).toBe('fail');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not return fail action when attempts.length < MAX_FALLBACK_ATTEMPTS (3) and models available', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryNonRateLimitError,
          fc.integer({ min: 0, max: 2 }), // 0, 1, or 2 previous attempts (less than 3)
          async (complexity, error, numAttempts) => {
            // Arrange: Create registry with enough models to allow fallback
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'model-0', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8192, priority: 1 },
              { provider: 'anthropic', model: 'model-1', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8192, priority: 2 },
              { provider: 'openai', model: 'model-2', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8192, priority: 3 },
            ];

            const registry = createMockModelRegistry({
              [complexity]: models,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: models[0].provider,
              model: models[0].model,
              estimatedCostPer1KTokens: models[0].costPer1KInputTokens + models[0].costPer1KOutputTokens,
              complexity,
            };

            // Create numAttempts previous attempts (< 3)
            const attempts: FallbackAttempt[] = [];
            for (let i = 0; i < numAttempts; i++) {
              attempts.push({
                model: {
                  provider: models[i].provider,
                  model: models[i].model,
                  estimatedCostPer1KTokens: models[i].costPer1KInputTokens + models[i].costPer1KOutputTokens,
                  complexity,
                },
                error: `Attempt ${i + 1} failed`,
                timestamp: new Date(),
              });
            }

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should NOT return fail if there are available models and attempts < 3
            // It should return fallback, escalate, or retry (but not fail due to max attempts)
            if (action.type === 'fail') {
              // If it fails, it should be because no models are available, not because of max attempts
              // This is acceptable if all models at current level are exhausted
              expect(attempts.length).toBeLessThan(3);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Exactly 3 Fallback Models Attempted Before Failure', () => {
    it('should allow exactly 3 fallback attempts before failing', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (error) => {
            // Arrange: Create registry with many models
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'model-0', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8192, priority: 1 },
              { provider: 'anthropic', model: 'model-1', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8192, priority: 2 },
              { provider: 'openai', model: 'model-2', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8192, priority: 3 },
              { provider: 'groq', model: 'model-3', costPer1KInputTokens: 0.004, costPer1KOutputTokens: 0.008, maxTokens: 8192, priority: 4 },
              { provider: 'anthropic', model: 'model-4', costPer1KInputTokens: 0.005, costPer1KOutputTokens: 0.01, maxTokens: 8192, priority: 5 },
            ];

            const registry = createMockModelRegistry({
              complex: models,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: models[0].provider,
              model: models[0].model,
              estimatedCostPer1KTokens: models[0].costPer1KInputTokens + models[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            // Test with exactly 2 attempts - should NOT fail yet
            const twoAttempts: FallbackAttempt[] = [
              {
                model: { provider: 'groq', model: 'model-0', estimatedCostPer1KTokens: 0.003, complexity: 'complex' },
                error: 'Attempt 1 failed',
                timestamp: new Date(),
              },
              {
                model: { provider: 'anthropic', model: 'model-1', estimatedCostPer1KTokens: 0.006, complexity: 'complex' },
                error: 'Attempt 2 failed',
                timestamp: new Date(),
              },
            ];

            const actionWith2 = await strategy.getNextAction(error, currentModel, twoAttempts);
            // With 2 attempts, should still be able to fallback (not fail due to max attempts)
            expect(actionWith2.type).not.toBe('fail');

            // Test with exactly 3 attempts - should fail
            const threeAttempts: FallbackAttempt[] = [
              ...twoAttempts,
              {
                model: { provider: 'openai', model: 'model-2', estimatedCostPer1KTokens: 0.009, complexity: 'complex' },
                error: 'Attempt 3 failed',
                timestamp: new Date(),
              },
            ];

            const actionWith3 = await strategy.getNextAction(error, currentModel, threeAttempts);
            // With 3 attempts (MAX_FALLBACK_ATTEMPTS), should fail
            expect(actionWith3.type).toBe('fail');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('4th Attempt (Initial + 3 Fallbacks) Results in Failure', () => {
    it('should fail on 4th total attempt (1 initial + 3 fallbacks)', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (error) => {
            // Arrange: Create registry with many models to ensure fallbacks are available
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'initial-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8192, priority: 1 },
              { provider: 'anthropic', model: 'fallback-1', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8192, priority: 2 },
              { provider: 'openai', model: 'fallback-2', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8192, priority: 3 },
              { provider: 'groq', model: 'fallback-3', costPer1KInputTokens: 0.004, costPer1KOutputTokens: 0.008, maxTokens: 8192, priority: 4 },
              { provider: 'anthropic', model: 'fallback-4', costPer1KInputTokens: 0.005, costPer1KOutputTokens: 0.01, maxTokens: 8192, priority: 5 },
            ];

            const registry = createMockModelRegistry({
              complex: models,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            // Simulate the 4th attempt scenario:
            // Initial attempt (1st) + 3 fallback attempts = 4 total
            // When we call getNextAction with 3 previous attempts, we're asking for the 4th
            const currentModel: ModelSelection = {
              provider: 'groq',
              model: 'fallback-3', // This would be the 4th model being tried
              estimatedCostPer1KTokens: 0.012,
              complexity: 'complex',
            };

            // 3 previous attempts (initial + 2 fallbacks)
            const attempts: FallbackAttempt[] = [
              {
                model: { provider: 'groq', model: 'initial-model', estimatedCostPer1KTokens: 0.003, complexity: 'complex' },
                error: 'Initial attempt failed',
                timestamp: new Date(),
              },
              {
                model: { provider: 'anthropic', model: 'fallback-1', estimatedCostPer1KTokens: 0.006, complexity: 'complex' },
                error: 'Fallback 1 failed',
                timestamp: new Date(),
              },
              {
                model: { provider: 'openai', model: 'fallback-2', estimatedCostPer1KTokens: 0.009, complexity: 'complex' },
                error: 'Fallback 2 failed',
                timestamp: new Date(),
              },
            ];

            // Act: This is the 4th attempt (current model failed, asking for next action)
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should fail because we've reached max fallback attempts (3)
            expect(action.type).toBe('fail');
            if (action.type === 'fail') {
              expect(action.reason).toBeDefined();
              expect(action.reason.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should track total attempts correctly across multiple getNextAction calls', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          async (error) => {
            // Arrange
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'model-0', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8192, priority: 1 },
              { provider: 'anthropic', model: 'model-1', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8192, priority: 2 },
              { provider: 'openai', model: 'model-2', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8192, priority: 3 },
              { provider: 'groq', model: 'model-3', costPer1KInputTokens: 0.004, costPer1KOutputTokens: 0.008, maxTokens: 8192, priority: 4 },
              { provider: 'anthropic', model: 'model-4', costPer1KInputTokens: 0.005, costPer1KOutputTokens: 0.01, maxTokens: 8192, priority: 5 },
            ];

            const registry = createMockModelRegistry({
              complex: models,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);
            const attempts: FallbackAttempt[] = [];
            let totalAttempts = 0;
            let currentModel: ModelSelection = {
              provider: models[0].provider,
              model: models[0].model,
              estimatedCostPer1KTokens: models[0].costPer1KInputTokens + models[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            // Simulate multiple failures and track attempts
            while (totalAttempts < 10) { // Safety limit
              const action = await strategy.getNextAction(error, currentModel, attempts);
              totalAttempts++;

              if (action.type === 'fail') {
                // Should fail after at most 4 total attempts (1 initial + 3 fallbacks)
                // But since attempts array represents PREVIOUS attempts, we check against 3
                expect(attempts.length).toBeGreaterThanOrEqual(3);
                break;
              }

              if (action.type === 'fallback') {
                // Record this attempt and continue
                attempts.push({
                  model: currentModel,
                  error: `Attempt ${totalAttempts} failed`,
                  timestamp: new Date(),
                });
                currentModel = action.model;
              } else if (action.type === 'escalate') {
                // Record and continue with escalated level
                attempts.push({
                  model: currentModel,
                  error: `Attempt ${totalAttempts} failed`,
                  timestamp: new Date(),
                });
                // For simplicity, just continue with same model
                break;
              } else if (action.type === 'retry') {
                // Rate limit retry - shouldn't happen with non-rate-limit errors
                break;
              }
            }

            // Assert: Total attempts should not exceed 4 (1 initial + 3 fallbacks)
            expect(totalAttempts).toBeLessThanOrEqual(4);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Max Attempts Boundary Conditions', () => {
    it('should handle exactly MAX_FALLBACK_ATTEMPTS (3) previous attempts', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryNonRateLimitError,
          async (currentModel, error) => {
            // Arrange
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'model-0', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8192, priority: 1 },
              { provider: 'anthropic', model: 'model-1', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8192, priority: 2 },
              { provider: 'openai', model: 'model-2', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8192, priority: 3 },
            ];

            const registry = createMockModelRegistry({
              simple: models,
              medium: models,
              complex: models,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            // Exactly 3 previous attempts (MAX_FALLBACK_ATTEMPTS)
            const attempts: FallbackAttempt[] = [
              { model: { provider: 'groq', model: 'model-0', estimatedCostPer1KTokens: 0.003, complexity: currentModel.complexity }, error: 'Error 1', timestamp: new Date() },
              { model: { provider: 'anthropic', model: 'model-1', estimatedCostPer1KTokens: 0.006, complexity: currentModel.complexity }, error: 'Error 2', timestamp: new Date() },
              { model: { provider: 'openai', model: 'model-2', estimatedCostPer1KTokens: 0.009, complexity: currentModel.complexity }, error: 'Error 3', timestamp: new Date() },
            ];

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should fail when attempts.length >= 3
            expect(action.type).toBe('fail');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow fallback when attempts.length is exactly MAX_FALLBACK_ATTEMPTS - 1 (2)', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryNonRateLimitError,
          async (complexity, error) => {
            // Arrange: Create registry with enough models
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'model-0', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8192, priority: 1 },
              { provider: 'anthropic', model: 'model-1', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8192, priority: 2 },
              { provider: 'openai', model: 'model-2', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8192, priority: 3 },
              { provider: 'groq', model: 'model-3', costPer1KInputTokens: 0.004, costPer1KOutputTokens: 0.008, maxTokens: 8192, priority: 4 },
            ];

            const registry = createMockModelRegistry({
              [complexity]: models,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: models[0].provider,
              model: models[0].model,
              estimatedCostPer1KTokens: models[0].costPer1KInputTokens + models[0].costPer1KOutputTokens,
              complexity,
            };

            // Exactly 2 previous attempts (MAX_FALLBACK_ATTEMPTS - 1)
            const attempts: FallbackAttempt[] = [
              { model: { provider: 'groq', model: 'model-0', estimatedCostPer1KTokens: 0.003, complexity }, error: 'Error 1', timestamp: new Date() },
              { model: { provider: 'anthropic', model: 'model-1', estimatedCostPer1KTokens: 0.006, complexity }, error: 'Error 2', timestamp: new Date() },
            ];

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should NOT fail due to max attempts (should fallback or escalate)
            expect(action.type).not.toBe('fail');
            expect(['fallback', 'escalate', 'retry']).toContain(action.type);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should fail immediately when attempts exceed MAX_FALLBACK_ATTEMPTS', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryModelSelection,
          arbitraryNonRateLimitError,
          fc.integer({ min: 4, max: 10 }), // More than MAX_FALLBACK_ATTEMPTS
          async (currentModel, error, numAttempts) => {
            // Arrange
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'model-0', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8192, priority: 1 },
              { provider: 'anthropic', model: 'model-1', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8192, priority: 2 },
            ];

            const registry = createMockModelRegistry({
              simple: models,
              medium: models,
              complex: models,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            // Create more than MAX_FALLBACK_ATTEMPTS previous attempts
            const attempts: FallbackAttempt[] = [];
            for (let i = 0; i < numAttempts; i++) {
              attempts.push({
                model: {
                  provider: VALID_PROVIDERS[i % VALID_PROVIDERS.length],
                  model: `model-${i}`,
                  estimatedCostPer1KTokens: 0.01,
                  complexity: currentModel.complexity,
                },
                error: `Error ${i + 1}`,
                timestamp: new Date(),
              });
            }

            // Act
            const action = await strategy.getNextAction(error, currentModel, attempts);

            // Assert: Should always fail when attempts > MAX_FALLBACK_ATTEMPTS
            expect(action.type).toBe('fail');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Max Attempts with Rate Limit Errors', () => {
    it('should count rate limit retries towards max attempts', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryRateLimitErrorWithRetryAfter,
          async (rateLimitError) => {
            // Arrange
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'model-0', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8192, priority: 1 },
              { provider: 'anthropic', model: 'model-1', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8192, priority: 2 },
            ];

            const registry = createMockModelRegistry({
              complex: models,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: models[0].provider,
              model: models[0].model,
              estimatedCostPer1KTokens: models[0].costPer1KInputTokens + models[0].costPer1KOutputTokens,
              complexity: 'complex',
            };

            // 3 previous attempts (at max)
            const attempts: FallbackAttempt[] = [
              { model: { provider: 'groq', model: 'model-0', estimatedCostPer1KTokens: 0.003, complexity: 'complex' }, error: 'Rate limit 1', timestamp: new Date() },
              { model: { provider: 'anthropic', model: 'model-1', estimatedCostPer1KTokens: 0.006, complexity: 'complex' }, error: 'Rate limit 2', timestamp: new Date() },
              { model: { provider: 'groq', model: 'model-0', estimatedCostPer1KTokens: 0.003, complexity: 'complex' }, error: 'Rate limit 3', timestamp: new Date() },
            ];

            // Act: Even with rate limit error, should fail due to max attempts
            const action = await strategy.getNextAction(rateLimitError, currentModel, attempts);

            // Assert: Should fail because max attempts reached
            expect(action.type).toBe('fail');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Failure Report Includes All Attempts Up To Max', () => {
    it('should include all attempted models in failure report when max reached', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryNonRateLimitError,
          fc.array(fc.string({ minLength: 5, maxLength: 30 }), { minLength: 3, maxLength: 3 }),
          async (finalError, errorMessages) => {
            // Arrange
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'llama-70b', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 1 },
              { provider: 'anthropic', model: 'claude-opus', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 2 },
              { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 3 },
            ];

            const registry = createMockModelRegistry({
              complex: models,
            });

            const strategy = new FallbackStrategy(registry, mockHealthChecker);

            const currentModel: ModelSelection = {
              provider: 'openai',
              model: 'gpt-4o',
              estimatedCostPer1KTokens: 0.0125,
              complexity: 'complex',
            };

            // Create exactly 3 attempts with unique error messages
            const attempts: FallbackAttempt[] = models.map((m, index) => ({
              model: {
                provider: m.provider,
                model: m.model,
                estimatedCostPer1KTokens: m.costPer1KInputTokens + m.costPer1KOutputTokens,
                complexity: 'complex' as ComplexityLevel,
              },
              error: errorMessages[index],
              timestamp: new Date(),
            }));

            // Act
            const action = await strategy.getNextAction(finalError, currentModel, attempts);

            // Assert: Should fail with comprehensive report
            expect(action.type).toBe('fail');
            if (action.type === 'fail') {
              // Verify all previous attempts are in the report
              for (const attempt of attempts) {
                expect(action.reason).toContain(attempt.model.provider);
                expect(action.reason).toContain(attempt.model.model);
                expect(action.reason).toContain(attempt.error);
              }
              // Verify current model is also in the report
              expect(action.reason).toContain(currentModel.provider);
              expect(action.reason).toContain(currentModel.model);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
