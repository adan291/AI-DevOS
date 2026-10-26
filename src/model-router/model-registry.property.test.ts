/**
 * Property-Based Tests for Model Registry
 * Feature: model-router, Property 5: Registry Configuration Invariant
 *
 * **Validates: Requirements 2.5, 2.6**
 *
 * Property 5: For any valid configuration update to the ModelRegistry, after the
 * update completes, every complexity level ('simple', 'medium', 'complex') SHALL
 * have at least one model configured. Invalid configurations (empty model arrays,
 * missing levels) SHALL be rejected with a descriptive error.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  ModelRegistry,
  ModelRegistryConfigError,
  DEFAULT_MODEL_MAPPINGS,
  type ModelConfig,
} from './model-registry.js';
import type { ComplexityLevel, Provider } from './model-router.js';

// ============================================================================
// Fast-Check Arbitraries (Generators) for Model Configurations
// ============================================================================

/**
 * Valid complexity levels as defined in the design document
 */
const VALID_COMPLEXITY_LEVELS: ComplexityLevel[] = ['simple', 'medium', 'complex'];

/**
 * Valid providers as defined in the design document
 */
const VALID_PROVIDERS: Provider[] = ['groq', 'anthropic', 'openai'];

/**
 * Generates a valid provider
 */
const arbitraryProvider = fc.constantFrom<Provider>(...VALID_PROVIDERS);

/**
 * Generates a valid complexity level
 */
const arbitraryComplexityLevel = fc.constantFrom<ComplexityLevel>(...VALID_COMPLEXITY_LEVELS);

/**
 * Generates a valid non-empty model name
 */
const arbitraryModelName = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_.'.split('')),
  { minLength: 1, maxLength: 50 }
);

/**
 * Generates a valid cost value (non-negative number)
 */
const arbitraryCost = fc.double({ min: 0, max: 1, noNaN: true });

/**
 * Generates a valid maxTokens value (positive integer)
 */
const arbitraryMaxTokens = fc.integer({ min: 1, max: 100000 });

/**
 * Generates a valid priority value (any integer)
 */
const arbitraryPriority = fc.integer({ min: 1, max: 100 });

/**
 * Generates a valid ModelConfig
 */
