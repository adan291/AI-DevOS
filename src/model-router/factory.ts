/**
 * Model Router Factory
 * 
 * Factory function for creating and initializing a fully configured
 * ModelRouter instance with all its dependencies.
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { IModelRouter, Provider } from './model-router.js';
import type { ModelRouterConfig, ProviderKeysConfig } from './config-schema.js';
import { DEFAULT_CONFIG, validateModelRouterConfig } from './config-schema.js';
import { TaskClassifier, DEFAULT_CRITERIA } from './task-classifier.js';
import { ModelRegistry, DEFAULT_MODEL_MAPPINGS, DEFAULT_AGENT_OVERRIDES } from './model-registry.js';
import { FallbackStrategy } from './fallback-strategy-impl.js';
import { MetricsTracker } from './metrics-tracker-impl.js';
import { ProviderHealthChecker } from './provider-health-checker.js';
import { ModelRouter } from './model-router-impl.js';
import type { IMetricsTracker } from './metrics-tracker.js';
import type { ComplexityLevel } from './model-router.js';
import type { ModelConfig } from './model-registry.js';
import { config } from '../config/index.js';

const PROVIDER_ENV_VARS: Record<Provider, string> = {
  groq: 'GROQ_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  ollama: 'OLLAMA_MODEL',
};

/**
 * Reads provider API keys from environment variables.
 * @returns Provider keys configuration from environment
 */
function getProviderKeysFromEnv(): ProviderKeysConfig {
  return {
    anthropic: config.ANTHROPIC_API_KEY(),
    openai: config.OPENAI_API_KEY(),
    groq: config.GROQ_API_KEY(),
  };
}

/**
 * Merges user configuration with defaults.
 * @param userConfig - User-provided configuration
 * @returns Complete configuration with defaults applied
 */
function mergeConfig(userConfig: ModelRouterConfig): Required<ModelRouterConfig> {
  const envKeys = getProviderKeysFromEnv();
  
  return {
    modelMappings: userConfig.modelMappings ?? withOllamaModels(
      withGroqModel(DEFAULT_MODEL_MAPPINGS, config.GROQ_MODEL()),
      config.OLLAMA_MODEL()
    ),
    agentOverrides: userConfig.agentOverrides ?? DEFAULT_AGENT_OVERRIDES,
    providerKeys: {
      ...envKeys,
      ...userConfig.providerKeys, // User config overrides env vars
    },
    classificationCriteria: userConfig.classificationCriteria ?? DEFAULT_CRITERIA,
    fallback: {
      ...DEFAULT_CONFIG.fallback,
      ...userConfig.fallback,
    },
    healthCheck: {
      ...DEFAULT_CONFIG.healthCheck,
      ...userConfig.healthCheck,
    },
    metrics: {
      ...DEFAULT_CONFIG.metrics,
      ...userConfig.metrics,
    },
    defaultProvider: userConfig.defaultProvider ?? DEFAULT_CONFIG.defaultProvider,
    classificationTimeoutMs: userConfig.classificationTimeoutMs ?? DEFAULT_CONFIG.classificationTimeoutMs,
  };
}

/**
 * Options for creating a ModelRouter instance.
 */
export interface CreateModelRouterOptions {
  /** Database connection for metrics persistence (optional) */
  db?: PostgresJsDatabase;
  /** Configuration overrides (optional) */
  config?: ModelRouterConfig;
  /** Whether to start health checks automatically (default: true) */
  startHealthChecks?: boolean;
}

/**
 * Creates a fully configured ModelRouter instance.
 * 
 * @param options - Creation options
 * @returns A configured ModelRouter instance
 * @throws Error if configuration validation fails
 * 
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const router = createModelRouter({ db });
 * 
 * // With custom configuration
 * const router = createModelRouter({
 *   db,
 *   config: {
 *     defaultProvider: 'anthropic',
 *     fallback: { maxAttempts: 5 },
 *   },
 * });
 * ```
 */
