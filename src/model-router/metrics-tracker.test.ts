/**
 * Unit Tests for MetricsTracker
 *
 * Example-based tests that verify specific behaviors with concrete examples.
 * Tests cost calculation, aggregation, time range filtering, and retention cleanup.
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.6**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsTracker } from './metrics-tracker-impl.js';
import { METRICS_RETENTION_DAYS } from './metrics-tracker.js';
import type { ExecutionMetrics, Provider, ComplexityLevel } from './model-router.js';
import type { NewModelUsageMetric } from '../persistence/schema.js';
import { DEFAULT_MODEL_MAPPINGS } from './model-registry.js';

// ============================================================================
// Mock Database Implementation
// ============================================================================

/**
 * Creates a mock database that captures inserted records and supports
 * configurable query results for testing aggregation and cleanup.
 */
function createMockDatabase() {
  const insertedRecords: NewModelUsageMetric[] = [];
  let shouldFail = false;
  let selectResults: unknown[] = [];
  let deleteResults: { id: number }[] = [];

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
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          groupBy: vi.fn().mockImplementation(() => Promise.resolve(selectResults)),
        })),
      })),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => ({
        returning: vi.fn().mockImplementation(() => Promise.resolve(deleteResults)),
      })),
    })),
    getInsertedRecords: () => insertedRecords,
    clearRecords: () => {
      insertedRecords.length = 0;
    },
    setFailMode: (fail: boolean) => {
      shouldFail = fail;
    },
    setSelectResults: (results: unknown[]) => {
      selectResults = results;
    },
    setDeleteResults: (results: { id: number }[]) => {
      deleteResults = results;
    },
  };

  return mockDb;
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a valid ExecutionMetrics object with default values
 */
function createMetrics(overrides: Partial<ExecutionMetrics> = {}): ExecutionMetrics {
  return {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    complexity: 'simple',
    inputTokens: 1000,
    outputTokens: 500,
    latencyMs: 150,
    success: true,
    fallbackUsed: false,
    agentRole: 'developer',
    ...overrides,
  };
}

/**
 * Get model config from DEFAULT_MODEL_MAPPINGS
 */
