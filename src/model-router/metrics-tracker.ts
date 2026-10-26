/**
 * Metrics Tracker Types
 * 
 * Defines interfaces and types for tracking and persisting
 * model usage metrics to PostgreSQL.
 */

import type { ExecutionMetrics, Provider, ComplexityLevel } from './model-router.js';

/** Aggregated metrics for reporting */
export interface AggregatedMetrics {
  provider: Provider;
  model: string;
  complexity: ComplexityLevel;
  totalExecutions: number;
  successfulExecutions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  averageLatencyMs: number;
  fallbackCount: number;
}

/** Time range for metrics queries */
export interface TimeRange {
  start: Date;
  end: Date;
}

/** Metrics Tracker interface */
export interface IMetricsTracker {
  /**
   * Record a single execution's metrics.
   */
  track(metrics: ExecutionMetrics): Promise<void>;

  /**
   * Get aggregated metrics for a time range.
   */
  getAggregated(
    range: TimeRange,
    groupBy?: ('provider' | 'model' | 'complexity')[]
  ): Promise<AggregatedMetrics[]>;

  /**
   * Get total cost for a time range.
   */
  getTotalCost(range: TimeRange): Promise<number>;

  /**
   * Clean up metrics older than retention period.
   */
  cleanup(retentionDays: number): Promise<number>;
}

/** Metrics retention period in days */
export const METRICS_RETENTION_DAYS = 30;
