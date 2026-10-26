/**
 * Model Registry Types and Defaults
 * 
 * Stores and manages model configurations per complexity level and provider.
 * Supports agent-specific overrides for critical workflows.
 */

import type { ComplexityLevel, Provider } from './model-router.js';
import type { AgentRole } from '../types/agents.js';

/** Model configuration entry */
export interface ModelConfig {
  provider: Provider;
  model: string;
  costPer1KInputTokens: number;
  costPer1KOutputTokens: number;
  maxTokens: number;
  priority: number; // Lower = higher priority
}

/** Agent-specific override configuration */
export interface AgentOverride {
  agentRole: AgentRole;
  minimumComplexity?: ComplexityLevel;
  preferredProvider?: Provider;
  specificModel?: string;
  reason: string;
}

/** Model Registry interface */
export interface IModelRegistry {
  /**
   * Get available models for a complexity level.
   * Returns models sorted by priority.
   */
  getModels(level: ComplexityLevel): ModelConfig[];

  /**
   * Get agent-specific override if configured.
   */
  getAgentOverride(role: AgentRole): AgentOverride | null;

  /**
   * Update model configuration at runtime.
   * Validates that at least one model exists per level.
   */
  updateConfig(level: ComplexityLevel, models: ModelConfig[]): void;

  /**
   * Set agent override.
   */
  setAgentOverride(override: AgentOverride): void;

  /**
   * Validate current configuration.
   * Throws if invalid.
   */
  validate(): void;
}

/** Default model mappings per complexity level */
export const DEFAULT_MODEL_MAPPINGS: Record<ComplexityLevel, ModelConfig[]> = {
  simple: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 1 },
    { provider: 'anthropic', model: 'claude-3-5-haiku-20241022', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.005, maxTokens: 8192, priority: 2 },
    { provider: 'openai', model: 'gpt-4o-mini', costPer1KInputTokens: 0.00015, costPer1KOutputTokens: 0.0006, maxTokens: 16384, priority: 3 },
  ],
  medium: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 1 },
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.015, maxTokens: 8192, priority: 2 },
    { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 3 },
  ],
  complex: [
    { provider: 'anthropic', model: 'claude-opus-4-20250514', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 1 },
    { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 2 },
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 3 },
  ],
};

/** Default agent overrides */
export const DEFAULT_AGENT_OVERRIDES: AgentOverride[] = [
  { agentRole: 'coordinator', minimumComplexity: 'medium', reason: 'Coordinator requires reliable task analysis' },
  { agentRole: 'architect', minimumComplexity: 'complex', reason: 'Architecture decisions require deep reasoning' },
];


/**
 * Configuration validation error
 */
export class ModelRegistryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelRegistryConfigError';
  }
}

/** Valid complexity levels for validation */
const COMPLEXITY_LEVELS: ComplexityLevel[] = ['simple', 'medium', 'complex'];

/** Valid providers for validation */
const VALID_PROVIDERS: Provider[] = ['groq', 'anthropic', 'openai', 'ollama'];

/**
 * ModelRegistry Implementation
 * 
 * Stores and manages model configurations per complexity level and provider.
 * Supports agent-specific overrides for critical workflows.
 * 
 * @implements {IModelRegistry}
 */
export class ModelRegistry implements IModelRegistry {
  private modelMappings: Record<ComplexityLevel, ModelConfig[]>;
  private agentOverrides: Map<AgentRole, AgentOverride>;

  constructor(
    initialMappings: Record<ComplexityLevel, ModelConfig[]> = DEFAULT_MODEL_MAPPINGS,
    initialOverrides: AgentOverride[] = DEFAULT_AGENT_OVERRIDES
  ) {
    // Deep clone the initial mappings to avoid mutation
    this.modelMappings = {
      simple: [...initialMappings.simple],
      medium: [...initialMappings.medium],
      complex: [...initialMappings.complex],
    };

    // Initialize agent overrides map
    this.agentOverrides = new Map();
    for (const override of initialOverrides) {
      this.agentOverrides.set(override.agentRole, override);
    }

    // Validate initial configuration
    this.validate();
  }

