/**
 * Unit Tests for Model Router
 *
 * Example-based tests that verify specific known inputs and expected outputs.
 * Tests model selection, fallback handling, metrics recording, and availability.
 *
 * **Validates: Requirements 3.1, 3.2, 3.4, 8.2, 8.4**
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ModelRouter } from './model-router-impl.js';
import type {
  ComplexityLevel,
  Provider,
  ClassificationResult,
  ModelSelection,
  ExecutionMetrics,
} from './model-router.js';
import type { ITaskClassifier } from './task-classifier.js';
import type { IModelRegistry, ModelConfig, AgentOverride } from './model-registry.js';
import type { IFallbackStrategy, FallbackAction, FallbackAttempt } from './fallback-strategy.js';
import type { IMetricsTracker, AggregatedMetrics, TimeRange } from './metrics-tracker.js';
import type { IProviderHealthChecker, ProviderHealth } from './provider-health.js';
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

  clearAgentOverrides(): void {
    this.agentOverrides.clear();
  }

  updateConfig(level: ComplexityLevel, models: ModelConfig[]): void {
    this.modelMappings[level] = [...models];
  }

  validate(): void {
    // No-op for mock
  }
}

/**
 * Mock FallbackStrategy with configurable behavior
 */
class MockFallbackStrategy implements IFallbackStrategy {
  private nextAction: FallbackAction = { type: 'fail', reason: 'Mock fallback exhausted' };

  setNextAction(action: FallbackAction): void {
    this.nextAction = action;
  }

  async getNextAction(
    _error: Error,
    _currentModel: ModelSelection,
    _attempts: FallbackAttempt[]
  ): Promise<FallbackAction> {
    return this.nextAction;
  }

  isRateLimitError(_error: Error): boolean {
    return false;
  }

  getRetryAfterMs(_error: Error): number | null {
    return null;
  }
}

