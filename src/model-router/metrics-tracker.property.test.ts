/**
 * Property-Based Tests for Metrics Tracker
 * Feature: model-router, Property 14: Metrics Contain Required Fields
 *
 * **Validates: Requirements 6.1**
 *
 * Property 14: For any recorded execution metric, the metric record SHALL contain
 * all required fields: provider, model name, complexity level, input token count,
 * output token count, latency in milliseconds, and success status.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { MetricsTracker } from './metrics-tracker-impl.js';
import type { ExecutionMetrics, Provider, ComplexityLevel } from './model-router.js';
import type { AgentRole } from '../types/agents.js';
import type { NewModelUsageMetric } from '../persistence/schema.js';
import { DEFAULT_MODEL_MAPPINGS } from './model-registry.js';

// ============================================================================
// Fast-Check Arbitraries (Generators) for Execution Metrics
// ============================================================================

/**
 * Valid provider names as defined in the design document
 */
const VALID_PROVIDERS: Provider[] = ['groq', 'anthropic', 'openai'];

/**
 * Valid complexity levels as defined in the design document
 */
const VALID_COMPLEXITY_LEVELS: ComplexityLevel[] = ['simple', 'medium', 'complex'];

/**
 * Valid agent roles as defined in the types
 */
const VALID_AGENT_ROLES: AgentRole[] = [
  'coordinator',
  'architect',
  'developer',
  'reviewer',
  'qa',
  'devops',
  'planner',
  'memory',
];

/**
 * Generates arbitrary valid provider names
 */
const arbitraryProvider = fc.constantFrom<Provider>(...VALID_PROVIDERS);

/**
 * Generates arbitrary valid complexity levels
 */
const arbitraryComplexityLevel = fc.constantFrom<ComplexityLevel>(...VALID_COMPLEXITY_LEVELS);

/**
 * Generates arbitrary valid agent roles
 */
const arbitraryAgentRole = fc.constantFrom<AgentRole>(...VALID_AGENT_ROLES);

/**
 * Generates arbitrary model names (non-empty strings)
 */
const arbitraryModelName = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_.'.split('')),
  { minLength: 1, maxLength: 50 }
);

/**
 * Generates arbitrary non-negative token counts
 */
const arbitraryTokenCount = fc.integer({ min: 0, max: 100000 });

/**
 * Generates arbitrary non-negative latency in milliseconds
 */
const arbitraryLatencyMs = fc.integer({ min: 0, max: 300000 }); // Up to 5 minutes

/**
 * Generates arbitrary success status
 */
const arbitrarySuccess = fc.boolean();

/**
 * Generates arbitrary fallback used status
 */
const arbitraryFallbackUsed = fc.boolean();

/**
 * Generates arbitrary optional error message
 */
const arbitraryOptionalError = fc.option(
  fc.string({ minLength: 1, maxLength: 200 }),
  { nil: undefined }
);

/**
 * Generates a complete valid ExecutionMetrics object with all required fields
 */
const arbitraryValidExecutionMetrics: fc.Arbitrary<ExecutionMetrics> = fc.record({
  provider: arbitraryProvider,
  model: arbitraryModelName,
  complexity: arbitraryComplexityLevel,
  inputTokens: arbitraryTokenCount,
  outputTokens: arbitraryTokenCount,
  latencyMs: arbitraryLatencyMs,
  success: arbitrarySuccess,
  error: arbitraryOptionalError,
  fallbackUsed: arbitraryFallbackUsed,
  agentRole: arbitraryAgentRole,
});

// ============================================================================
// Mock Database Implementation
// ============================================================================

/**
 * Creates a mock database that captures inserted records for verification
 */
