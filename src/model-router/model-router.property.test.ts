/**
 * Property-Based Tests for Model Router
 * Feature: model-router, Property 6: Model Selection Priority
 *
 * **Validates: Requirements 3.1, 3.2, 3.3**
 *
 * Property 6: For any task with a classified complexity level, the ModelRouter SHALL
 * select a model that: (1) exists in the registry for that complexity level,
 * (2) belongs to the preferred provider if that provider has a valid API key, and
 * (3) follows cost-efficiency ordering when multiple models from the preferred provider
 * are available.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { ModelRouter } from './model-router-impl.js';
import type {
  ComplexityLevel,
  Provider,
  ClassificationResult,
  ModelSelection,
} from './model-router.js';
import type { ITaskClassifier } from './task-classifier.js';
import type { IModelRegistry, ModelConfig, AgentOverride } from './model-registry.js';
import type { IFallbackStrategy, FallbackAction, FallbackAttempt } from './fallback-strategy.js';
import type { IMetricsTracker, AggregatedMetrics, TimeRange } from './metrics-tracker.js';
import type { IProviderHealthChecker, ProviderHealth } from './provider-health.js';
import type { ExecutionMetrics } from './model-router.js';
import type { AgentRole } from '../types/agents.js';

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Mock TaskClassifier that returns a configurable classification result
 */
class MockTaskClassifier implements ITaskClassifier {
  private classificationResult: ClassificationResult = {
    level: 'medium',
    confidence: 0.8,
    reasoning: 'Mock classification',
  };

  setClassificationResult(result: ClassificationResult): void {
    this.classificationResult = result;
  }

  async classify(_task: string): Promise<ClassificationResult> {
    return this.classificationResult;
  }

  updateCriteria(_criteria: Partial<{ simple: string[]; medium: string[]; complex: string[] }>): void {
    // No-op for mock
  }
}

/**
 * Mock ModelRegistry that returns configurable models
 */
class MockModelRegistry implements IModelRegistry {
  private modelMappings: Record<ComplexityLevel, ModelConfig[]> = {
    simple: [],
    medium: [],
    complex: [],
  };
  private agentOverrides: Map<AgentRole, AgentOverride> = new Map();

  setModels(level: ComplexityLevel, models: ModelConfig[]): void {
    this.modelMappings[level] = [...models].sort((a, b) => a.priority - b.priority);
  }

  getModels(level: ComplexityLevel): ModelConfig[] {
    return [...this.modelMappings[level]].sort((a, b) => a.priority - b.priority);
  }

  getAgentOverride(role: AgentRole): AgentOverride | null {
    return this.agentOverrides.get(role) ?? null;
  }

  setAgentOverride(override: AgentOverride): void {
    this.agentOverrides.set(override.agentRole, override);
  }

  updateConfig(level: ComplexityLevel, models: ModelConfig[]): void {
    this.modelMappings[level] = [...models];
  }

  validate(): void {
    // No-op for mock
  }
}

/**
 * Mock FallbackStrategy
 */
class MockFallbackStrategy implements IFallbackStrategy {
  async getNextAction(
    _error: Error,
    _currentModel: ModelSelection,
    _attempts: FallbackAttempt[]
  ): Promise<FallbackAction> {
    return { type: 'fail', reason: 'Mock fallback exhausted' };
  }

  isRateLimitError(_error: Error): boolean {
    return false;
  }

  getRetryAfterMs(_error: Error): number | null {
    return null;
  }
}

/**
 * Mock MetricsTracker
 */
class MockMetricsTracker implements IMetricsTracker {
  private trackedMetrics: ExecutionMetrics[] = [];

  async track(metrics: ExecutionMetrics): Promise<void> {
    this.trackedMetrics.push(metrics);
  }

  async getAggregated(
    _range: TimeRange,
    _groupBy?: ('provider' | 'model' | 'complexity')[]
  ): Promise<AggregatedMetrics[]> {
    return [];
  }

  async getTotalCost(_range: TimeRange): Promise<number> {
    return 0;
  }

  async cleanup(_retentionDays: number): Promise<number> {
    return 0;
  }

  getTrackedMetrics(): ExecutionMetrics[] {
    return this.trackedMetrics;
  }
}

/**
 * Mock ProviderHealthChecker that returns configurable availability
 */
class MockProviderHealthChecker implements IProviderHealthChecker {
  private availableProviders: Set<Provider> = new Set(['groq', 'anthropic', 'openai']);
  private healthStatus: Map<Provider, ProviderHealth> = new Map();

  constructor() {
    this.initializeHealthStatus();
  }

  private initializeHealthStatus(): void {
    const providers: Provider[] = ['groq', 'anthropic', 'openai'];
    for (const provider of providers) {
      this.healthStatus.set(provider, {
        provider,
        available: this.availableProviders.has(provider),
        lastCheck: new Date(),
        consecutiveFailures: 0,
      });
    }
  }

  setAvailableProviders(providers: Provider[]): void {
    this.availableProviders = new Set(providers);
    this.initializeHealthStatus();
  }

  isAvailable(provider: Provider): boolean {
    return this.availableProviders.has(provider);
  }

  getHealthStatus(): Map<Provider, ProviderHealth> {
    return new Map(this.healthStatus);
  }

  markUnavailable(provider: Provider, _durationMs: number): void {
    this.availableProviders.delete(provider);
    const status = this.healthStatus.get(provider);
    if (status) {
      status.available = false;
      status.consecutiveFailures += 1;
    }
  }

  startHealthChecks(_intervalMs: number): void {
    // No-op for mock
  }

  stopHealthChecks(): void {
    // No-op for mock
  }
}

// ============================================================================
// Fast-Check Arbitraries (Generators)
// ============================================================================

/**
 * Valid complexity levels
 */
const VALID_COMPLEXITY_LEVELS: ComplexityLevel[] = ['simple', 'medium', 'complex'];

/**
 * Valid providers
 */
const VALID_PROVIDERS: Provider[] = ['groq', 'anthropic', 'openai'];

/**
 * Valid agent roles for testing
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
 * Generates a valid complexity level
 */
const arbitraryComplexityLevel = fc.constantFrom<ComplexityLevel>(...VALID_COMPLEXITY_LEVELS);

/**
 * Generates a valid provider
 */
const arbitraryProvider = fc.constantFrom<Provider>(...VALID_PROVIDERS);