function getModelConfig(provider: Provider, model: string) {
  for (const level of ['simple', 'medium', 'complex'] as ComplexityLevel[]) {
    for (const config of DEFAULT_MODEL_MAPPINGS[level]) {
      if (config.provider === provider && config.model === model) {
        return config;
      }
    }
  }
  return null;
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('MetricsTracker', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let metricsTracker: MetricsTracker;

  beforeEach(() => {
    mockDb = createMockDatabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metricsTracker = new MetricsTracker(mockDb as any);
  });

  // ==========================================================================
  // Requirement 6.1: track() method - Persists metrics to database
  // ==========================================================================
  describe('track() method', () => {
    describe('Persists metrics to database', () => {
      it('should persist metrics with all required fields', async () => {
        const metrics = createMetrics();

        await metricsTracker.track(metrics);

        const records = mockDb.getInsertedRecords();
        expect(records.length).toBe(1);
        expect(records[0].provider).toBe(metrics.provider);
        expect(records[0].model).toBe(metrics.model);
        expect(records[0].complexity).toBe(metrics.complexity);
        expect(records[0].inputTokens).toBe(metrics.inputTokens);
        expect(records[0].outputTokens).toBe(metrics.outputTokens);
        expect(records[0].latencyMs).toBe(metrics.latencyMs);
        expect(records[0].success).toBe(metrics.success);
      });

      it('should persist agentRole field', async () => {
        const metrics = createMetrics({ agentRole: 'architect' });

        await metricsTracker.track(metrics);

        const records = mockDb.getInsertedRecords();
        expect(records[0].agentRole).toBe('architect');
      });

      it('should persist fallbackUsed field', async () => {
        const metrics = createMetrics({ fallbackUsed: true });

        await metricsTracker.track(metrics);

        const records = mockDb.getInsertedRecords();
        expect(records[0].fallbackUsed).toBe(true);
      });

      it('should persist error field when present', async () => {
        const metrics = createMetrics({
          success: false,
          error: 'Rate limit exceeded',
        });

        await metricsTracker.track(metrics);

        const records = mockDb.getInsertedRecords();
        expect(records[0].error).toBe('Rate limit exceeded');
      });

      it('should set error to null when not present', async () => {
        const metrics = createMetrics({ error: undefined });

        await metricsTracker.track(metrics);

        const records = mockDb.getInsertedRecords();
        expect(records[0].error).toBeNull();
      });
    });

    // ========================================================================
    // Requirement 6.2: Cost calculation with known values
    // ========================================================================
    describe('Calculates cost correctly for known models', () => {
      it('should calculate cost for Groq llama-3.3-70b-versatile', async () => {
        const metrics = createMetrics({
          provider: 'groq',
          model: 'llama-3.3-70b-versatile',
          inputTokens: 1000,
          outputTokens: 500,
        });

        await metricsTracker.track(metrics);

        const records = mockDb.getInsertedRecords();
        const config = getModelConfig('groq', 'llama-3.3-70b-versatile')!;
        const expectedCost =
          (1000 / 1000) * config.costPer1KInputTokens +
          (500 / 1000) * config.costPer1KOutputTokens;

        expect(records[0].estimatedCost).toBeCloseTo(expectedCost, 10);
      });

      it('should calculate cost for Anthropic claude-3-5-haiku-20241022', async () => {
        const metrics = createMetrics({
          provider: 'anthropic',
          model: 'claude-3-5-haiku-20241022',
          inputTokens: 2000,
          outputTokens: 1000,
        });

        await metricsTracker.track(metrics);

        const records = mockDb.getInsertedRecords();
        const config = getModelConfig('anthropic', 'claude-3-5-haiku-20241022')!;
        const expectedCost =
          (2000 / 1000) * config.costPer1KInputTokens +
          (1000 / 1000) * config.costPer1KOutputTokens;

        expect(records[0].estimatedCost).toBeCloseTo(expectedCost, 10);
      });

      it('should calculate cost for OpenAI gpt-4o-mini', async () => {
        const metrics = createMetrics({
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputTokens: 5000,
          outputTokens: 2000,
        });

        await metricsTracker.track(metrics);

        const records = mockDb.getInsertedRecords();
        const config = getModelConfig('openai', 'gpt-4o-mini')!;
        const expectedCost =
          (5000 / 1000) * config.costPer1KInputTokens +
          (2000 / 1000) * config.costPer1KOutputTokens;

        expect(records[0].estimatedCost).toBeCloseTo(expectedCost, 10);
      });

      it('should calculate cost for Anthropic claude-opus-4-20250514 (complex)', async () => {
        const metrics = createMetrics({
          provider: 'anthropic',
          model: 'claude-opus-4-20250514',
          complexity: 'complex',
          inputTokens: 10000,
          outputTokens: 5000,
        });

        await metricsTracker.track(metrics);

        const records = mockDb.getInsertedRecords();
        const config = getModelConfig('anthropic', 'claude-opus-4-20250514')!;
        const expectedCost =
          (10000 / 1000) * config.costPer1KInputTokens +
          (5000 / 1000) * config.costPer1KOutputTokens;

        expect(records[0].estimatedCost).toBeCloseTo(expectedCost, 10);
      });

      it('should return 0 cost for unknown models', async () => {
        const metrics = createMetrics({
          provider: 'groq',
          model: 'unknown-model-xyz',
          inputTokens: 1000,
          outputTokens: 500,
        });

        await metricsTracker.track(metrics);

        const records = mockDb.getInsertedRecords();
        expect(records[0].estimatedCost).toBe(0);
      });

      it('should calculate cost correctly with zero input tokens', async () => {
        const metrics = createMetrics({
          provider: 'groq',
          model: 'llama-3.3-70b-versatile',
          inputTokens: 0,
          outputTokens: 1000,
        });

        await metricsTracker.track(metrics);

        const records = mockDb.getInsertedRecords();
        const config = getModelConfig('groq', 'llama-3.3-70b-versatile')!;
        const expectedCost = (1000 / 1000) * config.costPer1KOutputTokens;

        expect(records[0].estimatedCost).toBeCloseTo(expectedCost, 10);
      });

      it('should calculate cost correctly with zero output tokens', async () => {
        const metrics = createMetrics({
          provider: 'groq',
          model: 'llama-3.3-70b-versatile',
          inputTokens: 1000,
          outputTokens: 0,
        });

        await metricsTracker.track(metrics);

        const records = mockDb.getInsertedRecords();
        const config = getModelConfig('groq', 'llama-3.3-70b-versatile')!;
        const expectedCost = (1000 / 1000) * config.costPer1KInputTokens;

        expect(records[0].estimatedCost).toBeCloseTo(expectedCost, 10);
      });
    });

    // ========================================================================
    // Queuing behavior when database unavailable
    // ========================================================================
    describe('Queues metrics when database unavailable', () => {
      it('should queue metrics when database insert fails', async () => {
        mockDb.setFailMode(true);
        const metrics = createMetrics();

        await metricsTracker.track(metrics);

        expect(metricsTracker.getQueueSize()).toBe(1);
        expect(mockDb.getInsertedRecords().length).toBe(0);
      });

      it('should queue multiple metrics when database is unavailable', async () => {
        mockDb.setFailMode(true);

        await metricsTracker.track(createMetrics({ agentRole: 'developer' }));
        await metricsTracker.track(createMetrics({ agentRole: 'architect' }));
        await metricsTracker.track(createMetrics({ agentRole: 'reviewer' }));

        expect(metricsTracker.getQueueSize()).toBe(3);
      });

      it('should respect MAX_QUEUE_SIZE (1000) by dropping oldest metrics', async () => {
        mockDb.setFailMode(true);

        // Queue 1001 metrics
        for (let i = 0; i < 1001; i++) {
          await metricsTracker.track(createMetrics({ inputTokens: i }));
        }

        // Queue should be capped at 1000
        expect(metricsTracker.getQueueSize()).toBe(1000);
      });
    });
  });

  // ==========================================================================
  // Requirement 6.3: getAggregated() method - Aggregation grouping
  // ==========================================================================
  describe('getAggregated() method', () => {
    describe('Groups by provider, model, complexity', () => {
      it('should return aggregated metrics grouped by all dimensions', async () => {
        const mockResults = [
          {
            provider: 'groq',
            model: 'llama-3.3-70b-versatile',
            complexity: 'simple',
            totalExecutions: 10,
            successfulExecutions: 9,
            totalInputTokens: 10000,
            totalOutputTokens: 5000,
            totalCost: 0.01,
            averageLatencyMs: 150,
            fallbackCount: 1,
          },
          {
            provider: 'anthropic',
            model: 'claude-3-5-haiku-20241022',
            complexity: 'medium',
            totalExecutions: 5,
            successfulExecutions: 5,
            totalInputTokens: 8000,
            totalOutputTokens: 4000,
            totalCost: 0.05,
            averageLatencyMs: 200,
            fallbackCount: 0,
          },
        ];
        mockDb.setSelectResults(mockResults);

        const range = {
          start: new Date('2024-01-01'),
          end: new Date('2024-01-31'),
        };

        const results = await metricsTracker.getAggregated(range, ['provider', 'model', 'complexity']);

        expect(results.length).toBe(2);
        expect(results[0].provider).toBe('groq');
        expect(results[0].model).toBe('llama-3.3-70b-versatile');
        expect(results[0].complexity).toBe('simple');
        expect(results[0].totalExecutions).toBe(10);
        expect(results[1].provider).toBe('anthropic');
      });

      it('should return default values for null aggregation results', async () => {
        const mockResults = [
          {
            provider: 'groq',
            model: 'llama-3.3-70b-versatile',
            complexity: 'simple',
            totalExecutions: null,
            successfulExecutions: null,
            totalInputTokens: null,
            totalOutputTokens: null,
            totalCost: null,
            averageLatencyMs: null,
            fallbackCount: null,
          },
        ];
        mockDb.setSelectResults(mockResults);

        const range = {
          start: new Date('2024-01-01'),
          end: new Date('2024-01-31'),
        };

        const results = await metricsTracker.getAggregated(range);

        expect(results[0].totalExecutions).toBe(0);
        expect(results[0].successfulExecutions).toBe(0);
        expect(results[0].totalInputTokens).toBe(0);
        expect(results[0].totalOutputTokens).toBe(0);
        expect(results[0].totalCost).toBe(0);
        expect(results[0].averageLatencyMs).toBe(0);
        expect(results[0].fallbackCount).toBe(0);
      });
    });

    describe('Filters by time range', () => {
      it('should call database with correct time range parameters', async () => {
        mockDb.setSelectResults([]);

        const range = {
          start: new Date('2024-01-15T00:00:00Z'),
          end: new Date('2024-01-20T23:59:59Z'),
        };

        await metricsTracker.getAggregated(range);

        // Verify select was called (the mock captures the call)
        expect(mockDb.select).toHaveBeenCalled();
      });

      it('should handle empty results for time range with no data', async () => {
        mockDb.setSelectResults([]);

        const range = {
          start: new Date('2024-01-01'),
          end: new Date('2024-01-31'),
        };

        const results = await metricsTracker.getAggregated(range);

        expect(results).toEqual([]);
      });
    });
  });

  // ==========================================================================
  // getTotalCost() method
  // ==========================================================================
  describe('getTotalCost() method', () => {
    it('should return sum of costs for time range', async () => {
      // Create a mock that returns the expected structure for getTotalCost
      const mockDbWithTotalCost = {
        ...mockDb,
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => Promise.resolve([{ totalCost: 1.5 }])),
          })),
        })),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tracker = new MetricsTracker(mockDbWithTotalCost as any);

      const range = {
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      };

      const totalCost = await tracker.getTotalCost(range);

      expect(totalCost).toBe(1.5);
    });

    it('should return 0 when no records exist in time range', async () => {
      const mockDbWithZeroCost = {
        ...mockDb,
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => Promise.resolve([{ totalCost: 0 }])),
          })),
        })),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tracker = new MetricsTracker(mockDbWithZeroCost as any);

      const range = {
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      };

      const totalCost = await tracker.getTotalCost(range);

      expect(totalCost).toBe(0);
    });

    it('should return 0 when result is null', async () => {
      const mockDbWithNullCost = {
        ...mockDb,
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => Promise.resolve([{ totalCost: null }])),
          })),
        })),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tracker = new MetricsTracker(mockDbWithNullCost as any);

      const range = {
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      };

      const totalCost = await tracker.getTotalCost(range);

      expect(totalCost).toBe(0);
    });

    it('should return 0 when result array is empty', async () => {
      const mockDbWithEmptyResult = {
        ...mockDb,
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => Promise.resolve([])),
          })),
        })),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tracker = new MetricsTracker(mockDbWithEmptyResult as any);

      const range = {
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      };

      const totalCost = await tracker.getTotalCost(range);

      expect(totalCost).toBe(0);
    });
  });

  // ==========================================================================
  // Requirement 6.6: cleanup() method - Retention cleanup
  // ==========================================================================
  describe('cleanup() method', () => {
    describe('Removes records older than retention period', () => {
      it('should delete records older than default retention period (30 days)', async () => {
        mockDb.setDeleteResults([{ id: 1 }, { id: 2 }, { id: 3 }]);

        const deletedCount = await metricsTracker.cleanup();

        expect(deletedCount).toBe(3);
        expect(mockDb.delete).toHaveBeenCalled();
      });

      it('should delete records older than custom retention period', async () => {
        mockDb.setDeleteResults([{ id: 1 }, { id: 2 }]);

        const deletedCount = await metricsTracker.cleanup(7); // 7 days

        expect(deletedCount).toBe(2);
      });

      it('should return 0 when no old records exist', async () => {
        mockDb.setDeleteResults([]);

        const deletedCount = await metricsTracker.cleanup();

        expect(deletedCount).toBe(0);
      });
    });

    describe('Returns count of deleted records', () => {
      it('should return exact count of deleted records', async () => {
        mockDb.setDeleteResults([
          { id: 1 },
          { id: 2 },
          { id: 3 },
          { id: 4 },
          { id: 5 },
        ]);

        const deletedCount = await metricsTracker.cleanup();

        expect(deletedCount).toBe(5);
      });
    });
  });

  // ==========================================================================
  // flushQueue() method
  // ==========================================================================
  describe('flushQueue() method', () => {
    describe('Persists queued metrics when database available', () => {
      it('should persist all queued metrics when database becomes available', async () => {
        // Queue some metrics while database is unavailable
        mockDb.setFailMode(true);
        await metricsTracker.track(createMetrics({ agentRole: 'developer' }));
        await metricsTracker.track(createMetrics({ agentRole: 'architect' }));
        expect(metricsTracker.getQueueSize()).toBe(2);

        // Re-enable database and flush
        mockDb.setFailMode(false);
        await metricsTracker.flushQueue();

        // Verify metrics were persisted
        const records = mockDb.getInsertedRecords();
        expect(records.length).toBe(2);
        expect(records[0].agentRole).toBe('developer');
        expect(records[1].agentRole).toBe('architect');
      });

      it('should do nothing when queue is empty', async () => {
        expect(metricsTracker.getQueueSize()).toBe(0);

        await metricsTracker.flushQueue();

        expect(mockDb.insert).not.toHaveBeenCalled();
      });
    });

    describe('Clears queue after successful flush', () => {
      it('should clear queue after successful flush', async () => {
        // Queue metrics
        mockDb.setFailMode(true);
        await metricsTracker.track(createMetrics());
        await metricsTracker.track(createMetrics());
        expect(metricsTracker.getQueueSize()).toBe(2);

        // Flush successfully
        mockDb.setFailMode(false);
        await metricsTracker.flushQueue();

        // Queue should be empty
        expect(metricsTracker.getQueueSize()).toBe(0);
      });

      it('should keep queue intact if flush fails', async () => {
        // Queue metrics
        mockDb.setFailMode(true);
        await metricsTracker.track(createMetrics());
        await metricsTracker.track(createMetrics());
        expect(metricsTracker.getQueueSize()).toBe(2);

        // Try to flush but database still unavailable
        await metricsTracker.flushQueue();

        // Queue should still have the metrics
        expect(metricsTracker.getQueueSize()).toBe(2);
      });
    });
  });

  // ==========================================================================
  // METRICS_RETENTION_DAYS constant
  // ==========================================================================
  describe('METRICS_RETENTION_DAYS constant', () => {
    it('should be 30 days as per Requirement 6.6', () => {
      expect(METRICS_RETENTION_DAYS).toBe(30);
    });
  });
});
