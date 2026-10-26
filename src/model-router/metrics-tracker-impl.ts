/**
 * MetricsTracker Implementation
 *
 * Tracks and persists model usage metrics to PostgreSQL.
 * Includes in-memory queue for resilience when database is unavailable.
 *
 * @implements {IMetricsTracker}
 */

import { eq, and, gte, lte, sql, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ExecutionMetrics, Provider, ComplexityLevel } from './model-router.js';
import type { IMetricsTracker, AggregatedMetrics, TimeRange } from './metrics-tracker.js';
import { METRICS_RETENTION_DAYS } from './metrics-tracker.js';
import { modelUsageMetrics, type NewModelUsageMetric } from '../persistence/schema.js';
import { DEFAULT_MODEL_MAPPINGS, type ModelConfig } from './model-registry.js';

/** Maximum number of metrics to queue when database is unavailable */
const MAX_QUEUE_SIZE = 1000;

/**
 * MetricsTracker Implementation
 *
 * Tracks and persists model usage metrics to PostgreSQL.
 * Provides aggregation, cost calculation, and cleanup functionality.
 */
export class MetricsTracker implements IMetricsTracker {
  private db: PostgresJsDatabase;
  private queue: NewModelUsageMetric[] = [];
  private modelConfigCache: Map<string, ModelConfig>;

  constructor(db: PostgresJsDatabase) {
    this.db = db;
    this.modelConfigCache = this.buildModelConfigCache();
  }

  /**
   * Build a cache of model configurations for cost lookups.
   */
  private buildModelConfigCache(): Map<string, ModelConfig> {
    const cache = new Map<string, ModelConfig>();
    for (const level of ['simple', 'medium', 'complex'] as ComplexityLevel[]) {
      for (const config of DEFAULT_MODEL_MAPPINGS[level]) {
        const key = `${config.provider}:${config.model}`;
        cache.set(key, config);
      }
    }
    return cache;
  }

  /**
   * Get model configuration for cost calculation.
   */
  private getModelConfig(provider: Provider, model: string): ModelConfig | null {
    const key = `${provider}:${model}`;
    return this.modelConfigCache.get(key) ?? null;
  }

  /**
   * Calculate estimated cost for an execution.
   * Cost = (inputTokens / 1000 * inputCostPer1K) + (outputTokens / 1000 * outputCostPer1K)
   */
  private calculateCost(
    provider: Provider,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const config = this.getModelConfig(provider, model);
    if (!config) {
      // Default to 0 if model config not found
      return 0;
    }
    const inputCost = (inputTokens / 1000) * config.costPer1KInputTokens;
    const outputCost = (outputTokens / 1000) * config.costPer1KOutputTokens;
    return inputCost + outputCost;
  }

  /**
   * Record a single execution's metrics.
   * Queues metrics in memory if database is unavailable.
   */
  async track(metrics: ExecutionMetrics): Promise<void> {
    const estimatedCost = this.calculateCost(
      metrics.provider,
      metrics.model,
      metrics.inputTokens,
      metrics.outputTokens
    );

    const record: NewModelUsageMetric = {
      provider: metrics.provider,
      model: metrics.model,
      complexity: metrics.complexity,
      agentRole: metrics.agentRole,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      latencyMs: metrics.latencyMs,
      estimatedCost,
      success: metrics.success,
      error: metrics.error ?? null,
      fallbackUsed: metrics.fallbackUsed,
      fallbackChain: null,
    };

    try {
      // Try to flush any queued metrics first
      await this.flushQueue();

      // Insert the new metric
      await this.db.insert(modelUsageMetrics).values(record);
    } catch (error) {
      // Database unavailable - queue the metric
      this.addToQueue(record);
    }
  }