const arbitraryValidModelConfig: fc.Arbitrary<ModelConfig> = fc.record({
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
const arbitraryValidModelConfigArray = fc.array(arbitraryValidModelConfig, { minLength: 1, maxLength: 5 });

/**
 * Generates a complete valid configuration for all complexity levels
 */
const arbitraryValidFullConfig = fc.record({
  simple: arbitraryValidModelConfigArray,
  medium: arbitraryValidModelConfigArray,
  complex: arbitraryValidModelConfigArray,
});

// ============================================================================
// Invalid Configuration Generators
// ============================================================================

/**
 * Generates an empty array (invalid for model configuration)
 */
const arbitraryEmptyModelArray = fc.constant<ModelConfig[]>([]);

/**
 * Generates a ModelConfig with invalid provider
 */
const arbitraryInvalidProviderConfig = fc.record({
  provider: fc.string({ minLength: 1, maxLength: 20 }).filter(
    s => !VALID_PROVIDERS.includes(s as Provider)
  ) as fc.Arbitrary<Provider>,
  model: arbitraryModelName,
  costPer1KInputTokens: arbitraryCost,
  costPer1KOutputTokens: arbitraryCost,
  maxTokens: arbitraryMaxTokens,
  priority: arbitraryPriority,
});

/**
 * Generates a ModelConfig with empty model name
 */
const arbitraryEmptyModelNameConfig: fc.Arbitrary<ModelConfig> = fc.record({
  provider: arbitraryProvider,
  model: fc.constantFrom('', '   ', '\t', '\n'),
  costPer1KInputTokens: arbitraryCost,
  costPer1KOutputTokens: arbitraryCost,
  maxTokens: arbitraryMaxTokens,
  priority: arbitraryPriority,
});

/**
 * Generates a ModelConfig with negative cost
 */
const arbitraryNegativeCostConfig: fc.Arbitrary<ModelConfig> = fc.record({
  provider: arbitraryProvider,
  model: arbitraryModelName,
  costPer1KInputTokens: fc.double({ min: -1000, max: -0.001, noNaN: true }),
  costPer1KOutputTokens: arbitraryCost,
  maxTokens: arbitraryMaxTokens,
  priority: arbitraryPriority,
});

/**
 * Generates a ModelConfig with invalid maxTokens (zero or negative)
 */
const arbitraryInvalidMaxTokensConfig: fc.Arbitrary<ModelConfig> = fc.record({
  provider: arbitraryProvider,
  model: arbitraryModelName,
  costPer1KInputTokens: arbitraryCost,
  costPer1KOutputTokens: arbitraryCost,
  maxTokens: fc.integer({ min: -1000, max: 0 }),
  priority: arbitraryPriority,
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Property 5: Registry Configuration Invariant', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry();
  });

  /**
   * **Validates: Requirements 2.5, 2.6**
   *
   * Property: After any valid update, every complexity level SHALL have at least one model.
   */
  describe('Valid Configuration Updates Maintain Invariant', () => {
    it('should maintain at least one model per level after any valid update', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryValidModelConfigArray,
          async (level, models) => {
            // Act: Update configuration for a specific level
            registry.updateConfig(level, models);

            // Assert: All complexity levels still have at least one model
            for (const complexityLevel of VALID_COMPLEXITY_LEVELS) {
              const levelModels = registry.getModels(complexityLevel);
              expect(levelModels.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain invariant after multiple sequential updates', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.tuple(arbitraryComplexityLevel, arbitraryValidModelConfigArray),
            { minLength: 1, maxLength: 10 }
          ),
          async (updates) => {
            // Act: Apply multiple updates sequentially
            for (const [level, models] of updates) {
              registry.updateConfig(level, models);
            }

            // Assert: All complexity levels still have at least one model
            for (const complexityLevel of VALID_COMPLEXITY_LEVELS) {
              const levelModels = registry.getModels(complexityLevel);
              expect(levelModels.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve models for unmodified levels after update', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryValidModelConfigArray,
          async (level, models) => {
            // Arrange: Get models for other levels before update
            const otherLevels = VALID_COMPLEXITY_LEVELS.filter(l => l !== level);
            const modelsBefore: Record<string, ModelConfig[]> = {};
            for (const otherLevel of otherLevels) {
              modelsBefore[otherLevel] = registry.getModels(otherLevel);
            }

            // Act: Update configuration for a specific level
            registry.updateConfig(level, models);

            // Assert: Other levels are unchanged
            for (const otherLevel of otherLevels) {
              const modelsAfter = registry.getModels(otherLevel);
              expect(modelsAfter.length).toBe(modelsBefore[otherLevel].length);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly store and retrieve updated models', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryValidModelConfigArray,
          async (level, models) => {
            // Act: Update configuration
            registry.updateConfig(level, models);

            // Assert: Retrieved models match what was set
            const retrievedModels = registry.getModels(level);
            expect(retrievedModels.length).toBe(models.length);

            // Verify all models are present (sorted by priority)
            const sortedInput = [...models].sort((a, b) => a.priority - b.priority);
            for (let i = 0; i < sortedInput.length; i++) {
              expect(retrievedModels[i].provider).toBe(sortedInput[i].provider);
              expect(retrievedModels[i].model).toBe(sortedInput[i].model);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 2.5, 2.6**
   *
   * Property: Invalid configurations SHALL be rejected with descriptive error.
   */
  describe('Invalid Configurations Are Rejected', () => {
    it('should reject empty model arrays with descriptive error', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryComplexityLevel, async (level) => {
          // Act & Assert: Empty array should be rejected
          expect(() => {
            registry.updateConfig(level, []);
          }).toThrow(ModelRegistryConfigError);

          // Verify error message is descriptive
          try {
            registry.updateConfig(level, []);
          } catch (error) {
            expect(error).toBeInstanceOf(ModelRegistryConfigError);
            expect((error as Error).message).toContain(level);
            expect((error as Error).message.toLowerCase()).toMatch(/at least one model|must have/i);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should reject configurations with invalid provider', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          fc.array(arbitraryInvalidProviderConfig, { minLength: 1, maxLength: 3 }),
          async (level, models) => {
            // Act & Assert: Invalid provider should be rejected
            expect(() => {
              registry.updateConfig(level, models);
            }).toThrow(ModelRegistryConfigError);

            // Verify error message mentions provider
            try {
              registry.updateConfig(level, models);
            } catch (error) {
              expect(error).toBeInstanceOf(ModelRegistryConfigError);
              expect((error as Error).message.toLowerCase()).toContain('provider');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject configurations with empty model name', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          fc.array(arbitraryEmptyModelNameConfig, { minLength: 1, maxLength: 3 }),
          async (level, models) => {
            // Act & Assert: Empty model name should be rejected
            expect(() => {
              registry.updateConfig(level, models);
            }).toThrow(ModelRegistryConfigError);

            // Verify error message mentions model name
            try {
              registry.updateConfig(level, models);
            } catch (error) {
              expect(error).toBeInstanceOf(ModelRegistryConfigError);
              expect((error as Error).message.toLowerCase()).toContain('model');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject configurations with negative cost', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          fc.array(arbitraryNegativeCostConfig, { minLength: 1, maxLength: 3 }),
          async (level, models) => {
            // Act & Assert: Negative cost should be rejected
            expect(() => {
              registry.updateConfig(level, models);
            }).toThrow(ModelRegistryConfigError);

            // Verify error message mentions cost
            try {
              registry.updateConfig(level, models);
            } catch (error) {
              expect(error).toBeInstanceOf(ModelRegistryConfigError);
              expect((error as Error).message.toLowerCase()).toContain('cost');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject configurations with invalid maxTokens', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          fc.array(arbitraryInvalidMaxTokensConfig, { minLength: 1, maxLength: 3 }),
          async (level, models) => {
            // Act & Assert: Invalid maxTokens should be rejected
            expect(() => {
              registry.updateConfig(level, models);
            }).toThrow(ModelRegistryConfigError);

            // Verify error message mentions maxTokens
            try {
              registry.updateConfig(level, models);
            } catch (error) {
              expect(error).toBeInstanceOf(ModelRegistryConfigError);
              expect((error as Error).message.toLowerCase()).toContain('maxtokens');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not modify registry state when update is rejected', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryComplexityLevel, async (level) => {
          // Arrange: Get models before attempted invalid update
          const modelsBefore = registry.getModels(level);

          // Act: Attempt invalid update
          try {
            registry.updateConfig(level, []);
          } catch {
            // Expected to throw
          }

          // Assert: Models are unchanged
          const modelsAfter = registry.getModels(level);
          expect(modelsAfter.length).toBe(modelsBefore.length);
          for (let i = 0; i < modelsBefore.length; i++) {
            expect(modelsAfter[i].model).toBe(modelsBefore[i].model);
            expect(modelsAfter[i].provider).toBe(modelsBefore[i].provider);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 2.5, 2.6**
   *
   * Property: Registry validation should detect invalid states.
   */
  describe('Registry Validation', () => {
    it('should pass validation after any valid update', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryValidModelConfigArray,
          async (level, models) => {
            // Act: Update configuration
            registry.updateConfig(level, models);

            // Assert: Validation passes
            expect(() => registry.validate()).not.toThrow();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should pass validation with default configuration', () => {
      // Assert: Default configuration is valid
      expect(() => registry.validate()).not.toThrow();
    });

    it('should pass validation after initializing with valid custom config', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryValidFullConfig, async (config) => {
          // Act: Create registry with custom config
          const customRegistry = new ModelRegistry(config);

          // Assert: Validation passes
          expect(() => customRegistry.validate()).not.toThrow();
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 2.5, 2.6**
   *
   * Property: Models should be returned sorted by priority.
   */
  describe('Model Priority Ordering', () => {
    it('should return models sorted by priority after any valid update', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbitraryComplexityLevel,
          arbitraryValidModelConfigArray,
          async (level, models) => {
            // Act: Update configuration
            registry.updateConfig(level, models);

            // Assert: Retrieved models are sorted by priority
            const retrievedModels = registry.getModels(level);
            for (let i = 1; i < retrievedModels.length; i++) {
              expect(retrievedModels[i].priority).toBeGreaterThanOrEqual(
                retrievedModels[i - 1].priority
              );
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 2.5, 2.6**
   *
   * Property: Default configuration should satisfy invariant.
   */
  describe('Default Configuration Invariant', () => {
    it('should have at least one model for each complexity level by default', () => {
      for (const level of VALID_COMPLEXITY_LEVELS) {
        const models = registry.getModels(level);
        expect(models.length).toBeGreaterThan(0);
      }
    });

    it('should have valid models in default configuration', () => {
      for (const level of VALID_COMPLEXITY_LEVELS) {
        const models = registry.getModels(level);
        for (const model of models) {
          expect(VALID_PROVIDERS).toContain(model.provider);
          expect(model.model).toBeTruthy();
          expect(model.costPer1KInputTokens).toBeGreaterThanOrEqual(0);
          expect(model.costPer1KOutputTokens).toBeGreaterThanOrEqual(0);
          expect(model.maxTokens).toBeGreaterThan(0);
        }
      }
    });
  });

  /**
   * **Validates: Requirements 2.5, 2.6**
   *
   * Property: Invalid complexity levels should be rejected.
   */
  describe('Invalid Complexity Level Handling', () => {
    it('should reject updates with invalid complexity level', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }).filter(
            s => !VALID_COMPLEXITY_LEVELS.includes(s as ComplexityLevel)
          ),
          arbitraryValidModelConfigArray,
          async (invalidLevel, models) => {
            // Act & Assert: Invalid level should be rejected
            expect(() => {
              registry.updateConfig(invalidLevel as ComplexityLevel, models);
            }).toThrow(ModelRegistryConfigError);

            // Verify error message is descriptive
            try {
              registry.updateConfig(invalidLevel as ComplexityLevel, models);
            } catch (error) {
              expect(error).toBeInstanceOf(ModelRegistryConfigError);
              expect((error as Error).message.toLowerCase()).toContain('level');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