export function createModelRouter(options: CreateModelRouterOptions = {}): IModelRouter {
  const { db, config: userConfig = {}, startHealthChecks = true } = options;

  // Validate user configuration
  const validationErrors = validateModelRouterConfig(userConfig);
  if (validationErrors.length > 0) {
    throw new Error(`Invalid ModelRouter configuration: ${validationErrors.join('; ')}`);
  }

  // Merge with defaults
  const mergedConfig = mergeConfig(userConfig);

  // Create components. ProviderHealthChecker reads API keys from the
  // environment itself, so providerKeys only feed config validation.
  const taskClassifier = new TaskClassifier(mergedConfig.classificationCriteria);

  const modelRegistry = new ModelRegistry(
    mergedConfig.modelMappings,
    mergedConfig.agentOverrides
  );

  const providerHealthChecker = new ProviderHealthChecker();

  const fallbackStrategy = new FallbackStrategy(modelRegistry, providerHealthChecker);

  const metricsTracker: IMetricsTracker = mergedConfig.metrics.enabled && db
    ? new MetricsTracker(db)
    : noopMetricsTracker;

  // Start health checks if enabled
  if (startHealthChecks && mergedConfig.healthCheck.enabled) {
    providerHealthChecker.startHealthChecks(mergedConfig.healthCheck.intervalMs!);
  }

  return new ModelRouter(
    taskClassifier,
    modelRegistry,
    fallbackStrategy,
    metricsTracker,
    providerHealthChecker
  );
}

/**
 * Replaces the Groq model in every level when GROQ_MODEL is set.
 */
export function withGroqModel(
  mappings: Record<ComplexityLevel, ModelConfig[]>,
  groqModel: string
): Record<ComplexityLevel, ModelConfig[]> {
  if (!groqModel) {
    return mappings;
  }
  const replace = (models: ModelConfig[]): ModelConfig[] =>
    models.map(m => (m.provider === 'groq' ? { ...m, model: groqModel } : m));
  return {
    simple: replace(mappings.simple),
    medium: replace(mappings.medium),
    complex: replace(mappings.complex),
  };
}

/**
 * Adds the local Ollama model to the mappings when OLLAMA_MODEL is set:
 * first choice for simple tasks (free, local), last-resort fallback for
 * medium and complex tasks when every cloud provider fails.
 */
export function withOllamaModels(
  mappings: Record<ComplexityLevel, ModelConfig[]>,
  ollamaModel: string
): Record<ComplexityLevel, ModelConfig[]> {
  if (!ollamaModel) {
    return mappings;
  }
  const local = (priority: number): ModelConfig => ({
    provider: 'ollama',
    model: ollamaModel,
    costPer1KInputTokens: 0,
    costPer1KOutputTokens: 0,
    maxTokens: 8192,
    priority,
  });
  return {
    simple: [local(0), ...mappings.simple],
    medium: [...mappings.medium, local(99)],
    complex: [...mappings.complex, local(99)],
  };
}

/** Metrics tracker used when no database is available. */
const noopMetricsTracker: IMetricsTracker = {
  track: async () => {},
  getAggregated: async () => [],
  getTotalCost: async () => 0,
  cleanup: async () => 0,
};

/**
 * Creates a minimal ModelRouter for testing purposes.
 * Does not require a database connection and uses in-memory components.
 * 
 * @param providerKeys - Map of provider names to API keys
 * @param config - Optional configuration overrides
 * @returns A ModelRouter instance suitable for testing
 */
export function createTestModelRouter(
  providerKeys: Map<Provider, string>,
  config: ModelRouterConfig = {}
): IModelRouter {
  const mergedConfig = mergeConfig(config);

  // ProviderHealthChecker reads keys from the environment; set them in
  // process.env so the providers passed in are treated as available.
  for (const [provider, key] of providerKeys) {
    process.env[PROVIDER_ENV_VARS[provider]] = key;
  }

  const taskClassifier = new TaskClassifier(mergedConfig.classificationCriteria);

  const modelRegistry = new ModelRegistry(
    mergedConfig.modelMappings,
    mergedConfig.agentOverrides
  );

  const providerHealthChecker = new ProviderHealthChecker();

  const fallbackStrategy = new FallbackStrategy(modelRegistry, providerHealthChecker);

  return new ModelRouter(
    taskClassifier,
    modelRegistry,
    fallbackStrategy,
    noopMetricsTracker,
    providerHealthChecker
  );
}
