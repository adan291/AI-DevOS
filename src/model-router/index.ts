/**
 * Model Router Module
 * 
 * Intelligent LLM selection system that optimizes model usage
 * based on task complexity, cost, and capability requirements.
 * 
 * ## Overview
 * 
 * The Model Router analyzes incoming tasks, classifies their complexity,
 * and routes them to the optimal LLM model based on:
 * - Task complexity (simple, medium, complex)
 * - Provider availability and health
 * - Cost efficiency
 * - Agent-specific overrides
 * 
 * ## Quick Start
 * 
 * ```typescript
 * import { createModelRouter } from './model-router/index.js';
 * 
 * // Create with database connection for metrics
 * const router = createModelRouter({ db });
 * 
 * // Select optimal model for a task
 * const selection = await router.selectModel(
 *   'Implement user authentication with OAuth2',
 *   'developer'
 * );
 * 
 * // Use selection.provider and selection.model for API call
 * console.log(`Using ${selection.provider}/${selection.model}`);
 * ```
 * 
 * ## Key Components
 * 
 * - **TaskClassifier**: Analyzes task descriptions to determine complexity
 * - **ModelRegistry**: Manages model configurations and agent overrides
 * - **ProviderHealthChecker**: Monitors provider availability
 * - **FallbackStrategy**: Handles failures with intelligent fallback
 * - **MetricsTracker**: Records usage metrics for analysis
 * - **ModelRouter**: Orchestrates all components
 * 
 * ## Configuration
 * 
 * ```typescript
 * const router = createModelRouter({
 *   db,
 *   config: {
 *     defaultProvider: 'anthropic',
 *     fallback: { maxAttempts: 5 },
 *     healthCheck: { intervalMs: 60000 },
 *     metrics: { retentionDays: 90 },
 *   },
 * });
 * ```
 * 
 * @module model-router
 */

// Core types and interfaces
export type {
  ComplexityLevel,
  Provider,
  ClassificationResult,
  ModelSelection,
  ExecutionMetrics,
  IModelRouter,
} from './model-router.js';

// Model registry types and defaults
export type {
  ModelConfig,
  AgentOverride,
  IModelRegistry,
} from './model-registry.js';

export {
  DEFAULT_MODEL_MAPPINGS,
  DEFAULT_AGENT_OVERRIDES,
  ModelRegistry,
  ModelRegistryConfigError,
} from './model-registry.js';

// Task classifier types, defaults, and implementation
export type {
  ClassificationCriteria,
  ITaskClassifier,
} from './task-classifier.js';

export {
  DEFAULT_CRITERIA,
  TOKEN_THRESHOLDS,
  TaskClassifier,
} from './task-classifier.js';

// Fallback strategy types and constants
export type {
  FallbackAction,
  FallbackAttempt,
  IFallbackStrategy,
} from './fallback-strategy.js';

export { MAX_FALLBACK_ATTEMPTS } from './fallback-strategy.js';

// Fallback strategy implementation
export { FallbackStrategy, RateLimitError } from './fallback-strategy-impl.js';

// Metrics tracker types and constants
export type {
  AggregatedMetrics,
  TimeRange,
  IMetricsTracker,
} from './metrics-tracker.js';

export { METRICS_RETENTION_DAYS } from './metrics-tracker.js';

// Metrics tracker implementation
export { MetricsTracker } from './metrics-tracker-impl.js';

// Provider health checker types and constants
export type {
  ProviderHealth,
  IProviderHealthChecker,
} from './provider-health.js';

export {
  HEALTH_CHECK_INTERVAL_MS,
  UNAVAILABLE_DURATION_MS,
} from './provider-health.js';

// Provider health checker implementation
export { ProviderHealthChecker } from './provider-health-checker.js';

// Model router implementation
export { ModelRouter } from './model-router-impl.js';

// Configuration schema and validation
export type {
  ProviderKeysConfig,
  FallbackConfig,
  HealthCheckConfig,
  MetricsConfig,
  ModelRouterConfig,
} from './config-schema.js';

export {
  DEFAULT_CONFIG,
  validateModelRouterConfig,
} from './config-schema.js';

// Factory functions
export {
  createModelRouter,
  createTestModelRouter,
} from './factory.js';

export type { CreateModelRouterOptions } from './factory.js';