/**
 * Generates a valid agent role
 */
const arbitraryAgentRole = fc.constantFrom<AgentRole>(...VALID_AGENT_ROLES);

/**
 * Generates a valid model name
 */
const arbitraryModelName = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_.'.split('')),
  { minLength: 1, maxLength: 50 }
);

/**
 * Generates a valid cost value (non-negative number)
 */
const arbitraryCost = fc.double({ min: 0.0001, max: 1, noNaN: true });

/**
 * Generates a valid maxTokens value (positive integer)
 */
const arbitraryMaxTokens = fc.integer({ min: 1000, max: 100000 });

/**
 * Generates a valid priority value (positive integer, lower = higher priority)
 */
const arbitraryPriority = fc.integer({ min: 1, max: 100 });

/**
 * Generates a valid ModelConfig
 */
const arbitraryModelConfig: fc.Arbitrary<ModelConfig> = fc.record({
  provider: arbitraryProvider,
  model: arbitraryModelName,
  costPer1KInputTokens: arbitraryCost,
  costPer1KOutputTokens: arbitraryCost,
  maxTokens: arbitraryMaxTokens,
  priority: arbitraryPriority,
});

/**
 * Generates a non-empty array of valid ModelConfigs
 */
const arbitraryModelConfigArray = fc.array(arbitraryModelConfig, { minLength: 1, maxLength: 5 });

/**
 * Generates a task description string
 */
const arbitraryTaskDescription = fc.oneof(
  fc.string({ minLength: 1, maxLength: 200 }),
  fc.constantFrom(
    'format the code',
    'refactor the module',
    'design system architecture',
    'implement new feature',
    'fix bug in authentication'
  )
);

/**
 * Generates a confidence score between 0.0 and 1.0
 */
const arbitraryConfidence = fc.double({ min: 0, max: 1, noNaN: true });

/**
 * Generates a ClassificationResult
 */
const arbitraryClassificationResult: fc.Arbitrary<ClassificationResult> = fc.record({
  level: arbitraryComplexityLevel,
  confidence: arbitraryConfidence,
  reasoning: fc.option(fc.string({ minLength: 0, maxLength: 100 }), { nil: undefined }),
});

/**
 * Generates a non-empty subset of providers
 */
