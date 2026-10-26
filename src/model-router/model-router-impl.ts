/**
 * ModelRouter Implementation
 * 
 * The central orchestrator that coordinates task classification, model selection,
 * fallback handling, and metrics tracking for intelligent LLM routing.
 * 
 * @implements {IModelRouter}
 */

import type { AgentRole } from '../types/agents.js';
import type {
  IModelRouter,
  ModelSelection,
  ExecutionMetrics,
  ComplexityLevel,
} from './model-router.js';
import type { ITaskClassifier } from './task-classifier.js';
import type { IModelRegistry, ModelConfig } from './model-registry.js';
import type { IFallbackStrategy, FallbackAction } from './fallback-strategy.js';
import type { IMetricsTracker } from './metrics-tracker.js';
import type { IProviderHealthChecker } from './provider-health.js';

/** Complexity level ordering for elevation */
const COMPLEXITY_ORDER: ComplexityLevel[] = ['simple', 'medium', 'complex'];

/**
 * ModelRouter Implementation
 * 
 * Coordinates all model router components to provide intelligent LLM selection:
 * - Classifies tasks using TaskClassifier
 * - Applies agent overrides when configured
 * - Selects models based on complexity and provider availability
 * - Delegates failure handling to FallbackStrategy
 * - Records execution metrics via MetricsTracker
 * 
 * @implements {IModelRouter}
 */
export class ModelRouter implements IModelRouter {
  private taskClassifier: ITaskClassifier;
  private modelRegistry: IModelRegistry;
  private fallbackStrategy: IFallbackStrategy;
  private metricsTracker: IMetricsTracker;
  private healthChecker: IProviderHealthChecker;

  constructor(
    taskClassifier: ITaskClassifier,
    modelRegistry: IModelRegistry,
    fallbackStrategy: IFallbackStrategy,
    metricsTracker: IMetricsTracker,
    healthChecker: IProviderHealthChecker
  ) {
    this.taskClassifier = taskClassifier;
    this.modelRegistry = modelRegistry;
    this.fallbackStrategy = fallbackStrategy;
    this.metricsTracker = metricsTracker;
    this.healthChecker = healthChecker;
  }

  /**
   * Select the optimal model for a task.
   * 
   * Process:
   * 1. Classify task complexity using TaskClassifier
   * 2. Check for agent override in ModelRegistry
   * 3. If override exists with minimum complexity, elevate if needed
   * 4. Get models for the complexity level from ModelRegistry
   * 5. Filter by available providers using ProviderHealthChecker
   * 6. Select first available model (sorted by priority)
   * 
   * @param task - The task description to classify
   * @param agentRole - The role of the agent requesting model selection
   * @returns ModelSelection with provider, model, cost, and complexity
   * @throws Error if no models are available for the complexity level
   */
  async selectModel(task: string, agentRole: AgentRole): Promise<ModelSelection> {
    // Step 1: Classify task complexity
    const classification = await this.taskClassifier.classify(task);
    let effectiveLevel = classification.level;

    // Step 2: Check for agent override
    const override = this.modelRegistry.getAgentOverride(agentRole);
    
    // Step 3: Apply override if exists
    if (override) {
      // If override specifies minimum complexity, elevate if needed
      if (override.minimumComplexity) {
        effectiveLevel = this.elevateComplexity(effectiveLevel, override.minimumComplexity);
      }

      // If override specifies a specific model, try to use it
      if (override.specificModel && override.preferredProvider) {
        const isProviderAvailable = this.healthChecker.isAvailable(override.preferredProvider);
        if (isProviderAvailable) {
          // Find the specific model in the registry
          const models = this.modelRegistry.getModels(effectiveLevel);
          const specificModel = models.find(
            m => m.provider === override.preferredProvider && m.model === override.specificModel
          );
          if (specificModel) {
            return this.modelConfigToSelection(specificModel, effectiveLevel);
          }
        }
      }

      // If override specifies preferred provider (without specific model)
      if (override.preferredProvider && !override.specificModel) {
        const isProviderAvailable = this.healthChecker.isAvailable(override.preferredProvider);
        if (isProviderAvailable) {
          const models = this.modelRegistry.getModels(effectiveLevel);
          const preferredModel = models.find(m => m.provider === override.preferredProvider);
          if (preferredModel) {
            return this.modelConfigToSelection(preferredModel, effectiveLevel);
          }
        }
      }
    }

    // Step 4: Get models for the complexity level
    const models = this.modelRegistry.getModels(effectiveLevel);
    if (models.length === 0) {
      throw new Error(`No models configured for complexity level: ${effectiveLevel}`);
    }

    // Step 5: Filter by available providers
    const availableModels = models.filter(m => this.healthChecker.isAvailable(m.provider));

    if (availableModels.length === 0) {
      // Try to escalate to higher complexity level
      const escalatedSelection = this.tryEscalateAndSelect(effectiveLevel);
      if (escalatedSelection) {
        return escalatedSelection;
      }
      throw new Error(`No available providers for complexity level: ${effectiveLevel}`);
    }

    // Step 6: Select first available model (already sorted by priority from registry)
    const selectedModel = availableModels[0];
    return this.modelConfigToSelection(selectedModel, effectiveLevel);
  }

