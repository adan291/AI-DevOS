/**
 * Unit Tests for Model Registry
 * 
 * Example-based tests that verify specific known inputs and expected outputs.
 * Tests default configuration loading, validation, agent overrides, and runtime updates.
 * 
 * Requirements: 2.1, 2.4, 2.5, 2.6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ModelRegistry,
  ModelRegistryConfigError,
  DEFAULT_MODEL_MAPPINGS,
  DEFAULT_AGENT_OVERRIDES,
  type ModelConfig,
  type AgentOverride,
} from './model-registry.js';
import type { ComplexityLevel } from './model-router.js';

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry();
  });

  // ==========================================================================
  // Requirement 2.1: Default Configuration Loading
  // ==========================================================================
  describe('Default Configuration Loading', () => {
    it('should load default model mappings on construction', () => {
      const simpleModels = registry.getModels('simple');
      const mediumModels = registry.getModels('medium');
      const complexModels = registry.getModels('complex');

      expect(simpleModels.length).toBeGreaterThan(0);
      expect(mediumModels.length).toBeGreaterThan(0);
      expect(complexModels.length).toBeGreaterThan(0);
    });

    it('should have Groq as highest priority for simple tasks', () => {
      const simpleModels = registry.getModels('simple');
      expect(simpleModels[0].provider).toBe('groq');
      expect(simpleModels[0].model).toBe('llama-3.3-70b-versatile');
    });

    it('should have Groq as highest priority for medium tasks', () => {
      const mediumModels = registry.getModels('medium');
      expect(mediumModels[0].provider).toBe('groq');
      expect(mediumModels[0].model).toBe('llama-3.3-70b-versatile');
    });

    it('should have Anthropic as highest priority for complex tasks', () => {
      const complexModels = registry.getModels('complex');
      expect(complexModels[0].provider).toBe('anthropic');
      expect(complexModels[0].model).toBe('claude-opus-4-20250514');
    });

    it('should return models sorted by priority (lower number = higher priority)', () => {
      const simpleModels = registry.getModels('simple');
      
      for (let i = 1; i < simpleModels.length; i++) {
        expect(simpleModels[i].priority).toBeGreaterThanOrEqual(simpleModels[i - 1].priority);
      }
    });

    it('should load default agent overrides on construction', () => {
      const coordinatorOverride = registry.getAgentOverride('coordinator');
      const architectOverride = registry.getAgentOverride('architect');

      expect(coordinatorOverride).not.toBeNull();
      expect(architectOverride).not.toBeNull();
    });

    it('should have coordinator override with medium minimum complexity', () => {
      const override = registry.getAgentOverride('coordinator');
      expect(override?.minimumComplexity).toBe('medium');
    });

    it('should have architect override with complex minimum complexity', () => {
      const override = registry.getAgentOverride('architect');
      expect(override?.minimumComplexity).toBe('complex');
    });

    it('should return null for agents without overrides', () => {
      const override = registry.getAgentOverride('developer');
      expect(override).toBeNull();
    });
  });

  // ==========================================================================
  // Requirement 2.5, 2.6: Configuration Validation
  // ==========================================================================
  describe('Configuration Validation', () => {
    it('should reject empty model array for a complexity level', () => {
      expect(() => {
        registry.updateConfig('simple', []);
      }).toThrow(ModelRegistryConfigError);
    });

    it('should reject empty model array with descriptive error message', () => {
      expect(() => {
        registry.updateConfig('simple', []);
      }).toThrow(/at least one model/i);
    });

    it('should reject invalid complexity level', () => {
      expect(() => {
        registry.updateConfig('invalid' as ComplexityLevel, [
          createValidModelConfig(),
        ]);
      }).toThrow(ModelRegistryConfigError);
    });

    it('should reject model with invalid provider', () => {
      const invalidModel: ModelConfig = {
        ...createValidModelConfig(),
        provider: 'invalid' as any,
      };

      expect(() => {
        registry.updateConfig('simple', [invalidModel]);
      }).toThrow(ModelRegistryConfigError);
    });

    it('should reject model with empty model name', () => {
      const invalidModel: ModelConfig = {
        ...createValidModelConfig(),
        model: '',
      };

      expect(() => {
        registry.updateConfig('simple', [invalidModel]);
      }).toThrow(ModelRegistryConfigError);
    });

    it('should reject model with negative input token cost', () => {
      const invalidModel: ModelConfig = {
        ...createValidModelConfig(),
        costPer1KInputTokens: -0.001,
      };

      expect(() => {
        registry.updateConfig('simple', [invalidModel]);
      }).toThrow(ModelRegistryConfigError);
    });

    it('should reject model with negative output token cost', () => {
      const invalidModel: ModelConfig = {
        ...createValidModelConfig(),
        costPer1KOutputTokens: -0.001,
      };

      expect(() => {
        registry.updateConfig('simple', [invalidModel]);
      }).toThrow(ModelRegistryConfigError);
    });

    it('should reject model with zero or negative maxTokens', () => {
      const invalidModel: ModelConfig = {
        ...createValidModelConfig(),
        maxTokens: 0,
      };

      expect(() => {
        registry.updateConfig('simple', [invalidModel]);
      }).toThrow(ModelRegistryConfigError);
    });

    it('should accept model with zero cost (free models)', () => {
      const freeModel: ModelConfig = {
        ...createValidModelConfig(),
        costPer1KInputTokens: 0,
        costPer1KOutputTokens: 0,
      };

      expect(() => {
        registry.updateConfig('simple', [freeModel]);
      }).not.toThrow();
    });

    it('should validate configuration on construction', () => {
      const invalidMappings = {
        simple: [],
        medium: [createValidModelConfig()],
        complex: [createValidModelConfig()],
      };

      expect(() => {
        new ModelRegistry(invalidMappings);
      }).toThrow(ModelRegistryConfigError);
    });

    it('should validate all levels have at least one model', () => {
      expect(() => {
        registry.validate();
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // Requirement 2.4: Agent Override Retrieval
  // ==========================================================================
  describe('Agent Override Retrieval', () => {
    it('should return override for coordinator agent', () => {
      const override = registry.getAgentOverride('coordinator');
      
      expect(override).not.toBeNull();
      expect(override?.agentRole).toBe('coordinator');
    });

    it('should return override for architect agent', () => {
      const override = registry.getAgentOverride('architect');
      
      expect(override).not.toBeNull();
      expect(override?.agentRole).toBe('architect');
    });

    it('should return null for planner agent (no default override)', () => {
      const override = registry.getAgentOverride('planner');
      expect(override).toBeNull();
    });

    it('should return null for developer agent (no default override)', () => {
      const override = registry.getAgentOverride('developer');
      expect(override).toBeNull();
    });

    it('should return null for reviewer agent (no default override)', () => {
      const override = registry.getAgentOverride('reviewer');
      expect(override).toBeNull();
    });

    it('should return null for qa agent (no default override)', () => {
      const override = registry.getAgentOverride('qa');
      expect(override).toBeNull();
    });

    it('should return null for devops agent (no default override)', () => {
      const override = registry.getAgentOverride('devops');
      expect(override).toBeNull();
    });

    it('should return null for memory agent (no default override)', () => {
      const override = registry.getAgentOverride('memory');
      expect(override).toBeNull();
    });

    it('should include reason in override', () => {
      const override = registry.getAgentOverride('coordinator');
      
      expect(override?.reason).toBeDefined();
      expect(typeof override?.reason).toBe('string');
      expect(override?.reason.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Requirement 2.4: Runtime Configuration Updates
  // ==========================================================================
  describe('Runtime Configuration Updates', () => {
    it('should update model configuration for a complexity level', () => {
      const newModels: ModelConfig[] = [
        {
          provider: 'openai',
          model: 'gpt-4-turbo',
          costPer1KInputTokens: 0.01,
          costPer1KOutputTokens: 0.03,
          maxTokens: 128000,
          priority: 1,
        },
      ];

      registry.updateConfig('simple', newModels);
      const models = registry.getModels('simple');

      expect(models.length).toBe(1);
      expect(models[0].model).toBe('gpt-4-turbo');
    });

    it('should not affect other complexity levels when updating one', () => {
      const originalMediumModels = registry.getModels('medium');
      
      registry.updateConfig('simple', [createValidModelConfig()]);
      
      const newMediumModels = registry.getModels('medium');
      expect(newMediumModels).toEqual(originalMediumModels);
    });

    it('should allow adding multiple models to a level', () => {
      const newModels: ModelConfig[] = [
        { ...createValidModelConfig(), model: 'model-1', priority: 1 },
        { ...createValidModelConfig(), model: 'model-2', priority: 2 },
        { ...createValidModelConfig(), model: 'model-3', priority: 3 },
      ];

      registry.updateConfig('simple', newModels);
      const models = registry.getModels('simple');

      expect(models.length).toBe(3);
    });

    it('should replace existing models when updating', () => {
      const originalCount = registry.getModels('simple').length;
      
      registry.updateConfig('simple', [createValidModelConfig()]);
      
      const newCount = registry.getModels('simple').length;
      expect(newCount).toBe(1);
      expect(newCount).not.toBe(originalCount);
    });

    it('should set new agent override', () => {
      const newOverride: AgentOverride = {
        agentRole: 'developer',
        minimumComplexity: 'medium',
        reason: 'Developer needs reliable code generation',
      };

      registry.setAgentOverride(newOverride);
      const override = registry.getAgentOverride('developer');

      expect(override).not.toBeNull();
      expect(override?.minimumComplexity).toBe('medium');
    });

    it('should update existing agent override', () => {
      const updatedOverride: AgentOverride = {
        agentRole: 'coordinator',
        minimumComplexity: 'complex',
        preferredProvider: 'anthropic',
        reason: 'Updated coordinator requirements',
      };

      registry.setAgentOverride(updatedOverride);
      const override = registry.getAgentOverride('coordinator');

      expect(override?.minimumComplexity).toBe('complex');
      expect(override?.preferredProvider).toBe('anthropic');
    });

    it('should allow override with specific model', () => {
      const override: AgentOverride = {
        agentRole: 'qa',
        specificModel: 'claude-opus-4-20250514',
        preferredProvider: 'anthropic',
        reason: 'QA needs specific model for consistency',
      };

      registry.setAgentOverride(override);
      const result = registry.getAgentOverride('qa');

      expect(result?.specificModel).toBe('claude-opus-4-20250514');
    });

    it('should reject override with invalid minimum complexity', () => {
      const invalidOverride: AgentOverride = {
        agentRole: 'developer',
        minimumComplexity: 'invalid' as ComplexityLevel,
        reason: 'Test',
      };

      expect(() => {
        registry.setAgentOverride(invalidOverride);
      }).toThrow(ModelRegistryConfigError);
    });

    it('should reject override with invalid preferred provider', () => {
      const invalidOverride: AgentOverride = {
        agentRole: 'developer',
        preferredProvider: 'invalid' as any,
        reason: 'Test',
      };

      expect(() => {
        registry.setAgentOverride(invalidOverride);
      }).toThrow(ModelRegistryConfigError);
    });

    it('should reject override without reason', () => {
      const invalidOverride: AgentOverride = {
        agentRole: 'developer',
        reason: '',
      };

      expect(() => {
        registry.setAgentOverride(invalidOverride);
      }).toThrow(ModelRegistryConfigError);
    });

    it('should reject override without agent role', () => {
      const invalidOverride = {
        reason: 'Test reason',
      } as AgentOverride;

      expect(() => {
        registry.setAgentOverride(invalidOverride);
      }).toThrow(ModelRegistryConfigError);
    });
  });

  // ==========================================================================
  // getModels Method Behavior
  // ==========================================================================
  describe('getModels Method', () => {
    it('should return a copy of models, not the original array', () => {
      const models1 = registry.getModels('simple');
      const models2 = registry.getModels('simple');

      expect(models1).not.toBe(models2);
      expect(models1).toEqual(models2);
    });

    it('should return empty array for invalid complexity level', () => {
      const models = registry.getModels('invalid' as ComplexityLevel);
      expect(models).toEqual([]);
    });

    it('should sort models by priority ascending', () => {
      const newModels: ModelConfig[] = [
        { ...createValidModelConfig(), model: 'low-priority', priority: 10 },
        { ...createValidModelConfig(), model: 'high-priority', priority: 1 },
        { ...createValidModelConfig(), model: 'medium-priority', priority: 5 },
      ];

      registry.updateConfig('simple', newModels);
      const models = registry.getModels('simple');

      expect(models[0].model).toBe('high-priority');
      expect(models[1].model).toBe('medium-priority');
      expect(models[2].model).toBe('low-priority');
    });
  });

  // ==========================================================================
  // Constructor with Custom Configuration
  // ==========================================================================
  describe('Constructor with Custom Configuration', () => {
    it('should accept custom model mappings', () => {
      const customMappings = {
        simple: [createValidModelConfig('custom-simple')],
        medium: [createValidModelConfig('custom-medium')],
        complex: [createValidModelConfig('custom-complex')],
      };

      const customRegistry = new ModelRegistry(customMappings);
      
      expect(customRegistry.getModels('simple')[0].model).toBe('custom-simple');
      expect(customRegistry.getModels('medium')[0].model).toBe('custom-medium');
      expect(customRegistry.getModels('complex')[0].model).toBe('custom-complex');
    });

    it('should accept custom agent overrides', () => {
      const customOverrides: AgentOverride[] = [
        { agentRole: 'developer', minimumComplexity: 'medium', reason: 'Custom override' },
      ];

      const customRegistry = new ModelRegistry(DEFAULT_MODEL_MAPPINGS, customOverrides);
      
      expect(customRegistry.getAgentOverride('developer')).not.toBeNull();
      expect(customRegistry.getAgentOverride('coordinator')).toBeNull();
    });

    it('should accept empty agent overrides array', () => {
      const customRegistry = new ModelRegistry(DEFAULT_MODEL_MAPPINGS, []);
      
      expect(customRegistry.getAgentOverride('coordinator')).toBeNull();
      expect(customRegistry.getAgentOverride('architect')).toBeNull();
    });

    it('should clone initial mapping arrays to prevent array mutation', () => {
      const customMappings = {
        simple: [createValidModelConfig('original')],
        medium: [createValidModelConfig()],
        complex: [createValidModelConfig()],
      };

      const customRegistry = new ModelRegistry(customMappings);
      
      // Mutate the original array by adding a new element
      customMappings.simple.push(createValidModelConfig('added'));
      
      // Registry should still have original array length
      expect(customRegistry.getModels('simple').length).toBe(1);
    });
  });

  // ==========================================================================
  // Exported Constants
  // ==========================================================================
  describe('Exported Constants', () => {
    it('should export DEFAULT_MODEL_MAPPINGS with all complexity levels', () => {
      expect(DEFAULT_MODEL_MAPPINGS).toHaveProperty('simple');
      expect(DEFAULT_MODEL_MAPPINGS).toHaveProperty('medium');
      expect(DEFAULT_MODEL_MAPPINGS).toHaveProperty('complex');
    });

    it('should have at least one model per level in DEFAULT_MODEL_MAPPINGS', () => {
      expect(DEFAULT_MODEL_MAPPINGS.simple.length).toBeGreaterThan(0);
      expect(DEFAULT_MODEL_MAPPINGS.medium.length).toBeGreaterThan(0);
      expect(DEFAULT_MODEL_MAPPINGS.complex.length).toBeGreaterThan(0);
    });

    it('should export DEFAULT_AGENT_OVERRIDES array', () => {
      expect(Array.isArray(DEFAULT_AGENT_OVERRIDES)).toBe(true);
    });

    it('should have coordinator and architect in DEFAULT_AGENT_OVERRIDES', () => {
      const roles = DEFAULT_AGENT_OVERRIDES.map(o => o.agentRole);
      expect(roles).toContain('coordinator');
      expect(roles).toContain('architect');
    });
  });

  // ==========================================================================
  // ModelRegistryConfigError
  // ==========================================================================
  describe('ModelRegistryConfigError', () => {
    it('should be an instance of Error', () => {
      const error = new ModelRegistryConfigError('test');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct name property', () => {
      const error = new ModelRegistryConfigError('test');
      expect(error.name).toBe('ModelRegistryConfigError');
    });

    it('should preserve error message', () => {
      const error = new ModelRegistryConfigError('Custom error message');
      expect(error.message).toBe('Custom error message');
    });
  });
});

// ==========================================================================
// Helper Functions
// ==========================================================================

/**
 * Creates a valid ModelConfig for testing purposes.
 */
function createValidModelConfig(modelName = 'test-model'): ModelConfig {
  return {
    provider: 'groq',
    model: modelName,
    costPer1KInputTokens: 0.001,
    costPer1KOutputTokens: 0.002,
    maxTokens: 8192,
    priority: 1,
  };
}