  /**
   * Get available models for a complexity level.
   * Returns models sorted by priority (lower priority number = higher priority).
   */
  getModels(level: ComplexityLevel): ModelConfig[] {
    const models = this.modelMappings[level];
    if (!models) {
      return [];
    }
    // Return a copy sorted by priority
    return [...models].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get agent-specific override if configured.
   */
  getAgentOverride(role: AgentRole): AgentOverride | null {
    return this.agentOverrides.get(role) ?? null;
  }

  /**
   * Update model configuration at runtime.
   * Validates that at least one model exists per level.
   * 
   * @throws {ModelRegistryConfigError} If the configuration is invalid
   */
  updateConfig(level: ComplexityLevel, models: ModelConfig[]): void {
    // Validate the level
    if (!COMPLEXITY_LEVELS.includes(level)) {
      throw new ModelRegistryConfigError(
        `Invalid complexity level: '${level}'. Must be one of: ${COMPLEXITY_LEVELS.join(', ')}`
      );
    }

    // Validate models array is not empty
    if (!models || models.length === 0) {
      throw new ModelRegistryConfigError(
        `Configuration for complexity level '${level}' must have at least one model`
      );
    }

    // Validate each model config
    for (const model of models) {
      this.validateModelConfig(model, level);
    }

    // Update the configuration
    this.modelMappings[level] = [...models];

    // Validate the entire configuration after update
    this.validate();
  }

  /**
   * Set agent override.
   */
  setAgentOverride(override: AgentOverride): void {
    // Validate the override
    this.validateAgentOverride(override);

    // Set the override
    this.agentOverrides.set(override.agentRole, override);
  }

  /**
   * Validate current configuration.
   * Ensures at least one model is configured for each complexity level.
   * 
   * @throws {ModelRegistryConfigError} If the configuration is invalid
   */
  validate(): void {
    const errors: string[] = [];

    // Check each complexity level has at least one model
    for (const level of COMPLEXITY_LEVELS) {
      const models = this.modelMappings[level];
      if (!models || models.length === 0) {
        errors.push(`Complexity level '${level}' has no models configured`);
      }
    }

    // Validate each model config
    for (const level of COMPLEXITY_LEVELS) {
      const models = this.modelMappings[level];
      if (models) {
        for (let i = 0; i < models.length; i++) {
          try {
            this.validateModelConfig(models[i], level);
          } catch (error) {
            if (error instanceof ModelRegistryConfigError) {
              errors.push(`${level}[${i}]: ${error.message}`);
            } else {
              throw error;
            }
          }
        }
      }
    }

    if (errors.length > 0) {
      throw new ModelRegistryConfigError(
        `Invalid model registry configuration:\n- ${errors.join('\n- ')}`
      );
    }
  }

  /**
   * Validate a single model configuration.
   */
  private validateModelConfig(model: ModelConfig, level: ComplexityLevel): void {
    if (!model) {
      throw new ModelRegistryConfigError('Model configuration cannot be null or undefined');
    }

    if (!VALID_PROVIDERS.includes(model.provider)) {
      throw new ModelRegistryConfigError(
        `Invalid provider '${model.provider}'. Must be one of: ${VALID_PROVIDERS.join(', ')}`
      );
    }

    if (!model.model || typeof model.model !== 'string' || model.model.trim() === '') {
      throw new ModelRegistryConfigError('Model name must be a non-empty string');
    }

    if (typeof model.costPer1KInputTokens !== 'number' || model.costPer1KInputTokens < 0) {
      throw new ModelRegistryConfigError('costPer1KInputTokens must be a non-negative number');
    }

    if (typeof model.costPer1KOutputTokens !== 'number' || model.costPer1KOutputTokens < 0) {
      throw new ModelRegistryConfigError('costPer1KOutputTokens must be a non-negative number');
    }

    if (typeof model.maxTokens !== 'number' || model.maxTokens <= 0) {
      throw new ModelRegistryConfigError('maxTokens must be a positive number');
    }

    if (typeof model.priority !== 'number') {
      throw new ModelRegistryConfigError('priority must be a number');
    }
  }

  /**
   * Validate an agent override configuration.
   */
  private validateAgentOverride(override: AgentOverride): void {
    if (!override) {
      throw new ModelRegistryConfigError('Agent override cannot be null or undefined');
    }

    if (!override.agentRole) {
      throw new ModelRegistryConfigError('Agent override must specify an agentRole');
    }

    if (override.minimumComplexity && !COMPLEXITY_LEVELS.includes(override.minimumComplexity)) {
      throw new ModelRegistryConfigError(
        `Invalid minimumComplexity '${override.minimumComplexity}'. Must be one of: ${COMPLEXITY_LEVELS.join(', ')}`
      );
    }

    if (override.preferredProvider && !VALID_PROVIDERS.includes(override.preferredProvider)) {
      throw new ModelRegistryConfigError(
        `Invalid preferredProvider '${override.preferredProvider}'. Must be one of: ${VALID_PROVIDERS.join(', ')}`
      );
    }

    if (!override.reason || typeof override.reason !== 'string' || override.reason.trim() === '') {
      throw new ModelRegistryConfigError('Agent override must have a non-empty reason');
    }
  }
}