  /**
   * Handle model failure and get fallback action.
   * Delegates to FallbackStrategy.getNextAction().
   * 
   * @param error - The error that occurred
   * @param currentModel - The model that failed
   * @param attemptedModels - List of previously attempted models
   * @returns The next model to try, or null if all fallbacks exhausted
   */
  async handleFailure(
    error: Error,
    currentModel: ModelSelection,
    attemptedModels: ModelSelection[]
  ): Promise<ModelSelection | null> {
    // Convert attemptedModels to FallbackAttempt format
    const attempts = attemptedModels.map(model => ({
      model,
      error: 'Previous attempt failed',
      timestamp: new Date(),
    }));

    const action = await this.fallbackStrategy.getNextAction(error, currentModel, attempts);
    const tried = new Set(
      [...attemptedModels, currentModel].map(m => `${m.provider}:${m.model}`)
    );
    return this.processFallbackAction(action, currentModel.complexity, tried);
  }

  /**
   * Record execution metrics.
   * Delegates to MetricsTracker.track().
   * 
   * @param metrics - The execution metrics to record
   */
  async recordExecution(metrics: ExecutionMetrics): Promise<void> {
    await this.metricsTracker.track(metrics);
  }

  /**
   * Check if Model Router is available.
   * Returns true if at least one provider is available.
   * 
   * @returns true if at least one provider is available
   */
  isAvailable(): boolean {
    const healthStatus = this.healthChecker.getHealthStatus();
    for (const [, status] of healthStatus) {
      if (status.available) {
        return true;
      }
    }
    return false;
  }

  /**
   * Elevate complexity level to at least the minimum required.
   * 
   * @param current - Current complexity level
   * @param minimum - Minimum required complexity level
   * @returns The elevated complexity level
   */
  private elevateComplexity(current: ComplexityLevel, minimum: ComplexityLevel): ComplexityLevel {
    const currentIndex = COMPLEXITY_ORDER.indexOf(current);
    const minimumIndex = COMPLEXITY_ORDER.indexOf(minimum);
    
    if (minimumIndex > currentIndex) {
      return minimum;
    }
    return current;
  }

  /**
   * Convert ModelConfig to ModelSelection.
   */
  private modelConfigToSelection(config: ModelConfig, level: ComplexityLevel): ModelSelection {
    return {
      provider: config.provider,
      model: config.model,
      estimatedCostPer1KTokens: config.costPer1KInputTokens + config.costPer1KOutputTokens,
      complexity: level,
    };
  }

  /**
   * Try to escalate to a higher complexity level and select a model.
   * 
   * @param currentLevel - Current complexity level
   * @returns ModelSelection if found, null otherwise
   */
  private tryEscalateAndSelect(currentLevel: ComplexityLevel): ModelSelection | null {
    const currentIndex = COMPLEXITY_ORDER.indexOf(currentLevel);
    
    // Try each higher complexity level
    for (let i = currentIndex + 1; i < COMPLEXITY_ORDER.length; i++) {
      const escalatedLevel = COMPLEXITY_ORDER[i];
      const models = this.modelRegistry.getModels(escalatedLevel);
      const availableModels = models.filter(m => this.healthChecker.isAvailable(m.provider));
      
      if (availableModels.length > 0) {
        return this.modelConfigToSelection(availableModels[0], escalatedLevel);
      }
    }
    
    return null;
  }

  /**
   * Process a FallbackAction and return the appropriate ModelSelection.
   * 
   * @param action - The fallback action from FallbackStrategy
   * @param currentLevel - Current complexity level
   * @returns ModelSelection or null if action is fail/retry
   */
  private processFallbackAction(
    action: FallbackAction,
    currentLevel: ComplexityLevel,
    tried: Set<string> = new Set()
  ): ModelSelection | null {
    switch (action.type) {
      case 'fallback':
        return action.model;
      
      case 'escalate': {
        // First available model at the escalated level that has not failed yet
        const models = this.modelRegistry.getModels(action.toLevel);
        const availableModels = models.filter(
          m => this.healthChecker.isAvailable(m.provider) && !tried.has(`${m.provider}:${m.model}`)
        );
        if (availableModels.length > 0) {
          return this.modelConfigToSelection(availableModels[0], action.toLevel);
        }
        return null;
      }
      
      case 'retry':
        // Retry action means wait and try same model - return null to signal retry
        // The caller should handle the delay and retry with the same model
        return null;
      
      case 'fail':
        // All fallbacks exhausted
        return null;
      
      default:
        return null;
    }
  }
}
