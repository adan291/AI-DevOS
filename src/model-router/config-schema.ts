/**
 * Model Router Configuration Schema
 * 
 * Defines the configuration interface for the Model Router system.
 * Supports customization of model mappings, agent overrides, provider keys,
 * classification criteria, fallback settings, health checks, and metrics.
 */

import type { ComplexityLevel, Provider } from './model-router.js';
import type { ModelConfig, AgentOverride } from './model-registry.js';
import type { ClassificationCriteria } from './task-classifier.js';

/**
 * Provider API key configuration.
 * Maps provider names to their API keys.
 */
export interface ProviderKeysConfig {
  /** Anthropic (Claude) API key */
  anthropic?: string;
  /** OpenAI API key */
  openai?: string;
  /** Groq API key */
  groq?: string;
}

/**
 * Fallback behavior configuration.
 */
export interface FallbackConfig {
  /** Maximum number of fallback attempts before failing (default: 3) */
  maxAttempts?: number;
  /** Whether to escalate complexity when all models at a level fail (default: true) */
  enableComplexityEscalation?: boolean;
  /** Default retry delay in milliseconds for rate limits without retry-after header (default: 1000) */
  defaultRetryDelayMs?: number;
}

/**
 * Health check configuration.
 */
export interface HealthCheckConfig {
  /** Interval between health checks in milliseconds (default: 300000 = 5 minutes) */
  intervalMs?: number;
  /** Duration a provider remains unavailable after failure in milliseconds (default: 60000 = 1 minute) */
  unavailableDurationMs?: number;
  /** Whether to enable periodic health checks (default: true) */
  enabled?: boolean;
}

/**
 * Metrics tracking configuration.
 */
export interface MetricsConfig {
  /** Number of days to retain metrics (default: 30) */
  retentionDays?: number;
  /** Maximum in-memory queue size when database is unavailable (default: 1000) */
  maxQueueSize?: number;
  /** Whether to enable metrics tracking (default: true) */
  enabled?: boolean;
}

/**
 * Complete Model Router configuration.
 * All fields are optional - defaults will be used for any missing values.
 */
export interface ModelRouterConfig {
  /**
   * Model mappings by complexity level.
   * Each level should have at least one model configured.
   */
  modelMappings?: Record<ComplexityLevel, ModelConfig[]>;

  /**
   * Agent-specific overrides.
   * Allows certain agents to use specific models regardless of task complexity.
   */
  agentOverrides?: AgentOverride[];

  /**
   * API keys for each provider.
   * Can also be read from environment variables.
   */
  providerKeys?: ProviderKeysConfig;

  /**
   * Classification criteria for task complexity detection.
   * Includes keyword patterns and token thresholds.
   */
  classificationCriteria?: ClassificationCriteria;

  /**
   * Fallback behavior settings.
   */
  fallback?: FallbackConfig;

  /**
   * Health check settings.
   */
  healthCheck?: HealthCheckConfig;

  /**
   * Metrics tracking settings.
   */
  metrics?: MetricsConfig;

  /**
   * Default provider preference when multiple providers are available.
   */
  defaultProvider?: Provider;

  /**
   * Classification timeout in milliseconds (default: 2000).
   * If classification takes longer, defaults to 'medium' complexity.
   */
  classificationTimeoutMs?: number;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: Required<Omit<ModelRouterConfig, 'modelMappings' | 'agentOverrides' | 'classificationCriteria' | 'providerKeys'>> = {
  fallback: {
    maxAttempts: 3,
    enableComplexityEscalation: true,
    defaultRetryDelayMs: 1000,
  },
  healthCheck: {
    intervalMs: 300_000, // 5 minutes
    unavailableDurationMs: 60_000, // 1 minute
    enabled: true,
  },
  metrics: {
    retentionDays: 30,
    maxQueueSize: 1000,
    enabled: true,
  },
  defaultProvider: 'groq',
  classificationTimeoutMs: 2000,
};

/**
 * Validates a ModelRouterConfig object.
 * @param config - The configuration to validate
 * @returns An array of validation error messages (empty if valid)
 */
export function validateModelRouterConfig(config: ModelRouterConfig): string[] {
  const errors: string[] = [];

  // Validate model mappings if provided
  if (config.modelMappings) {
    const levels: ComplexityLevel[] = ['simple', 'medium', 'complex'];
    for (const level of levels) {
      const models = config.modelMappings[level];
      if (!models || models.length === 0) {
        errors.push(`Model mappings must include at least one model for '${level}' complexity level`);
      }
    }
  }

  // Validate fallback config
  if (config.fallback) {
    if (config.fallback.maxAttempts !== undefined && config.fallback.maxAttempts < 1) {
      errors.push('Fallback maxAttempts must be at least 1');
    }
    if (config.fallback.defaultRetryDelayMs !== undefined && config.fallback.defaultRetryDelayMs < 0) {
      errors.push('Fallback defaultRetryDelayMs must be non-negative');
    }
  }

  // Validate health check config
  if (config.healthCheck) {
    if (config.healthCheck.intervalMs !== undefined && config.healthCheck.intervalMs < 1000) {
      errors.push('Health check intervalMs must be at least 1000ms');
    }
    if (config.healthCheck.unavailableDurationMs !== undefined && config.healthCheck.unavailableDurationMs < 0) {
      errors.push('Health check unavailableDurationMs must be non-negative');
    }
  }

  // Validate metrics config
  if (config.metrics) {
    if (config.metrics.retentionDays !== undefined && config.metrics.retentionDays < 1) {
      errors.push('Metrics retentionDays must be at least 1');
    }
    if (config.metrics.maxQueueSize !== undefined && config.metrics.maxQueueSize < 1) {
      errors.push('Metrics maxQueueSize must be at least 1');
    }
  }

  // Validate classification timeout
  if (config.classificationTimeoutMs !== undefined && config.classificationTimeoutMs < 100) {
    errors.push('Classification timeout must be at least 100ms');
  }

  return errors;
}