  /**
   * Add a metric to the in-memory queue.
   * Drops oldest metrics if queue exceeds MAX_QUEUE_SIZE.
   */
  private addToQueue(record: NewModelUsageMetric): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Remove oldest metric to make room
      this.queue.shift();
    }
    this.queue.push(record);
  }

  /**
   * Flush queued metrics to the database.
   * Called when database becomes available.
   */
  async flushQueue(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    try {
      // Insert all queued metrics in a batch
      const toFlush = [...this.queue];
      await this.db.insert(modelUsageMetrics).values(toFlush);
      // Clear the queue only after successful insert
      this.queue = [];
    } catch {
      // Database still unavailable - keep metrics in queue
    }
  }

  /**
   * Get the current queue size (for testing/monitoring).
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Get aggregated metrics for a time range.
   * Supports grouping by provider, model, and/or complexity.
   */
  async getAggregated(
    range: TimeRange,
    groupBy: ('provider' | 'model' | 'complexity')[] = ['provider', 'model', 'complexity']
  ): Promise<AggregatedMetrics[]> {
    const includeProvider = groupBy.includes('provider');
    const includeModel = groupBy.includes('model');
    const includeComplexity = groupBy.includes('complexity');

    // Build GROUP BY clause dynamically
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupByColumns: any[] = [];
    if (includeProvider) groupByColumns.push(modelUsageMetrics.provider);
    if (includeModel) groupByColumns.push(modelUsageMetrics.model);
    if (includeComplexity) groupByColumns.push(modelUsageMetrics.complexity);

    // Execute the aggregation query
    const results = await this.db
      .select({
        provider: includeProvider
          ? modelUsageMetrics.provider
          : sql<string>`'all'`.as('provider'),
        model: includeModel
          ? modelUsageMetrics.model
          : sql<string>`'all'`.as('model'),
        complexity: includeComplexity
          ? modelUsageMetrics.complexity
          : sql<string>`'all'`.as('complexity'),
        totalExecutions: sql<number>`count(*)::int`.as('totalExecutions'),
        successfulExecutions: sql<number>`sum(case when ${modelUsageMetrics.success} then 1 else 0 end)::int`.as('successfulExecutions'),
        totalInputTokens: sql<number>`sum(${modelUsageMetrics.inputTokens})::int`.as('totalInputTokens'),
        totalOutputTokens: sql<number>`sum(${modelUsageMetrics.outputTokens})::int`.as('totalOutputTokens'),
        totalCost: sql<number>`sum(${modelUsageMetrics.estimatedCost})::float`.as('totalCost'),
        averageLatencyMs: sql<number>`avg(${modelUsageMetrics.latencyMs})::float`.as('averageLatencyMs'),
        fallbackCount: sql<number>`sum(case when ${modelUsageMetrics.fallbackUsed} then 1 else 0 end)::int`.as('fallbackCount'),
      })
      .from(modelUsageMetrics)
      .where(
        and(
          gte(modelUsageMetrics.createdAt, range.start),
          lte(modelUsageMetrics.createdAt, range.end)
        )
      )
      .groupBy(...groupByColumns);

    return results.map((row) => ({
      provider: row.provider as Provider,
      model: row.model as string,
      complexity: row.complexity as ComplexityLevel,
      totalExecutions: row.totalExecutions ?? 0,
      successfulExecutions: row.successfulExecutions ?? 0,
      totalInputTokens: row.totalInputTokens ?? 0,
      totalOutputTokens: row.totalOutputTokens ?? 0,
      totalCost: row.totalCost ?? 0,
      averageLatencyMs: row.averageLatencyMs ?? 0,
      fallbackCount: row.fallbackCount ?? 0,
    }));
  }

  /**
   * Get total cost for a time range.
   */
  async getTotalCost(range: TimeRange): Promise<number> {
    const result = await this.db
      .select({
        totalCost: sql<number>`coalesce(sum(${modelUsageMetrics.estimatedCost}), 0)::float`.as('totalCost'),
      })
      .from(modelUsageMetrics)
      .where(
        and(
          gte(modelUsageMetrics.createdAt, range.start),
          lte(modelUsageMetrics.createdAt, range.end)
        )
      );

    return result[0]?.totalCost ?? 0;
  }

  /**
   * Clean up metrics older than retention period.
   * Returns the number of deleted records.
   */
  async cleanup(retentionDays: number = METRICS_RETENTION_DAYS): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.db
      .delete(modelUsageMetrics)
      .where(lt(modelUsageMetrics.createdAt, cutoffDate))
      .returning({ id: modelUsageMetrics.id });

    return result.length;
  }
}