/**
 * Mock MetricsTracker that records tracked metrics
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

  clearTrackedMetrics(): void {
    this.trackedMetrics = [];
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
// Test Suite
// ============================================================================

describe('ModelRouter', () => {
  let mockClassifier: MockTaskClassifier;
  let mockRegistry: MockModelRegistry;
  let mockFallback: MockFallbackStrategy;
  let mockMetrics: MockMetricsTracker;
  let mockHealthChecker: MockProviderHealthChecker;
  let router: ModelRouter;

  // Default test models
  const simpleModels: ModelConfig[] = [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 1 },
    { provider: 'anthropic', model: 'claude-3-5-haiku', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.005, maxTokens: 8192, priority: 2 },
    { provider: 'openai', model: 'gpt-4o-mini', costPer1KInputTokens: 0.00015, costPer1KOutputTokens: 0.0006, maxTokens: 16384, priority: 3 },
  ];

  const mediumModels: ModelConfig[] = [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 1 },
    { provider: 'anthropic', model: 'claude-sonnet-4', costPer1KInputTokens: 0.003, costPer1KOutputTokens: 0.015, maxTokens: 8192, priority: 2 },
    { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 3 },
  ];

  const complexModels: ModelConfig[] = [
    { provider: 'anthropic', model: 'claude-opus-4', costPer1KInputTokens: 0.015, costPer1KOutputTokens: 0.075, maxTokens: 8192, priority: 1 },
    { provider: 'openai', model: 'gpt-4o', costPer1KInputTokens: 0.0025, costPer1KOutputTokens: 0.01, maxTokens: 16384, priority: 2 },
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costPer1KInputTokens: 0.00059, costPer1KOutputTokens: 0.00079, maxTokens: 32768, priority: 3 },
  ];

  beforeEach(() => {
    mockClassifier = new MockTaskClassifier();
    mockRegistry = new MockModelRegistry();
    mockFallback = new MockFallbackStrategy();
    mockMetrics = new MockMetricsTracker();
    mockHealthChecker = new MockProviderHealthChecker();

    // Set up default models
    mockRegistry.setModels('simple', simpleModels);
    mockRegistry.setModels('medium', mediumModels);
    mockRegistry.setModels('complex', complexModels);

    router = new ModelRouter(
      mockClassifier,
      mockRegistry,
      mockFallback,
      mockMetrics,
      mockHealthChecker
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Requirement 3.1: Model Selection for Each Complexity Level
  // ==========================================================================
  describe('selectModel() - Model Selection for Complexity Levels', () => {
    it('should return correct model for simple tasks', async () => {
      mockClassifier.setClassificationResult({
        level: 'simple',
        confidence: 0.9,
        reasoning: 'Simple task',
      });

      const selection = await router.selectModel('format the code', 'developer');

      expect(selection.complexity).toBe('simple');
      expect(selection.provider).toBe('groq');
      expect(selection.model).toBe('llama-3.3-70b-versatile');
    });

    it('should return correct model for medium tasks', async () => {
      mockClassifier.setClassificationResult({
        level: 'medium',
        confidence: 0.85,
        reasoning: 'Medium task',
      });

      const selection = await router.selectModel('refactor the module', 'developer');

      expect(selection.complexity).toBe('medium');
      expect(selection.provider).toBe('groq');
      expect(selection.model).toBe('llama-3.3-70b-versatile');
    });

    it('should return correct model for complex tasks', async () => {
      mockClassifier.setClassificationResult({
        level: 'complex',
        confidence: 0.95,
        reasoning: 'Complex task',
      });

      const selection = await router.selectModel('design system architecture', 'developer');

      expect(selection.complexity).toBe('complex');
      expect(selection.provider).toBe('anthropic');
      expect(selection.model).toBe('claude-opus-4');
    });

    it('should calculate estimatedCostPer1KTokens as sum of input and output costs', async () => {
      mockClassifier.setClassificationResult({
        level: 'simple',
        confidence: 0.9,
        reasoning: 'Simple task',
      });

      const selection = await router.selectModel('format code', 'developer');

      // groq model: 0.00059 + 0.00079 = 0.00138
      expect(selection.estimatedCostPer1KTokens).toBeCloseTo(0.00138, 5);
    });
  });

  // ==========================================================================
  // Requirement 3.2: Provider Priority Ordering
  // ==========================================================================
  describe('selectModel() - Provider Priority Ordering', () => {
    it('should select highest priority model (lowest priority number)', async () => {
      mockClassifier.setClassificationResult({
        level: 'medium',
        confidence: 0.9,
        reasoning: 'Medium task',
      });

      const selection = await router.selectModel('implement feature', 'developer');

      // groq has priority 1 (highest)
      expect(selection.provider).toBe('groq');
    });

    it('should select next priority model when highest priority unavailable', async () => {
      mockClassifier.setClassificationResult({
        level: 'medium',
        confidence: 0.9,
        reasoning: 'Medium task',
      });
      mockHealthChecker.setAvailableProviders(['anthropic', 'openai']);

      const selection = await router.selectModel('implement feature', 'developer');

      // anthropic has priority 2 (next highest)
      expect(selection.provider).toBe('anthropic');
      expect(selection.model).toBe('claude-sonnet-4');
    });

    it('should select third priority model when first two unavailable', async () => {
      mockClassifier.setClassificationResult({
        level: 'medium',
        confidence: 0.9,
        reasoning: 'Medium task',
      });
      mockHealthChecker.setAvailableProviders(['openai']);

      const selection = await router.selectModel('implement feature', 'developer');

      // openai has priority 3
      expect(selection.provider).toBe('openai');
      expect(selection.model).toBe('gpt-4o');
    });
  });

  // ==========================================================================
  // Requirement 3.4: Fallback to Alternative Provider
  // ==========================================================================
  describe('selectModel() - Fallback to Alternative Provider', () => {
    it('should fallback to alternative provider when preferred unavailable', async () => {
      mockClassifier.setClassificationResult({
        level: 'simple',
        confidence: 0.9,
        reasoning: 'Simple task',
      });
      // Only anthropic available
      mockHealthChecker.setAvailableProviders(['anthropic']);

      const selection = await router.selectModel('format code', 'developer');

      expect(selection.provider).toBe('anthropic');
      expect(selection.model).toBe('claude-3-5-haiku');
    });

    it('should escalate to higher complexity when no providers available at current level', async () => {
      mockClassifier.setClassificationResult({
        level: 'simple',
        confidence: 0.9,
        reasoning: 'Simple task',
      });

      // Set up simple models with only groq
      mockRegistry.setModels('simple', [
        { provider: 'groq', model: 'simple-model', costPer1KInputTokens: 0.001, costPer1KOutputTokens: 0.002, maxTokens: 8000, priority: 1 },
      ]);
      // Set up medium models with only anthropic
      mockRegistry.setModels('medium', [
        { provider: 'anthropic', model: 'medium-model', costPer1KInputTokens: 0.002, costPer1KOutputTokens: 0.004, maxTokens: 8000, priority: 1 },
      ]);

      // Only anthropic available (not groq)
      mockHealthChecker.setAvailableProviders(['anthropic']);

      const selection = await router.selectModel('format code', 'developer');

      // Should escalate to medium level where anthropic is available
      expect(selection.provider).toBe('anthropic');
      expect(selection.model).toBe('medium-model');
    });

    it('should throw error when no providers available at any level', async () => {
      mockClassifier.setClassificationResult({
        level: 'simple',
        confidence: 0.9,
        reasoning: 'Simple task',
      });
      mockHealthChecker.setAvailableProviders([]);

      await expect(router.selectModel('format code', 'developer')).rejects.toThrow();
    });
  });

  // ==========================================================================
  // Requirement 8.2, 8.4: Agent Override Application
  // ==========================================================================
  describe('selectModel() - Agent Override Application', () => {
    it('should apply minimum complexity override for coordinator agent', async () => {
      mockClassifier.setClassificationResult({
        level: 'simple',
        confidence: 0.9,
        reasoning: 'Simple task',
      });

      // Set coordinator override with minimum complexity of medium
      mockRegistry.setAgentOverride({
        agentRole: 'coordinator',
        minimumComplexity: 'medium',
        reason: 'Coordinator requires reliable task analysis',
      });

      const selection = await router.selectModel('simple task', 'coordinator');

      // Should be elevated to medium complexity
      expect(selection.complexity).toBe('medium');
    });

    it('should apply minimum complexity override for architect agent', async () => {
      mockClassifier.setClassificationResult({
        level: 'simple',
        confidence: 0.9,
        reasoning: 'Simple task',
      });

      // Set architect override with minimum complexity of complex
      mockRegistry.setAgentOverride({
        agentRole: 'architect',
        minimumComplexity: 'complex',
        reason: 'Architecture decisions require deep reasoning',
      });

      const selection = await router.selectModel('simple task', 'architect');

      // Should be elevated to complex complexity
      expect(selection.complexity).toBe('complex');
    });

    it('should not elevate complexity when task is already at or above minimum', async () => {
      mockClassifier.setClassificationResult({
        level: 'complex',
        confidence: 0.95,
        reasoning: 'Complex task',
      });

      mockRegistry.setAgentOverride({
        agentRole: 'coordinator',
        minimumComplexity: 'medium',
        reason: 'Coordinator requires reliable task analysis',
      });

      const selection = await router.selectModel('complex task', 'coordinator');

      // Should remain at complex (already above medium)
      expect(selection.complexity).toBe('complex');
    });

    it('should use preferred provider from override when available', async () => {
      mockClassifier.setClassificationResult({
        level: 'medium',
        confidence: 0.9,
        reasoning: 'Medium task',
      });

      mockRegistry.setAgentOverride({
        agentRole: 'developer',
        preferredProvider: 'anthropic',
        reason: 'Developer prefers Anthropic',
      });

      const selection = await router.selectModel('implement feature', 'developer');

      expect(selection.provider).toBe('anthropic');
    });

    it('should use specific model from override when available', async () => {
      mockClassifier.setClassificationResult({
        level: 'medium',
        confidence: 0.9,
        reasoning: 'Medium task',
      });

      mockRegistry.setAgentOverride({
        agentRole: 'developer',
        preferredProvider: 'openai',
        specificModel: 'gpt-4o',
        reason: 'Developer requires specific model',
      });

      const selection = await router.selectModel('implement feature', 'developer');

      expect(selection.provider).toBe('openai');
      expect(selection.model).toBe('gpt-4o');
    });

    it('should fallback to normal selection when override provider unavailable', async () => {
      mockClassifier.setClassificationResult({
        level: 'medium',
        confidence: 0.9,
        reasoning: 'Medium task',
      });

      mockRegistry.setAgentOverride({
        agentRole: 'developer',
        preferredProvider: 'anthropic',
        reason: 'Developer prefers Anthropic',
      });

      // Make anthropic unavailable
      mockHealthChecker.setAvailableProviders(['groq', 'openai']);

      const selection = await router.selectModel('implement feature', 'developer');

      // Should fallback to groq (highest priority among available)
      expect(selection.provider).toBe('groq');
    });

    it('should not apply override for agents without configured override', async () => {
      mockClassifier.setClassificationResult({
        level: 'simple',
        confidence: 0.9,
        reasoning: 'Simple task',
      });

      // No override set for 'qa' agent
      mockRegistry.clearAgentOverrides();

      const selection = await router.selectModel('simple task', 'qa');

      // Should use normal selection (simple complexity)
      expect(selection.complexity).toBe('simple');
    });
  });

  // ==========================================================================
  // handleFailure() - Delegates to FallbackStrategy
  // ==========================================================================
  describe('handleFailure()', () => {
    it('should delegate to FallbackStrategy and return fallback model', async () => {
      const currentModel: ModelSelection = {
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        estimatedCostPer1KTokens: 0.00138,
        complexity: 'medium',
      };

      const fallbackModel: ModelSelection = {
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        estimatedCostPer1KTokens: 0.018,
        complexity: 'medium',
      };

      mockFallback.setNextAction({ type: 'fallback', model: fallbackModel });

      const result = await router.handleFailure(
        new Error('API error'),
        currentModel,
        []
      );

      expect(result).toEqual(fallbackModel);
    });

    it('should return null when FallbackStrategy returns fail action', async () => {
      const currentModel: ModelSelection = {
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        estimatedCostPer1KTokens: 0.00138,
        complexity: 'medium',
      };

      mockFallback.setNextAction({ type: 'fail', reason: 'All fallbacks exhausted' });

      const result = await router.handleFailure(
        new Error('API error'),
        currentModel,
        []
      );

      expect(result).toBeNull();
    });

    it('should return null when FallbackStrategy returns retry action', async () => {
      const currentModel: ModelSelection = {
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        estimatedCostPer1KTokens: 0.00138,
        complexity: 'medium',
      };

      mockFallback.setNextAction({ type: 'retry', delayMs: 1000 });

      const result = await router.handleFailure(
        new Error('Rate limit'),
        currentModel,
        []
      );

      expect(result).toBeNull();
    });

    it('should handle escalate action and return model from higher complexity', async () => {
      const currentModel: ModelSelection = {
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        estimatedCostPer1KTokens: 0.00138,
        complexity: 'simple',
      };

      mockFallback.setNextAction({ type: 'escalate', toLevel: 'medium' });

      const result = await router.handleFailure(
        new Error('API error'),
        currentModel,
        []
      );

      expect(result).not.toBeNull();
      expect(result!.complexity).toBe('medium');
    });

    it('should return null when escalate action has no available models', async () => {
      const currentModel: ModelSelection = {
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        estimatedCostPer1KTokens: 0.00138,
        complexity: 'simple',
      };

      mockFallback.setNextAction({ type: 'escalate', toLevel: 'medium' });
      mockHealthChecker.setAvailableProviders([]);

      const result = await router.handleFailure(
        new Error('API error'),
        currentModel,
        []
      );

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // recordExecution() - Delegates to MetricsTracker
  // ==========================================================================
  describe('recordExecution()', () => {
    it('should delegate to MetricsTracker.track()', async () => {
      const metrics: ExecutionMetrics = {
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        complexity: 'medium',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 500,
        success: true,
        fallbackUsed: false,
        agentRole: 'developer',
      };

      await router.recordExecution(metrics);

      const trackedMetrics = mockMetrics.getTrackedMetrics();
      expect(trackedMetrics).toHaveLength(1);
      expect(trackedMetrics[0]).toEqual(metrics);
    });

    it('should record multiple executions', async () => {
      const metrics1: ExecutionMetrics = {
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        complexity: 'simple',
        inputTokens: 50,
        outputTokens: 100,
        latencyMs: 200,
        success: true,
        fallbackUsed: false,
        agentRole: 'developer',
      };

      const metrics2: ExecutionMetrics = {
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        complexity: 'medium',
        inputTokens: 200,
        outputTokens: 400,
        latencyMs: 800,
        success: false,
        error: 'API error',
        fallbackUsed: true,
        agentRole: 'architect',
      };

      await router.recordExecution(metrics1);
      await router.recordExecution(metrics2);

      const trackedMetrics = mockMetrics.getTrackedMetrics();
      expect(trackedMetrics).toHaveLength(2);
      expect(trackedMetrics[0]).toEqual(metrics1);
      expect(trackedMetrics[1]).toEqual(metrics2);
    });
  });

  // ==========================================================================
  // isAvailable() - Provider Availability Check
  // ==========================================================================
  describe('isAvailable()', () => {
    it('should return true when at least one provider is available', () => {
      mockHealthChecker.setAvailableProviders(['groq']);

      expect(router.isAvailable()).toBe(true);
    });

    it('should return true when multiple providers are available', () => {
      mockHealthChecker.setAvailableProviders(['groq', 'anthropic', 'openai']);

      expect(router.isAvailable()).toBe(true);
    });

    it('should return false when no providers are available', () => {
      mockHealthChecker.setAvailableProviders([]);

      expect(router.isAvailable()).toBe(false);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('Edge Cases', () => {
    it('should throw error when no models configured for complexity level', async () => {
      mockClassifier.setClassificationResult({
        level: 'simple',
        confidence: 0.9,
        reasoning: 'Simple task',
      });
      mockRegistry.setModels('simple', []);
      mockRegistry.setModels('medium', []);
      mockRegistry.setModels('complex', []);

      await expect(router.selectModel('format code', 'developer')).rejects.toThrow();
    });

    it('should handle empty task string', async () => {
      mockClassifier.setClassificationResult({
        level: 'medium',
        confidence: 0.5,
        reasoning: 'Default classification',
      });

      const selection = await router.selectModel('', 'developer');

      expect(selection).toBeDefined();
      expect(selection.complexity).toBe('medium');
    });

    it('should handle all agent roles', async () => {
      const agentRoles: AgentRole[] = [
        'coordinator',
        'architect',
        'developer',
        'reviewer',
        'qa',
        'devops',
        'planner',
        'memory',
      ];

      mockClassifier.setClassificationResult({
        level: 'medium',
        confidence: 0.9,
        reasoning: 'Medium task',
      });

      for (const role of agentRoles) {
        const selection = await router.selectModel('test task', role);
        expect(selection).toBeDefined();
        expect(['groq', 'anthropic', 'openai']).toContain(selection.provider);
      }
    });
  });
});