function createMockDatabase() {
  const insertedRecords: NewModelUsageMetric[] = [];
  let shouldFail = false;

  const mockDb = {
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((record: NewModelUsageMetric | NewModelUsageMetric[]) => {
        if (shouldFail) {
          return Promise.reject(new Error('Database unavailable'));
        }
        const records = Array.isArray(record) ? record : [record];
        insertedRecords.push(...records);
        return Promise.resolve();
      }),
    })),
    select: vi.fn(),
    delete: vi.fn(),
    getInsertedRecords: () => insertedRecords,
    clearRecords: () => {
      insertedRecords.length = 0;
    },
    setFailMode: (fail: boolean) => {
      shouldFail = fail;
    },
  };

  return mockDb;
}

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Property 14: Metrics Contain Required Fields', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let metricsTracker: MetricsTracker;

  beforeEach(() => {
    mockDb = createMockDatabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metricsTracker = new MetricsTracker(mockDb as any);
  });

  // ==========================================================================
  // Property: Every recorded metric contains all required fields
  // ==========================================================================

  /**
   * **Validates: Requirements 6.1**
   *
   * Property: Every recorded metric SHALL contain: provider, model, complexity,
   * inputTokens, outputTokens, latencyMs, success
   */
  describe('Required Fields Present in Recorded Metrics', () => {
    it('should persist metrics with all required fields for any valid input', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          // Arrange
          mockDb.clearRecords();

          // Act
          await metricsTracker.track(metrics);

          // Assert: Verify the record was inserted
          const records = mockDb.getInsertedRecords();
          expect(records.length).toBe(1);

          const record = records[0];

          // Assert: All required fields are present and have correct values
          expect(record.provider).toBe(metrics.provider);
          expect(record.model).toBe(metrics.model);
          expect(record.complexity).toBe(metrics.complexity);
          expect(record.inputTokens).toBe(metrics.inputTokens);
          expect(record.outputTokens).toBe(metrics.outputTokens);
          expect(record.latencyMs).toBe(metrics.latencyMs);
          expect(record.success).toBe(metrics.success);
        }),
        { numRuns: 100 }
      );
    });

    it('should include provider field in every recorded metric', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          // Arrange
          mockDb.clearRecords();

          // Act
          await metricsTracker.track(metrics);

          // Assert
          const records = mockDb.getInsertedRecords();
          expect(records.length).toBe(1);
          expect(records[0].provider).toBeDefined();
          expect(records[0].provider).toBe(metrics.provider);
          expect(VALID_PROVIDERS).toContain(records[0].provider);
        }),
        { numRuns: 100 }
      );
    });

    it('should include model field in every recorded metric', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          // Arrange
          mockDb.clearRecords();

          // Act
          await metricsTracker.track(metrics);

          // Assert
          const records = mockDb.getInsertedRecords();
          expect(records.length).toBe(1);
          expect(records[0].model).toBeDefined();
          expect(records[0].model).toBe(metrics.model);
          expect(typeof records[0].model).toBe('string');
          expect(records[0].model.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should include complexity field in every recorded metric', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          // Arrange
          mockDb.clearRecords();

          // Act
          await metricsTracker.track(metrics);

          // Assert
          const records = mockDb.getInsertedRecords();
          expect(records.length).toBe(1);
          expect(records[0].complexity).toBeDefined();
          expect(records[0].complexity).toBe(metrics.complexity);
          expect(VALID_COMPLEXITY_LEVELS).toContain(records[0].complexity);
        }),
        { numRuns: 100 }
      );
    });

    it('should include inputTokens field in every recorded metric', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          // Arrange
          mockDb.clearRecords();

          // Act
          await metricsTracker.track(metrics);

          // Assert
          const records = mockDb.getInsertedRecords();
          expect(records.length).toBe(1);
          expect(records[0].inputTokens).toBeDefined();
          expect(records[0].inputTokens).toBe(metrics.inputTokens);
          expect(typeof records[0].inputTokens).toBe('number');
          expect(records[0].inputTokens).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should include outputTokens field in every recorded metric', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          // Arrange
          mockDb.clearRecords();

          // Act
          await metricsTracker.track(metrics);

          // Assert
          const records = mockDb.getInsertedRecords();
          expect(records.length).toBe(1);
          expect(records[0].outputTokens).toBeDefined();
          expect(records[0].outputTokens).toBe(metrics.outputTokens);
          expect(typeof records[0].outputTokens).toBe('number');
          expect(records[0].outputTokens).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should include latencyMs field in every recorded metric', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          // Arrange
          mockDb.clearRecords();

          // Act
          await metricsTracker.track(metrics);

          // Assert
          const records = mockDb.getInsertedRecords();
          expect(records.length).toBe(1);
          expect(records[0].latencyMs).toBeDefined();
          expect(records[0].latencyMs).toBe(metrics.latencyMs);
          expect(typeof records[0].latencyMs).toBe('number');
          expect(records[0].latencyMs).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should include success field in every recorded metric', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          // Arrange
          mockDb.clearRecords();

          // Act
          await metricsTracker.track(metrics);

          // Assert
          const records = mockDb.getInsertedRecords();
          expect(records.length).toBe(1);
          expect(records[0].success).toBeDefined();
          expect(records[0].success).toBe(metrics.success);
          expect(typeof records[0].success).toBe('boolean');
        }),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Required fields have correct types
  // ==========================================================================

  /**
   * **Validates: Requirements 6.1**
   *
   * Property: All required fields SHALL have the correct data types.
   */
  describe('Required Fields Have Correct Types', () => {
    it('should store provider as a string', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          mockDb.clearRecords();
          await metricsTracker.track(metrics);
          const records = mockDb.getInsertedRecords();
          expect(typeof records[0].provider).toBe('string');
        }),
        { numRuns: 100 }
      );
    });

    it('should store model as a string', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          mockDb.clearRecords();
          await metricsTracker.track(metrics);
          const records = mockDb.getInsertedRecords();
          expect(typeof records[0].model).toBe('string');
        }),
        { numRuns: 100 }
      );
    });

    it('should store complexity as a string', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          mockDb.clearRecords();
          await metricsTracker.track(metrics);
          const records = mockDb.getInsertedRecords();
          expect(typeof records[0].complexity).toBe('string');
        }),
        { numRuns: 100 }
      );
    });

    it('should store inputTokens as a number', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          mockDb.clearRecords();
          await metricsTracker.track(metrics);
          const records = mockDb.getInsertedRecords();
          expect(typeof records[0].inputTokens).toBe('number');
        }),
        { numRuns: 100 }
      );
    });

    it('should store outputTokens as a number', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          mockDb.clearRecords();
          await metricsTracker.track(metrics);
          const records = mockDb.getInsertedRecords();
          expect(typeof records[0].outputTokens).toBe('number');
        }),
        { numRuns: 100 }
      );
    });

    it('should store latencyMs as a number', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          mockDb.clearRecords();
          await metricsTracker.track(metrics);
          const records = mockDb.getInsertedRecords();
          expect(typeof records[0].latencyMs).toBe('number');
        }),
        { numRuns: 100 }
      );
    });

    it('should store success as a boolean', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          mockDb.clearRecords();
          await metricsTracker.track(metrics);
          const records = mockDb.getInsertedRecords();
          expect(typeof records[0].success).toBe('boolean');
        }),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Metrics are queued when database is unavailable
  // ==========================================================================

  /**
   * **Validates: Requirements 6.1**
   *
   * Property: When database is unavailable, metrics SHALL be queued in memory
   * and still contain all required fields when flushed.
   */
  describe('Queued Metrics Contain Required Fields', () => {
    it('should queue metrics with all required fields when database is unavailable', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          // Arrange: Set database to fail mode
          mockDb.clearRecords();
          mockDb.setFailMode(true);

          // Act: Track metrics (should be queued)
          await metricsTracker.track(metrics);

          // Assert: Verify metrics are queued
          expect(metricsTracker.getQueueSize()).toBe(1);

          // Arrange: Re-enable database
          mockDb.setFailMode(false);

          // Act: Flush the queue
          await metricsTracker.flushQueue();

          // Assert: Verify the flushed record has all required fields
          const records = mockDb.getInsertedRecords();
          expect(records.length).toBe(1);

          const record = records[0];
          expect(record.provider).toBe(metrics.provider);
          expect(record.model).toBe(metrics.model);
          expect(record.complexity).toBe(metrics.complexity);
          expect(record.inputTokens).toBe(metrics.inputTokens);
          expect(record.outputTokens).toBe(metrics.outputTokens);
          expect(record.latencyMs).toBe(metrics.latencyMs);
          expect(record.success).toBe(metrics.success);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve all required fields through queue and flush cycle', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(arbitraryValidExecutionMetrics, { minLength: 1, maxLength: 10 }),
          async (metricsArray) => {
            // Arrange: Set database to fail mode
            mockDb.clearRecords();
            mockDb.setFailMode(true);

            // Act: Track multiple metrics (should be queued)
            for (const metrics of metricsArray) {
              await metricsTracker.track(metrics);
            }

            // Assert: Verify all metrics are queued
            expect(metricsTracker.getQueueSize()).toBe(metricsArray.length);

            // Arrange: Re-enable database
            mockDb.setFailMode(false);

            // Act: Flush the queue
            await metricsTracker.flushQueue();

            // Assert: Verify all flushed records have required fields
            const records = mockDb.getInsertedRecords();
            expect(records.length).toBe(metricsArray.length);

            for (let i = 0; i < metricsArray.length; i++) {
              const record = records[i];
              const original = metricsArray[i];

              expect(record.provider).toBe(original.provider);
              expect(record.model).toBe(original.model);
              expect(record.complexity).toBe(original.complexity);
              expect(record.inputTokens).toBe(original.inputTokens);
              expect(record.outputTokens).toBe(original.outputTokens);
              expect(record.latencyMs).toBe(original.latencyMs);
              expect(record.success).toBe(original.success);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Additional fields are also preserved
  // ==========================================================================

  /**
   * **Validates: Requirements 6.1**
   *
   * Property: Additional fields (error, fallbackUsed, agentRole) SHALL also
   * be preserved in the recorded metric.
   */
  describe('Additional Fields Are Preserved', () => {
    it('should preserve error field when present', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryValidExecutionMetrics.filter((m) => m.error !== undefined),
          async (metrics) => {
            mockDb.clearRecords();
            await metricsTracker.track(metrics);
            const records = mockDb.getInsertedRecords();
            expect(records[0].error).toBe(metrics.error);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should set error to null when not present', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryValidExecutionMetrics.filter((m) => m.error === undefined),
          async (metrics) => {
            mockDb.clearRecords();
            await metricsTracker.track(metrics);
            const records = mockDb.getInsertedRecords();
            expect(records[0].error).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve fallbackUsed field', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          mockDb.clearRecords();
          await metricsTracker.track(metrics);
          const records = mockDb.getInsertedRecords();
          expect(records[0].fallbackUsed).toBe(metrics.fallbackUsed);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve agentRole field', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          mockDb.clearRecords();
          await metricsTracker.track(metrics);
          const records = mockDb.getInsertedRecords();
          expect(records[0].agentRole).toBe(metrics.agentRole);
        }),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Estimated cost is calculated and included
  // ==========================================================================

  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * Property: Every recorded metric SHALL include an estimated cost field.
   */
  describe('Estimated Cost Is Included', () => {
    it('should include estimatedCost field in every recorded metric', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          mockDb.clearRecords();
          await metricsTracker.track(metrics);
          const records = mockDb.getInsertedRecords();
          expect(records[0].estimatedCost).toBeDefined();
          expect(typeof records[0].estimatedCost).toBe('number');
          expect(records[0].estimatedCost).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 }
      );
    });
  });
});


// ============================================================================
// Property 15: Cost Calculation Accuracy
// ============================================================================

/**
 * Property-Based Tests for Property 15: Cost Calculation Accuracy
 *
 * **Validates: Requirements 6.2**
 *
 * Property 15: For any execution with known input tokens, output tokens, and
 * provider pricing, the calculated estimated cost SHALL equal:
 * (inputTokens / 1000 * inputCostPer1K) + (outputTokens / 1000 * outputCostPer1K)
 */
describe('Property 15: Cost Calculation Accuracy', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let metricsTracker: MetricsTracker;

  beforeEach(() => {
    mockDb = createMockDatabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metricsTracker = new MetricsTracker(mockDb as any);
  });

  // ==========================================================================
  // Helper: Get model config from DEFAULT_MODEL_MAPPINGS
  // ==========================================================================

  /**
   * Retrieves model configuration from DEFAULT_MODEL_MAPPINGS
   */
  function getModelConfig(provider: Provider, model: string): { costPer1KInputTokens: number; costPer1KOutputTokens: number } | null {
    for (const level of ['simple', 'medium', 'complex'] as ComplexityLevel[]) {
      for (const config of DEFAULT_MODEL_MAPPINGS[level]) {
        if (config.provider === provider && config.model === model) {
          return {
            costPer1KInputTokens: config.costPer1KInputTokens,
            costPer1KOutputTokens: config.costPer1KOutputTokens,
          };
        }
      }
    }
    return null;
  }

  /**
   * Calculate expected cost using the formula from Requirements 6.2
   */
  function calculateExpectedCost(
    inputTokens: number,
    outputTokens: number,
    costPer1KInputTokens: number,
    costPer1KOutputTokens: number
  ): number {
    return (inputTokens / 1000) * costPer1KInputTokens + (outputTokens / 1000) * costPer1KOutputTokens;
  }

  // ==========================================================================
  // Arbitraries for known models from DEFAULT_MODEL_MAPPINGS
  // ==========================================================================

  /**
   * Generates arbitrary known model configurations from DEFAULT_MODEL_MAPPINGS
   */
  const arbitraryKnownModel = fc.constantFrom(
    ...Object.values(DEFAULT_MODEL_MAPPINGS).flatMap((models) =>
      models.map((m) => ({ provider: m.provider, model: m.model }))
    )
  );

  /**
   * Generates arbitrary token counts for testing
   * Includes edge cases: 0, small values, and large values
   */
  const arbitraryTokenCountForCost = fc.oneof(
    fc.constant(0),                           // Zero tokens
    fc.integer({ min: 1, max: 100 }),         // Small token counts
    fc.integer({ min: 101, max: 10000 }),     // Medium token counts
    fc.integer({ min: 10001, max: 1000000 })  // Large token counts
  );

  /**
   * Generates execution metrics with known models from DEFAULT_MODEL_MAPPINGS
   */
  const arbitraryKnownModelMetrics: fc.Arbitrary<ExecutionMetrics> = fc
    .record({
      knownModel: arbitraryKnownModel,
      complexity: arbitraryComplexityLevel,
      inputTokens: arbitraryTokenCountForCost,
      outputTokens: arbitraryTokenCountForCost,
      latencyMs: arbitraryLatencyMs,
      success: arbitrarySuccess,
      error: arbitraryOptionalError,
      fallbackUsed: arbitraryFallbackUsed,
      agentRole: arbitraryAgentRole,
    })
    .map((record) => ({
      provider: record.knownModel.provider,
      model: record.knownModel.model,
      complexity: record.complexity,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      latencyMs: record.latencyMs,
      success: record.success,
      error: record.error,
      fallbackUsed: record.fallbackUsed,
      agentRole: record.agentRole,
    }));

  /**
   * Generates execution metrics with unknown models (not in DEFAULT_MODEL_MAPPINGS)
   */
  const arbitraryUnknownModelMetrics: fc.Arbitrary<ExecutionMetrics> = fc.record({
    provider: arbitraryProvider,
    model: fc.string({ minLength: 10, maxLength: 30 }).map((s) => `unknown-model-${s}`),
    complexity: arbitraryComplexityLevel,
    inputTokens: arbitraryTokenCountForCost,
    outputTokens: arbitraryTokenCountForCost,
    latencyMs: arbitraryLatencyMs,
    success: arbitrarySuccess,
    error: arbitraryOptionalError,
    fallbackUsed: arbitraryFallbackUsed,
    agentRole: arbitraryAgentRole,
  });

  // ==========================================================================
  // Property: Cost calculation follows the formula for known models
  // ==========================================================================

  /**
   * **Validates: Requirements 6.2**
   *
   * Property: For known models, estimated cost SHALL equal:
   * (inputTokens / 1000 * inputCostPer1K) + (outputTokens / 1000 * outputCostPer1K)
   */
  describe('Cost Formula Accuracy for Known Models', () => {
    it('should calculate cost correctly using the formula for any known model', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryKnownModelMetrics, async (metrics) => {
          // Arrange
          mockDb.clearRecords();
          const modelConfig = getModelConfig(metrics.provider, metrics.model);
          expect(modelConfig).not.toBeNull();

          // Act
          await metricsTracker.track(metrics);

          // Assert
          const records = mockDb.getInsertedRecords();
          expect(records.length).toBe(1);

          const expectedCost = calculateExpectedCost(
            metrics.inputTokens,
            metrics.outputTokens,
            modelConfig!.costPer1KInputTokens,
            modelConfig!.costPer1KOutputTokens
          );

          // Use closeTo for floating point comparison
          expect(records[0].estimatedCost).toBeCloseTo(expectedCost, 10);
        }),
        { numRuns: 100 }
      );
    });

    it('should calculate input cost component correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryKnownModel,
          arbitraryTokenCountForCost,
          arbitraryAgentRole,
          async (knownModel, inputTokens, agentRole) => {
            // Arrange
            mockDb.clearRecords();
            const modelConfig = getModelConfig(knownModel.provider, knownModel.model);
            expect(modelConfig).not.toBeNull();

            const metrics: ExecutionMetrics = {
              provider: knownModel.provider,
              model: knownModel.model,
              complexity: 'simple',
              inputTokens,
              outputTokens: 0, // Zero output tokens to isolate input cost
              latencyMs: 100,
              success: true,
              fallbackUsed: false,
              agentRole,
            };

            // Act
            await metricsTracker.track(metrics);

            // Assert
            const records = mockDb.getInsertedRecords();
            const expectedInputCost = (inputTokens / 1000) * modelConfig!.costPer1KInputTokens;
            expect(records[0].estimatedCost).toBeCloseTo(expectedInputCost, 10);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate output cost component correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryKnownModel,
          arbitraryTokenCountForCost,
          arbitraryAgentRole,
          async (knownModel, outputTokens, agentRole) => {
            // Arrange
            mockDb.clearRecords();
            const modelConfig = getModelConfig(knownModel.provider, knownModel.model);
            expect(modelConfig).not.toBeNull();

            const metrics: ExecutionMetrics = {
              provider: knownModel.provider,
              model: knownModel.model,
              complexity: 'simple',
              inputTokens: 0, // Zero input tokens to isolate output cost
              outputTokens,
              latencyMs: 100,
              success: true,
              fallbackUsed: false,
              agentRole,
            };

            // Act
            await metricsTracker.track(metrics);

            // Assert
            const records = mockDb.getInsertedRecords();
            const expectedOutputCost = (outputTokens / 1000) * modelConfig!.costPer1KOutputTokens;
            expect(records[0].estimatedCost).toBeCloseTo(expectedOutputCost, 10);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Cost is 0 for unknown models
  // ==========================================================================

  /**
   * **Validates: Requirements 6.2**
   *
   * Property: For unknown models (not in registry), estimated cost SHALL be 0.
   */
  describe('Cost for Unknown Models', () => {
    it('should return 0 cost for models not in DEFAULT_MODEL_MAPPINGS', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryUnknownModelMetrics, async (metrics) => {
          // Arrange
          mockDb.clearRecords();

          // Verify the model is actually unknown
          const modelConfig = getModelConfig(metrics.provider, metrics.model);
          expect(modelConfig).toBeNull();

          // Act
          await metricsTracker.track(metrics);

          // Assert
          const records = mockDb.getInsertedRecords();
          expect(records.length).toBe(1);
          expect(records[0].estimatedCost).toBe(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Cost calculation with various token counts
  // ==========================================================================

  /**
   * **Validates: Requirements 6.2**
   *
   * Property: Cost calculation SHALL work correctly with edge case token counts.
   */
  describe('Cost Calculation Edge Cases', () => {
    it('should calculate 0 cost when both input and output tokens are 0', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryKnownModel, arbitraryAgentRole, async (knownModel, agentRole) => {
          // Arrange
          mockDb.clearRecords();

          const metrics: ExecutionMetrics = {
            provider: knownModel.provider,
            model: knownModel.model,
            complexity: 'simple',
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 100,
            success: true,
            fallbackUsed: false,
            agentRole,
          };

          // Act
          await metricsTracker.track(metrics);

          // Assert
          const records = mockDb.getInsertedRecords();
          expect(records[0].estimatedCost).toBe(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should calculate cost correctly for small token counts (1-100)', async () => {
      const smallTokenCount = fc.integer({ min: 1, max: 100 });

      await fc.assert(
        fc.asyncProperty(
          arbitraryKnownModel,
          smallTokenCount,
          smallTokenCount,
          arbitraryAgentRole,
          async (knownModel, inputTokens, outputTokens, agentRole) => {
            // Arrange
            mockDb.clearRecords();
            const modelConfig = getModelConfig(knownModel.provider, knownModel.model);
            expect(modelConfig).not.toBeNull();

            const metrics: ExecutionMetrics = {
              provider: knownModel.provider,
              model: knownModel.model,
              complexity: 'simple',
              inputTokens,
              outputTokens,
              latencyMs: 100,
              success: true,
              fallbackUsed: false,
              agentRole,
            };

            // Act
            await metricsTracker.track(metrics);

            // Assert
            const records = mockDb.getInsertedRecords();
            const expectedCost = calculateExpectedCost(
              inputTokens,
              outputTokens,
              modelConfig!.costPer1KInputTokens,
              modelConfig!.costPer1KOutputTokens
            );
            expect(records[0].estimatedCost).toBeCloseTo(expectedCost, 10);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate cost correctly for large token counts (10000+)', async () => {
      const largeTokenCount = fc.integer({ min: 10000, max: 1000000 });

      await fc.assert(
        fc.asyncProperty(
          arbitraryKnownModel,
          largeTokenCount,
          largeTokenCount,
          arbitraryAgentRole,
          async (knownModel, inputTokens, outputTokens, agentRole) => {
            // Arrange
            mockDb.clearRecords();
            const modelConfig = getModelConfig(knownModel.provider, knownModel.model);
            expect(modelConfig).not.toBeNull();

            const metrics: ExecutionMetrics = {
              provider: knownModel.provider,
              model: knownModel.model,
              complexity: 'complex',
              inputTokens,
              outputTokens,
              latencyMs: 5000,
              success: true,
              fallbackUsed: false,
              agentRole,
            };

            // Act
            await metricsTracker.track(metrics);

            // Assert
            const records = mockDb.getInsertedRecords();
            const expectedCost = calculateExpectedCost(
              inputTokens,
              outputTokens,
              modelConfig!.costPer1KInputTokens,
              modelConfig!.costPer1KOutputTokens
            );
            expect(records[0].estimatedCost).toBeCloseTo(expectedCost, 10);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Cost is always non-negative
  // ==========================================================================

  /**
   * **Validates: Requirements 6.2**
   *
   * Property: Estimated cost SHALL always be non-negative.
   */
  describe('Cost Non-Negativity', () => {
    it('should always produce non-negative cost for any valid input', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidExecutionMetrics, async (metrics) => {
          // Arrange
          mockDb.clearRecords();

          // Act
          await metricsTracker.track(metrics);

          // Assert
          const records = mockDb.getInsertedRecords();
          expect(records[0].estimatedCost).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // Property: Cost calculation is consistent across all providers
  // ==========================================================================

  /**
   * **Validates: Requirements 6.2**
   *
   * Property: Cost calculation SHALL be consistent for each provider's models.
   */
  describe('Cost Consistency Across Providers', () => {
    it('should calculate cost consistently for Groq models', async () => {
      const groqModels = Object.values(DEFAULT_MODEL_MAPPINGS)
        .flatMap((models) => models)
        .filter((m) => m.provider === 'groq');

      const arbitraryGroqModel = fc.constantFrom(...groqModels);

      await fc.assert(
        fc.asyncProperty(
          arbitraryGroqModel,
          arbitraryTokenCountForCost,
          arbitraryTokenCountForCost,
          arbitraryAgentRole,
          async (modelConfig, inputTokens, outputTokens, agentRole) => {
            // Arrange
            mockDb.clearRecords();

            const metrics: ExecutionMetrics = {
              provider: modelConfig.provider,
              model: modelConfig.model,
              complexity: 'simple',
              inputTokens,
              outputTokens,
              latencyMs: 100,
              success: true,
              fallbackUsed: false,
              agentRole,
            };

            // Act
            await metricsTracker.track(metrics);

            // Assert
            const records = mockDb.getInsertedRecords();
            const expectedCost = calculateExpectedCost(
              inputTokens,
              outputTokens,
              modelConfig.costPer1KInputTokens,
              modelConfig.costPer1KOutputTokens
            );
            expect(records[0].estimatedCost).toBeCloseTo(expectedCost, 10);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate cost consistently for Anthropic models', async () => {
      const anthropicModels = Object.values(DEFAULT_MODEL_MAPPINGS)
        .flatMap((models) => models)
        .filter((m) => m.provider === 'anthropic');

      const arbitraryAnthropicModel = fc.constantFrom(...anthropicModels);

      await fc.assert(
        fc.asyncProperty(
          arbitraryAnthropicModel,
          arbitraryTokenCountForCost,
          arbitraryTokenCountForCost,
          arbitraryAgentRole,
          async (modelConfig, inputTokens, outputTokens, agentRole) => {
            // Arrange
            mockDb.clearRecords();

            const metrics: ExecutionMetrics = {
              provider: modelConfig.provider,
              model: modelConfig.model,
              complexity: 'medium',
              inputTokens,
              outputTokens,
              latencyMs: 200,
              success: true,
              fallbackUsed: false,
              agentRole,
            };

            // Act
            await metricsTracker.track(metrics);

            // Assert
            const records = mockDb.getInsertedRecords();
            const expectedCost = calculateExpectedCost(
              inputTokens,
              outputTokens,
              modelConfig.costPer1KInputTokens,
              modelConfig.costPer1KOutputTokens
            );
            expect(records[0].estimatedCost).toBeCloseTo(expectedCost, 10);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate cost consistently for OpenAI models', async () => {
      const openaiModels = Object.values(DEFAULT_MODEL_MAPPINGS)
        .flatMap((models) => models)
        .filter((m) => m.provider === 'openai');

      const arbitraryOpenAIModel = fc.constantFrom(...openaiModels);

      await fc.assert(
        fc.asyncProperty(
          arbitraryOpenAIModel,
          arbitraryTokenCountForCost,
          arbitraryTokenCountForCost,
          arbitraryAgentRole,
          async (modelConfig, inputTokens, outputTokens, agentRole) => {
            // Arrange
            mockDb.clearRecords();

            const metrics: ExecutionMetrics = {
              provider: modelConfig.provider,
              model: modelConfig.model,
              complexity: 'complex',
              inputTokens,
              outputTokens,
              latencyMs: 300,
              success: true,
              fallbackUsed: false,
              agentRole,
            };

            // Act
            await metricsTracker.track(metrics);

            // Assert
            const records = mockDb.getInsertedRecords();
            const expectedCost = calculateExpectedCost(
              inputTokens,
              outputTokens,
              modelConfig.costPer1KInputTokens,
              modelConfig.costPer1KOutputTokens
            );
            expect(records[0].estimatedCost).toBeCloseTo(expectedCost, 10);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