const arbitraryAvailableProviders = fc.array(arbitraryProvider, { minLength: 1, maxLength: 3 })
  .map(providers => [...new Set(providers)]) // Remove duplicates
  .filter(providers => providers.length > 0);

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Property 6: Model Selection Priority', () => {
  let mockClassifier: MockTaskClassifier;
  let mockRegistry: MockModelRegistry;
  let mockFallback: MockFallbackStrategy;
  let mockMetrics: MockMetricsTracker;
  let mockHealthChecker: MockProviderHealthChecker;
  let router: ModelRouter;

  beforeEach(() => {
    mockClassifier = new MockTaskClassifier();
    mockRegistry = new MockModelRegistry();
    mockFallback = new MockFallbackStrategy();
    mockMetrics = new MockMetricsTracker();
    mockHealthChecker = new MockProviderHealthChecker();

    router = new ModelRouter(
      mockClassifier,
      mockRegistry,
      mockFallback,
      mockMetrics,
      mockHealthChecker
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * Property: Selected model SHALL exist in the registry for the classified complexity level.
   */
  describe('Selected Model Exists in Registry', () => {
    it('should select a model that exists in the registry for the classified complexity level', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryClassificationResult,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (classification, models, task, agentRole) => {
            // Arrange: Set up classification and registry
            mockClassifier.setClassificationResult(classification);
            mockRegistry.setModels(classification.level, models);

            // Ensure at least one provider is available
            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act: Select model
            const selection = await router.selectModel(task, agentRole);

            // Assert: Selected model exists in registry for the complexity level
            const registryModels = mockRegistry.getModels(classification.level);
            const modelExists = registryModels.some(
              m => m.provider === selection.provider && m.model === selection.model
            );
            expect(modelExists).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should select a model from the correct complexity level', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);

            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Selection complexity matches classified level
            expect(selection.complexity).toBe(level);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.2, 3.3**
   *
   * Property: Models from providers with valid API keys SHALL be preferred,
   * and selection SHALL follow cost-efficiency (priority) ordering.
   */
  describe('Provider Preference and Priority Ordering', () => {
    it('should only select models from available providers', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryModelConfigArray,
          arbitraryAvailableProviders,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, models, availableProviders, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            mockHealthChecker.setAvailableProviders(availableProviders as Provider[]);

            // Filter models to only those with available providers
            const availableModels = models.filter(m =>
              availableProviders.includes(m.provider)
            );

            // Skip if no models are available
            if (availableModels.length === 0) {
              return; // Skip this test case
            }

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Selected provider is available
            expect(availableProviders).toContain(selection.provider);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should select the highest priority (lowest priority number) model among available providers', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange: Create models with distinct priorities
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'model-a', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 3 },
              { provider: 'anthropic', model: 'model-b', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 1 },
              { provider: 'openai', model: 'model-c', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8000, priority: 2 },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            mockHealthChecker.setAvailableProviders(['groq', 'anthropic', 'openai']);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should select the model with lowest priority number (highest priority)
            expect(selection.provider).toBe('anthropic');
            expect(selection.model).toBe('model-b');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should select next priority model when highest priority provider is unavailable', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange: Create models with distinct priorities
            const models: ModelConfig[] = [
              { provider: 'anthropic', model: 'model-a', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
              { provider: 'groq', model: 'model-b', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 2 },
              { provider: 'openai', model: 'model-c', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8000, priority: 3 },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            // Make anthropic (highest priority) unavailable
            mockHealthChecker.setAvailableProviders(['groq', 'openai']);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should select groq (next highest priority among available)
            expect(selection.provider).toBe('groq');
            expect(selection.model).toBe('model-b');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * Property: Model selection result SHALL have valid format.
   */
  describe('Model Selection Result Format', () => {
    it('should return a valid ModelSelection with all required fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryClassificationResult,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (classification, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult(classification);
            mockRegistry.setModels(classification.level, models);

            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Selection has all required fields
            expect(selection).toHaveProperty('provider');
            expect(selection).toHaveProperty('model');
            expect(selection).toHaveProperty('estimatedCostPer1KTokens');
            expect(selection).toHaveProperty('complexity');

            // Assert: Provider is valid
            expect(VALID_PROVIDERS).toContain(selection.provider);

            // Assert: Model name is non-empty string
            expect(typeof selection.model).toBe('string');
            expect(selection.model.length).toBeGreaterThan(0);

            // Assert: Cost is non-negative
            expect(selection.estimatedCostPer1KTokens).toBeGreaterThanOrEqual(0);

            // Assert: Complexity is valid
            expect(VALID_COMPLEXITY_LEVELS).toContain(selection.complexity);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate estimatedCostPer1KTokens as sum of input and output costs', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange: Create a model with known costs
            const inputCost = 0.001;
            const outputCost = 0.002;
            const models: ModelConfig[] = [
              {
                provider: 'groq',
                model: 'test-model',
                costPer1KInputTokens: inputCost,
                costPer1KOutputTokens: outputCost,
                maxTokens: 8000,
                priority: 1,
              },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            mockHealthChecker.setAvailableProviders(['groq']);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Cost is sum of input and output costs
            expect(selection.estimatedCostPer1KTokens).toBeCloseTo(inputCost + outputCost, 10);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * Property: Selection should be deterministic for the same inputs.
   */
  describe('Selection Determinism', () => {
    it('should return the same model for identical inputs', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryClassificationResult,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (classification, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult(classification);
            mockRegistry.setModels(classification.level, models);

            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act: Select model twice
            const selection1 = await router.selectModel(task, agentRole);
            const selection2 = await router.selectModel(task, agentRole);

            // Assert: Both selections are identical
            expect(selection1.provider).toBe(selection2.provider);
            expect(selection1.model).toBe(selection2.model);
            expect(selection1.complexity).toBe(selection2.complexity);
            expect(selection1.estimatedCostPer1KTokens).toBe(selection2.estimatedCostPer1KTokens);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * Property: When all models for a level have unavailable providers, should escalate.
   */
  describe('Escalation on No Available Providers', () => {
    it('should escalate to higher complexity when no providers available for current level', async () => {
      // Arrange: Set up models only for 'complex' level with available provider
      const simpleModels: ModelConfig[] = [
        { provider: 'groq', model: 'simple-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
      ];
      const complexModels: ModelConfig[] = [
        { provider: 'anthropic', model: 'complex-model', costPer1KInputTokens: 0.01, costPer1KOutputTokens: 0.02, maxTokens: 8000, priority: 1 },
      ];

      mockClassifier.setClassificationResult({
        level: 'simple',
        confidence: 0.9,
        reasoning: 'Test classification',
      });
      mockRegistry.setModels('simple', simpleModels);
      mockRegistry.setModels('medium', []); // No medium models
      mockRegistry.setModels('complex', complexModels);

      // Make only anthropic available (not groq which is in simple)
      mockHealthChecker.setAvailableProviders(['anthropic']);

      // Act
      const selection = await router.selectModel('test task', 'developer');

      // Assert: Should escalate to complex level
      expect(selection.provider).toBe('anthropic');
      expect(selection.model).toBe('complex-model');
    });

    it('should throw error when no providers available at any level', async () => {
      // Arrange
      const models: ModelConfig[] = [
        { provider: 'groq', model: 'test-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
      ];

      mockClassifier.setClassificationResult({
        level: 'simple',
        confidence: 0.9,
        reasoning: 'Test classification',
      });
      mockRegistry.setModels('simple', models);
      mockRegistry.setModels('medium', models);
      mockRegistry.setModels('complex', models);

      // Make no providers available
      mockHealthChecker.setAvailableProviders([]);

      // Act & Assert
      await expect(router.selectModel('test task', 'developer')).rejects.toThrow();
    });
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * Property: Multiple models from same provider should follow priority ordering.
   */
  describe('Same Provider Priority Ordering', () => {
    it('should select highest priority model when multiple models from same provider exist', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange: Multiple models from same provider with different priorities
            const models: ModelConfig[] = [
              { provider: 'anthropic', model: 'model-low-priority', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 3 },
              { provider: 'anthropic', model: 'model-high-priority', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 1 },
              { provider: 'anthropic', model: 'model-mid-priority', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8000, priority: 2 },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            mockHealthChecker.setAvailableProviders(['anthropic']);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should select the model with lowest priority number
            expect(selection.model).toBe('model-high-priority');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// ============================================================================
// Property 7: API Key Availability Affects Selection
// ============================================================================

/**
 * Property-Based Tests for Model Router
 * Feature: model-router, Property 7: API Key Availability Affects Selection
 *
 * **Validates: Requirements 3.4, 3.5**
 *
 * Property 7: For any model selection request, if the preferred provider lacks a valid
 * API key, the ModelRouter SHALL select a model from an alternative provider that has
 * a valid API key. Models from providers without valid API keys SHALL never be selected.
 */
describe('Property 7: API Key Availability Affects Selection', () => {
  let mockClassifier: MockTaskClassifier;
  let mockRegistry: MockModelRegistry;
  let mockFallback: MockFallbackStrategy;
  let mockMetrics: MockMetricsTracker;
  let mockHealthChecker: MockProviderHealthChecker;
  let router: ModelRouter;

  beforeEach(() => {
    mockClassifier = new MockTaskClassifier();
    mockRegistry = new MockModelRegistry();
    mockFallback = new MockFallbackStrategy();
    mockMetrics = new MockMetricsTracker();
    mockHealthChecker = new MockProviderHealthChecker();

    router = new ModelRouter(
      mockClassifier,
      mockRegistry,
      mockFallback,
      mockMetrics,
      mockHealthChecker
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Property: Models from providers without valid API keys SHALL never be selected.
   */
  describe('Models from Unavailable Providers Are Never Selected', () => {
    it('should never select a model from a provider without a valid API key', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          fc.array(arbitraryProvider, { minLength: 1, maxLength: 3 }).map(p => [...new Set(p)]),
          async (level, task, agentRole, unavailableProviders) => {
            // Arrange: Create models for all providers
            const allProviders: Provider[] = ['groq', 'anthropic', 'openai'];
            const availableProviders = allProviders.filter(
              p => !unavailableProviders.includes(p)
            );

            // Skip if no providers are available
            if (availableProviders.length === 0) {
              return;
            }

            const models: ModelConfig[] = allProviders.map((provider, index) => ({
              provider,
              model: `${provider}-model`,
              costPer1KInputTokens: 0.001 * (index + 1),
              costPer1KOutputTokens: 0.002 * (index + 1),
              maxTokens: 8000,
              priority: index + 1,
            }));

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            mockHealthChecker.setAvailableProviders(availableProviders);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Selected provider must be available (has valid API key)
            expect(availableProviders).toContain(selection.provider);
            expect(unavailableProviders).not.toContain(selection.provider);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never select from unavailable providers even when they have highest priority', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange: Highest priority model is from unavailable provider
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'groq-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 }, // Highest priority but unavailable
              { provider: 'anthropic', model: 'anthropic-model', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 2 },
              { provider: 'openai', model: 'openai-model', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8000, priority: 3 },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            // Make groq (highest priority) unavailable
            mockHealthChecker.setAvailableProviders(['anthropic', 'openai']);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should NOT select groq even though it has highest priority
            expect(selection.provider).not.toBe('groq');
            // Should select anthropic (next highest priority among available)
            expect(selection.provider).toBe('anthropic');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * Property: If preferred provider lacks API key, SHALL select from alternative provider.
   */
  describe('Alternative Provider Selection When Preferred Unavailable', () => {
    it('should select from alternative provider when preferred provider lacks API key', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          arbitraryProvider,
          async (level, task, agentRole, preferredProvider) => {
            // Arrange: Create models with preferred provider having highest priority
            const allProviders: Provider[] = ['groq', 'anthropic', 'openai'];
            const alternativeProviders = allProviders.filter(p => p !== preferredProvider);

            const models: ModelConfig[] = [
              { provider: preferredProvider, model: `${preferredProvider}-model`, costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
              ...alternativeProviders.map((provider, index) => ({
                provider,
                model: `${provider}-model`,
                costPer1KInputTokens: 0.002 * (index + 1),
                costPer1KOutputTokens: 0.004 * (index + 1),
                maxTokens: 8000,
                priority: index + 2,
              })),
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            // Make preferred provider unavailable
            mockHealthChecker.setAvailableProviders(alternativeProviders);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should select from alternative provider
            expect(alternativeProviders).toContain(selection.provider);
            expect(selection.provider).not.toBe(preferredProvider);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should select highest priority alternative when preferred provider is unavailable', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange: Preferred provider (groq) unavailable, alternatives have distinct priorities
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'groq-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 }, // Preferred but unavailable
              { provider: 'openai', model: 'openai-model', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8000, priority: 3 },
              { provider: 'anthropic', model: 'anthropic-model', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 2 }, // Highest priority alternative
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            mockHealthChecker.setAvailableProviders(['anthropic', 'openai']);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should select anthropic (highest priority among available alternatives)
            expect(selection.provider).toBe('anthropic');
            expect(selection.model).toBe('anthropic-model');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.4, 3.5**
   *
   * Property: Selection should work correctly with various combinations of available/unavailable providers.
   */
  describe('Various Provider Availability Combinations', () => {
    it('should handle single available provider correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          arbitraryProvider,
          async (level, task, agentRole, singleAvailableProvider) => {
            // Arrange: Only one provider is available
            const allProviders: Provider[] = ['groq', 'anthropic', 'openai'];
            const models: ModelConfig[] = allProviders.map((provider, index) => ({
              provider,
              model: `${provider}-model`,
              costPer1KInputTokens: 0.001 * (index + 1),
              costPer1KOutputTokens: 0.002 * (index + 1),
              maxTokens: 8000,
              priority: index + 1,
            }));

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            mockHealthChecker.setAvailableProviders([singleAvailableProvider]);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Must select from the only available provider
            expect(selection.provider).toBe(singleAvailableProvider);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle two available providers correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          fc.tuple(arbitraryProvider, arbitraryProvider).filter(([a, b]) => a !== b),
          async (level, task, agentRole, [provider1, provider2]) => {
            // Arrange: Two providers available
            const availableProviders: Provider[] = [provider1, provider2];
            const allProviders: Provider[] = ['groq', 'anthropic', 'openai'];
            
            const models: ModelConfig[] = allProviders.map((provider, index) => ({
              provider,
              model: `${provider}-model`,
              costPer1KInputTokens: 0.001 * (index + 1),
              costPer1KOutputTokens: 0.002 * (index + 1),
              maxTokens: 8000,
              priority: index + 1,
            }));

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            mockHealthChecker.setAvailableProviders(availableProviders);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Must select from one of the available providers
            expect(availableProviders).toContain(selection.provider);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should throw error when no providers are available', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange: No providers available
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'groq-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
              { provider: 'anthropic', model: 'anthropic-model', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 2 },
              { provider: 'openai', model: 'openai-model', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8000, priority: 3 },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);
            mockHealthChecker.setAvailableProviders([]);

            // Act & Assert: Should throw error
            await expect(router.selectModel(task, agentRole)).rejects.toThrow();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.4, 3.5**
   *
   * Property: Provider availability should be checked before model selection.
   */
  describe('Provider Availability Verification', () => {
    it('should verify provider availability for every model selection', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);

            // Get unique providers from models
            const providersInModels = [...new Set(models.map(m => m.provider))];
            
            // Make at least one provider available
            if (providersInModels.length === 0) {
              return;
            }
            
            // Randomly select which providers are available
            const availableProviders = providersInModels.slice(0, Math.max(1, Math.floor(providersInModels.length / 2) + 1));
            mockHealthChecker.setAvailableProviders(availableProviders);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Selected provider must be in the available list
            expect(availableProviders).toContain(selection.provider);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should respect dynamic provider availability changes', async () => {
      // Arrange: Start with all providers available
      const models: ModelConfig[] = [
        { provider: 'groq', model: 'groq-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
        { provider: 'anthropic', model: 'anthropic-model', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 2 },
      ];

      mockClassifier.setClassificationResult({
        level: 'medium',
        confidence: 0.9,
        reasoning: 'Test classification',
      });
      mockRegistry.setModels('medium', models);
      mockHealthChecker.setAvailableProviders(['groq', 'anthropic']);

      // Act 1: First selection with all providers available
      const selection1 = await router.selectModel('test task', 'developer');
      expect(selection1.provider).toBe('groq'); // Highest priority

      // Change availability: make groq unavailable
      mockHealthChecker.setAvailableProviders(['anthropic']);

      // Act 2: Second selection with groq unavailable
      const selection2 = await router.selectModel('test task', 'developer');
      
      // Assert: Should now select anthropic
      expect(selection2.provider).toBe('anthropic');
    });
  });

  /**
   * **Validates: Requirements 3.4, 3.5**
   *
   * Property: Escalation should also respect provider availability.
   */
  describe('Escalation Respects Provider Availability', () => {
    it('should escalate to higher complexity while respecting provider availability', async () => {
      // Arrange: Simple level has only unavailable provider, complex has available provider
      const simpleModels: ModelConfig[] = [
        { provider: 'groq', model: 'groq-simple', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
      ];
      const mediumModels: ModelConfig[] = [
        { provider: 'groq', model: 'groq-medium', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 1 },
      ];
      const complexModels: ModelConfig[] = [
        { provider: 'anthropic', model: 'anthropic-complex', costPer1KInputTokens: 0.01, costPer1KOutputTokens: 0.02, maxTokens: 8000, priority: 1 },
      ];

      mockClassifier.setClassificationResult({
        level: 'simple',
        confidence: 0.9,
        reasoning: 'Test classification',
      });
      mockRegistry.setModels('simple', simpleModels);
      mockRegistry.setModels('medium', mediumModels);
      mockRegistry.setModels('complex', complexModels);
      
      // Only anthropic is available (groq is unavailable)
      mockHealthChecker.setAvailableProviders(['anthropic']);

      // Act
      const selection = await router.selectModel('test task', 'developer');

      // Assert: Should escalate to complex level where anthropic is available
      expect(selection.provider).toBe('anthropic');
      expect(selection.model).toBe('anthropic-complex');
      expect(selection.complexity).toBe('complex');
    });

    it('should skip complexity levels with no available providers during escalation', async () => {
      // Arrange: Simple and medium have unavailable providers, complex has available
      const simpleModels: ModelConfig[] = [
        { provider: 'groq', model: 'groq-simple', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
      ];
      const mediumModels: ModelConfig[] = [
        { provider: 'openai', model: 'openai-medium', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 1 },
      ];
      const complexModels: ModelConfig[] = [
        { provider: 'anthropic', model: 'anthropic-complex', costPer1KInputTokens: 0.01, costPer1KOutputTokens: 0.02, maxTokens: 8000, priority: 1 },
      ];

      mockClassifier.setClassificationResult({
        level: 'simple',
        confidence: 0.9,
        reasoning: 'Test classification',
      });
      mockRegistry.setModels('simple', simpleModels);
      mockRegistry.setModels('medium', mediumModels);
      mockRegistry.setModels('complex', complexModels);
      
      // Only anthropic is available
      mockHealthChecker.setAvailableProviders(['anthropic']);

      // Act
      const selection = await router.selectModel('test task', 'developer');

      // Assert: Should skip simple (groq) and medium (openai), select from complex (anthropic)
      expect(selection.provider).toBe('anthropic');
      expect(selection.complexity).toBe('complex');
    });
  });
});


// ============================================================================
// Property 13: Model Selection Result Format
// ============================================================================

/**
 * Property-Based Tests for Model Router
 * Feature: model-router, Property 13: Model Selection Result Format
 *
 * **Validates: Requirements 5.3**
 *
 * Property 13: For any successful model selection, the returned ModelSelection object
 * SHALL contain: a valid provider identifier, a non-empty model name string, and a
 * non-negative estimated cost per 1K tokens.
 */
describe('Property 13: Model Selection Result Format', () => {
  let mockClassifier: MockTaskClassifier;
  let mockRegistry: MockModelRegistry;
  let mockFallback: MockFallbackStrategy;
  let mockMetrics: MockMetricsTracker;
  let mockHealthChecker: MockProviderHealthChecker;
  let router: ModelRouter;

  beforeEach(() => {
    mockClassifier = new MockTaskClassifier();
    mockRegistry = new MockModelRegistry();
    mockFallback = new MockFallbackStrategy();
    mockMetrics = new MockMetricsTracker();
    mockHealthChecker = new MockProviderHealthChecker();

    router = new ModelRouter(
      mockClassifier,
      mockRegistry,
      mockFallback,
      mockMetrics,
      mockHealthChecker
    );
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * Property: Successful selection SHALL contain a valid provider (groq, anthropic, openai).
   */
  describe('Valid Provider Identifier', () => {
    it('should always return a valid provider identifier from the allowed set', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryClassificationResult,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (classification, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult(classification);
            mockRegistry.setModels(classification.level, models);

            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Provider must be one of the valid providers
            const validProviders: Provider[] = ['groq', 'anthropic', 'openai'];
            expect(validProviders).toContain(selection.provider);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return provider as a string type', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);

            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Provider must be a string
            expect(typeof selection.provider).toBe('string');
            expect(selection.provider.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * Property: Successful selection SHALL contain a non-empty model name.
   */
  describe('Non-Empty Model Name', () => {
    it('should always return a non-empty model name string', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryClassificationResult,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (classification, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult(classification);
            mockRegistry.setModels(classification.level, models);

            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Model name must be a non-empty string
            expect(typeof selection.model).toBe('string');
            expect(selection.model.length).toBeGreaterThan(0);
            expect(selection.model.trim().length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return model name that matches one from the registry', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);

            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Model name must exist in the registry
            const registryModels = mockRegistry.getModels(level);
            const modelNames = registryModels.map(m => m.model);
            expect(modelNames).toContain(selection.model);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * Property: Successful selection SHALL contain a non-negative cost.
   */
  describe('Non-Negative Cost', () => {
    it('should always return a non-negative estimated cost per 1K tokens', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryClassificationResult,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (classification, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult(classification);
            mockRegistry.setModels(classification.level, models);

            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Cost must be non-negative
            expect(selection.estimatedCostPer1KTokens).toBeGreaterThanOrEqual(0);
            expect(typeof selection.estimatedCostPer1KTokens).toBe('number');
            expect(Number.isNaN(selection.estimatedCostPer1KTokens)).toBe(false);
            expect(Number.isFinite(selection.estimatedCostPer1KTokens)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate cost as sum of input and output costs from registry', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          fc.double({ min: 0.0001, max: 0.1, noNaN: true }),
          fc.double({ min: 0.0001, max: 0.1, noNaN: true }),
          async (level, task, agentRole, inputCost, outputCost) => {
            // Arrange: Create a model with specific costs
            const models: ModelConfig[] = [
              {
                provider: 'groq',
                model: 'test-model',
                costPer1KInputTokens: inputCost,
                costPer1KOutputTokens: outputCost,
                maxTokens: 8000,
                priority: 1,
              },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            mockHealthChecker.setAvailableProviders(['groq']);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Cost should be sum of input and output costs
            const expectedCost = inputCost + outputCost;
            expect(selection.estimatedCostPer1KTokens).toBeCloseTo(expectedCost, 10);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle zero cost models correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange: Create a model with zero costs (e.g., free tier)
            const models: ModelConfig[] = [
              {
                provider: 'groq',
                model: 'free-model',
                costPer1KInputTokens: 0,
                costPer1KOutputTokens: 0,
                maxTokens: 8000,
                priority: 1,
              },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);
            mockHealthChecker.setAvailableProviders(['groq']);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Cost should be exactly 0 (still non-negative)
            expect(selection.estimatedCostPer1KTokens).toBe(0);
            expect(selection.estimatedCostPer1KTokens).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * Property: Successful selection SHALL contain a valid complexity level.
   */
  describe('Valid Complexity Level', () => {
    it('should always return a valid complexity level (simple, medium, complex)', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryClassificationResult,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (classification, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult(classification);
            mockRegistry.setModels(classification.level, models);

            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Complexity must be one of the valid levels
            const validComplexityLevels: ComplexityLevel[] = ['simple', 'medium', 'complex'];
            expect(validComplexityLevels).toContain(selection.complexity);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return complexity as a string type', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);

            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Complexity must be a string
            expect(typeof selection.complexity).toBe('string');
            expect(selection.complexity.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should match or escalate from the classified complexity level', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);

            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Complexity should be at least the classified level (can escalate but not downgrade)
            const complexityOrder: ComplexityLevel[] = ['simple', 'medium', 'complex'];
            const classifiedIndex = complexityOrder.indexOf(level);
            const selectedIndex = complexityOrder.indexOf(selection.complexity);
            
            expect(selectedIndex).toBeGreaterThanOrEqual(classifiedIndex);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * Property: All required fields must be present in the ModelSelection object.
   */
  describe('Complete ModelSelection Object', () => {
    it('should return a ModelSelection with all four required fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryClassificationResult,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (classification, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult(classification);
            mockRegistry.setModels(classification.level, models);

            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: All required fields must be present
            expect(selection).toHaveProperty('provider');
            expect(selection).toHaveProperty('model');
            expect(selection).toHaveProperty('estimatedCostPer1KTokens');
            expect(selection).toHaveProperty('complexity');

            // Assert: No undefined or null values for required fields
            expect(selection.provider).toBeDefined();
            expect(selection.provider).not.toBeNull();
            expect(selection.model).toBeDefined();
            expect(selection.model).not.toBeNull();
            expect(selection.estimatedCostPer1KTokens).toBeDefined();
            expect(selection.estimatedCostPer1KTokens).not.toBeNull();
            expect(selection.complexity).toBeDefined();
            expect(selection.complexity).not.toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return consistent field types across all selections', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryModelConfigArray,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, models, task, agentRole) => {
            // Arrange
            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });
            mockRegistry.setModels(level, models);

            const providersInModels = [...new Set(models.map(m => m.provider))];
            mockHealthChecker.setAvailableProviders(providersInModels);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Field types are correct
            expect(typeof selection.provider).toBe('string');
            expect(typeof selection.model).toBe('string');
            expect(typeof selection.estimatedCostPer1KTokens).toBe('number');
            expect(typeof selection.complexity).toBe('string');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// ============================================================================
// Property 17: Agent Override Application
// ============================================================================

/**
 * Property-Based Tests for Model Router
 * Feature: model-router, Property 17: Agent Override Application
 *
 * **Validates: Requirements 8.2, 8.3**
 *
 * Property 17: For any agent with a configured override, the ModelRouter SHALL apply
 * the override instead of complexity-based selection. If the override specifies a
 * minimum complexity level, tasks classified below that level SHALL be elevated.
 * If the override specifies a preferred provider or specific model, that SHALL be
 * used regardless of default priority.
 */
describe('Property 17: Agent Override Application', () => {
  let mockClassifier: MockTaskClassifier;
  let mockRegistry: MockModelRegistry;
  let mockFallback: MockFallbackStrategy;
  let mockMetrics: MockMetricsTracker;
  let mockHealthChecker: MockProviderHealthChecker;
  let router: ModelRouter;

  beforeEach(() => {
    mockClassifier = new MockTaskClassifier();
    mockRegistry = new MockModelRegistry();
    mockFallback = new MockFallbackStrategy();
    mockMetrics = new MockMetricsTracker();
    mockHealthChecker = new MockProviderHealthChecker();

    router = new ModelRouter(
      mockClassifier,
      mockRegistry,
      mockFallback,
      mockMetrics,
      mockHealthChecker
    );
  });

  /**
   * **Validates: Requirements 8.2**
   *
   * Property: Agents with overrides SHALL use override instead of complexity-based selection.
   */
  describe('Override Takes Precedence Over Complexity-Based Selection', () => {
    it('should use override configuration when agent has a configured override', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (classifiedLevel, task, agentRole) => {
            // Arrange: Set up classification and models for all levels
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'groq-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
              { provider: 'anthropic', model: 'anthropic-model', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 2 },
              { provider: 'openai', model: 'openai-model', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8000, priority: 3 },
            ];

            mockClassifier.setClassificationResult({
              level: classifiedLevel,
              confidence: 0.9,
              reasoning: 'Test classification',
            });

            // Set up models for all complexity levels
            mockRegistry.setModels('simple', models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);
            mockHealthChecker.setAvailableProviders(['groq', 'anthropic', 'openai']);

            // Set up override with minimum complexity of 'complex'
            const override: AgentOverride = {
              agentRole,
              minimumComplexity: 'complex',
              reason: 'Test override for critical agent',
            };
            mockRegistry.setAgentOverride(override);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should use complex level regardless of classification
            expect(selection.complexity).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should apply override for agent while other agents use normal selection', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryTaskDescription,
          async (task) => {
            // Arrange: Set up models
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'groq-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
              { provider: 'anthropic', model: 'anthropic-model', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 2 },
            ];

            mockClassifier.setClassificationResult({
              level: 'simple',
              confidence: 0.9,
              reasoning: 'Test classification',
            });

            mockRegistry.setModels('simple', models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);
            mockHealthChecker.setAvailableProviders(['groq', 'anthropic']);

            // Set up override only for 'architect' agent
            const override: AgentOverride = {
              agentRole: 'architect',
              minimumComplexity: 'complex',
              reason: 'Architecture decisions require deep reasoning',
            };
            mockRegistry.setAgentOverride(override);

            // Act: Select for architect (has override) and developer (no override)
            const architectSelection = await router.selectModel(task, 'architect');
            const developerSelection = await router.selectModel(task, 'developer');

            // Assert: Architect should use complex, developer should use simple
            expect(architectSelection.complexity).toBe('complex');
            expect(developerSelection.complexity).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * Property: Minimum complexity overrides SHALL elevate lower classifications.
   */
  describe('Minimum Complexity Elevation', () => {
    it('should elevate simple to medium when minimumComplexity is medium', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (task, agentRole) => {
            // Arrange
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'groq-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
            ];

            mockClassifier.setClassificationResult({
              level: 'simple',
              confidence: 0.9,
              reasoning: 'Simple task',
            });

            mockRegistry.setModels('simple', models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);
            mockHealthChecker.setAvailableProviders(['groq']);

            // Set up override with minimum complexity of 'medium'
            const override: AgentOverride = {
              agentRole,
              minimumComplexity: 'medium',
              reason: 'Agent requires at least medium complexity',
            };
            mockRegistry.setAgentOverride(override);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should elevate from simple to medium
            expect(selection.complexity).toBe('medium');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should elevate simple to complex when minimumComplexity is complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (task, agentRole) => {
            // Arrange
            const models: ModelConfig[] = [
              { provider: 'anthropic', model: 'anthropic-model', costPer1KInputTokens: 0.01, costPer1KOutputTokens: 0.02, maxTokens: 8000, priority: 1 },
            ];

            mockClassifier.setClassificationResult({
              level: 'simple',
              confidence: 0.9,
              reasoning: 'Simple task',
            });

            mockRegistry.setModels('simple', models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);
            mockHealthChecker.setAvailableProviders(['anthropic']);

            // Set up override with minimum complexity of 'complex'
            const override: AgentOverride = {
              agentRole,
              minimumComplexity: 'complex',
              reason: 'Agent requires complex models',
            };
            mockRegistry.setAgentOverride(override);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should elevate from simple to complex
            expect(selection.complexity).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should elevate medium to complex when minimumComplexity is complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (task, agentRole) => {
            // Arrange
            const models: ModelConfig[] = [
              { provider: 'openai', model: 'openai-model', costPer1KInputTokens: 0.005, costPer1KOutputTokens: 0.01, maxTokens: 8000, priority: 1 },
            ];

            mockClassifier.setClassificationResult({
              level: 'medium',
              confidence: 0.85,
              reasoning: 'Medium task',
            });

            mockRegistry.setModels('simple', models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);
            mockHealthChecker.setAvailableProviders(['openai']);

            // Set up override with minimum complexity of 'complex'
            const override: AgentOverride = {
              agentRole,
              minimumComplexity: 'complex',
              reason: 'Agent requires complex models',
            };
            mockRegistry.setAgentOverride(override);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should elevate from medium to complex
            expect(selection.complexity).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should NOT downgrade complexity when classification is higher than minimum', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (task, agentRole) => {
            // Arrange
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'groq-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
            ];

            // Task is classified as complex
            mockClassifier.setClassificationResult({
              level: 'complex',
              confidence: 0.95,
              reasoning: 'Complex task',
            });

            mockRegistry.setModels('simple', models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);
            mockHealthChecker.setAvailableProviders(['groq']);

            // Set up override with minimum complexity of 'simple' (lower than classification)
            const override: AgentOverride = {
              agentRole,
              minimumComplexity: 'simple',
              reason: 'Agent has low minimum requirement',
            };
            mockRegistry.setAgentOverride(override);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should keep complex (not downgrade to simple)
            expect(selection.complexity).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should keep same complexity when classification equals minimum', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange
            const models: ModelConfig[] = [
              { provider: 'anthropic', model: 'anthropic-model', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 1 },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });

            mockRegistry.setModels('simple', models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);
            mockHealthChecker.setAvailableProviders(['anthropic']);

            // Set up override with same minimum complexity as classification
            const override: AgentOverride = {
              agentRole,
              minimumComplexity: level,
              reason: 'Agent minimum matches classification',
            };
            mockRegistry.setAgentOverride(override);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should keep the same complexity level
            expect(selection.complexity).toBe(level);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * Property: Preferred provider in override SHALL be used when available.
   */
  describe('Preferred Provider Override', () => {
    it('should use preferred provider from override when available', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          arbitraryProvider,
          async (level, task, agentRole, preferredProvider) => {
            // Arrange: Create models with different providers
            const allProviders: Provider[] = ['groq', 'anthropic', 'openai'];
            const models: ModelConfig[] = allProviders.map((provider, index) => ({
              provider,
              model: `${provider}-model`,
              costPer1KInputTokens: 0.001 * (index + 1),
              costPer1KOutputTokens: 0.002 * (index + 1),
              maxTokens: 8000,
              // Make the preferred provider NOT the highest priority by default
              priority: provider === preferredProvider ? 3 : index + 1,
            }));

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });

            mockRegistry.setModels('simple', models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);
            mockHealthChecker.setAvailableProviders(allProviders);

            // Set up override with preferred provider
            const override: AgentOverride = {
              agentRole,
              preferredProvider,
              reason: `Agent prefers ${preferredProvider}`,
            };
            mockRegistry.setAgentOverride(override);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should use the preferred provider from override
            expect(selection.provider).toBe(preferredProvider);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should fall back to normal selection when preferred provider is unavailable', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange: Create models with different providers
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'groq-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
              { provider: 'anthropic', model: 'anthropic-model', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 2 },
              { provider: 'openai', model: 'openai-model', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8000, priority: 3 },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });

            mockRegistry.setModels('simple', models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);

            // Make openai (the preferred provider in override) unavailable
            mockHealthChecker.setAvailableProviders(['groq', 'anthropic']);

            // Set up override with preferred provider that is unavailable
            const override: AgentOverride = {
              agentRole,
              preferredProvider: 'openai',
              reason: 'Agent prefers openai but it is unavailable',
            };
            mockRegistry.setAgentOverride(override);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should fall back to normal selection (groq has highest priority among available)
            expect(selection.provider).not.toBe('openai');
            expect(['groq', 'anthropic']).toContain(selection.provider);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * Property: Specific model in override SHALL be used when available.
   */
  describe('Specific Model Override', () => {
    it('should use specific model from override when available', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange: Create models with specific model having low priority
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'groq-default', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
              { provider: 'anthropic', model: 'claude-opus-special', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8000, priority: 3 },
              { provider: 'openai', model: 'openai-default', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.006, maxTokens: 8000, priority: 2 },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });

            mockRegistry.setModels('simple', models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);
            mockHealthChecker.setAvailableProviders(['groq', 'anthropic', 'openai']);

            // Set up override with specific model
            const override: AgentOverride = {
              agentRole,
              preferredProvider: 'anthropic',
              specificModel: 'claude-opus-special',
              reason: 'Agent requires specific model',
            };
            mockRegistry.setAgentOverride(override);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should use the specific model from override
            expect(selection.provider).toBe('anthropic');
            expect(selection.model).toBe('claude-opus-special');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should fall back when specific model is not found in registry', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange: Create models without the specific model in override
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'groq-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
              { provider: 'anthropic', model: 'anthropic-model', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 2 },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });

            mockRegistry.setModels('simple', models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);
            mockHealthChecker.setAvailableProviders(['groq', 'anthropic']);

            // Set up override with specific model that doesn't exist
            const override: AgentOverride = {
              agentRole,
              preferredProvider: 'anthropic',
              specificModel: 'non-existent-model',
              reason: 'Agent wants non-existent model',
            };
            mockRegistry.setAgentOverride(override);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should fall back to normal selection
            expect(['groq', 'anthropic']).toContain(selection.provider);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should fall back when specific model provider is unavailable', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'groq-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
              { provider: 'anthropic', model: 'claude-special', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8000, priority: 2 },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });

            mockRegistry.setModels('simple', models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);

            // Make anthropic unavailable
            mockHealthChecker.setAvailableProviders(['groq']);

            // Set up override with specific model from unavailable provider
            const override: AgentOverride = {
              agentRole,
              preferredProvider: 'anthropic',
              specificModel: 'claude-special',
              reason: 'Agent wants anthropic model but provider is unavailable',
            };
            mockRegistry.setAgentOverride(override);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should fall back to available provider
            expect(selection.provider).toBe('groq');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 8.2, 8.3**
   *
   * Property: Combined override settings should work together correctly.
   */
  describe('Combined Override Settings', () => {
    it('should apply both minimumComplexity and preferredProvider together', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (task, agentRole) => {
            // Arrange: Create models for all levels
            const simpleModels: ModelConfig[] = [
              { provider: 'groq', model: 'groq-simple', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
            ];
            const complexModels: ModelConfig[] = [
              { provider: 'groq', model: 'groq-complex', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
              { provider: 'anthropic', model: 'anthropic-complex', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8000, priority: 2 },
            ];

            mockClassifier.setClassificationResult({
              level: 'simple',
              confidence: 0.9,
              reasoning: 'Simple task',
            });

            mockRegistry.setModels('simple', simpleModels);
            mockRegistry.setModels('medium', complexModels);
            mockRegistry.setModels('complex', complexModels);
            mockHealthChecker.setAvailableProviders(['groq', 'anthropic']);

            // Set up override with both minimumComplexity and preferredProvider
            const override: AgentOverride = {
              agentRole,
              minimumComplexity: 'complex',
              preferredProvider: 'anthropic',
              reason: 'Agent requires complex level with anthropic',
            };
            mockRegistry.setAgentOverride(override);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should elevate to complex AND use anthropic
            expect(selection.complexity).toBe('complex');
            expect(selection.provider).toBe('anthropic');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should apply minimumComplexity, preferredProvider, and specificModel together', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (task, agentRole) => {
            // Arrange
            const complexModels: ModelConfig[] = [
              { provider: 'groq', model: 'groq-complex', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
              { provider: 'anthropic', model: 'claude-opus-4', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8000, priority: 2 },
              { provider: 'anthropic', model: 'claude-sonnet-4', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.015, maxTokens: 8000, priority: 3 },
            ];

            mockClassifier.setClassificationResult({
              level: 'simple',
              confidence: 0.9,
              reasoning: 'Simple task',
            });

            mockRegistry.setModels('simple', complexModels);
            mockRegistry.setModels('medium', complexModels);
            mockRegistry.setModels('complex', complexModels);
            mockHealthChecker.setAvailableProviders(['groq', 'anthropic']);

            // Set up override with all three settings
            const override: AgentOverride = {
              agentRole,
              minimumComplexity: 'complex',
              preferredProvider: 'anthropic',
              specificModel: 'claude-opus-4',
              reason: 'Agent requires specific complex anthropic model',
            };
            mockRegistry.setAgentOverride(override);

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should elevate to complex, use anthropic, and select specific model
            expect(selection.complexity).toBe('complex');
            expect(selection.provider).toBe('anthropic');
            expect(selection.model).toBe('claude-opus-4');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 8.2, 8.3**
   *
   * Property: Agents without overrides should use normal complexity-based selection.
   */
  describe('No Override Behavior', () => {
    it('should use normal complexity-based selection when no override is configured', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryTaskDescription,
          arbitraryAgentRole,
          async (level, task, agentRole) => {
            // Arrange
            const models: ModelConfig[] = [
              { provider: 'groq', model: 'groq-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
              { provider: 'anthropic', model: 'anthropic-model', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 2 },
            ];

            mockClassifier.setClassificationResult({
              level,
              confidence: 0.9,
              reasoning: 'Test classification',
            });

            mockRegistry.setModels('simple', models);
            mockRegistry.setModels('medium', models);
            mockRegistry.setModels('complex', models);
            mockHealthChecker.setAvailableProviders(['groq', 'anthropic']);

            // No override configured for this agent

            // Act
            const selection = await router.selectModel(task, agentRole);

            // Assert: Should use the classified complexity level
            expect(selection.complexity).toBe(level);
            // Should use highest priority available model (groq)
            expect(selection.provider).toBe('groq');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
