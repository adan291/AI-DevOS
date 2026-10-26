/**
 * Property-Based Tests for Task Classifier
 * Feature: model-router, Property 1: Classification Output Validity
 *
 * **Validates: Requirements 1.1, 1.6**
 *
 * Property 1: For any task string submitted to the TaskClassifier, the classification
 * result SHALL contain a valid complexity level (one of 'simple', 'medium', 'complex')
 * AND a confidence score between 0.0 and 1.0 inclusive.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { TaskClassifier } from './task-classifier.js';
import type { ComplexityLevel } from './model-router.js';

// ============================================================================
// Fast-Check Arbitraries (Generators) for Task Strings
// ============================================================================

/**
 * Valid complexity levels as defined in the design document
 */
const VALID_COMPLEXITY_LEVELS: ComplexityLevel[] = ['simple', 'medium', 'complex'];

/**
 * Generates arbitrary strings including empty, unicode, and very long strings
 */
const arbitraryTaskString = fc.oneof(
  // Empty string
  fc.constant(''),
  // Whitespace-only strings
  fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 10 }),
  // Normal ASCII strings
  fc.string({ minLength: 0, maxLength: 500 }),
  // Unicode strings with various characters
  fc.unicodeString({ minLength: 0, maxLength: 200 }),
  // Very long strings (to test token estimation)
  fc.string({ minLength: 1000, maxLength: 5000 }),
  // Strings with special characters
  fc.stringOf(fc.constantFrom('!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '_', '=', '+'), { minLength: 1, maxLength: 50 }),
  // Mixed content strings
  fc.tuple(
    fc.string({ minLength: 0, maxLength: 100 }),
    fc.unicodeString({ minLength: 0, maxLength: 100 })
  ).map(([a, b]) => a + b)
);

/**
 * Generates strings with embedded keywords from classification criteria
 */
const arbitraryTaskWithKeywords = fc.oneof(
  // Simple task keywords
  fc.constantFrom(
    'format the code',
    'summarize this document',
    'list all files',
    'rename variable',
    'fix typo in comment',
    'simple change',
    'basic update',
    'quick fix',
    'minor adjustment'
  ),
  // Medium task keywords
  fc.constantFrom(
    'refactor the module',
    'implement api integration',
    'update multiple files',
    'write tests for feature',
    'implement new feature',
    'modify existing functionality',
    'enhance the component'
  ),
  // Complex task keywords
  fc.constantFrom(
    'design system architecture',
    'security analysis required',
    'performance optimization',
    'cross-module refactoring',
    'database migration',
    'infrastructure changes',
    'scale the system'
  )
);

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Property 1: Classification Output Validity', () => {
  let classifier: TaskClassifier;

  beforeEach(() => {
    classifier = new TaskClassifier();
  });

  /**
   * **Validates: Requirements 1.1, 1.6**
   *
   * Property: For any arbitrary string input, the classifier must return
   * a valid complexity level ('simple' | 'medium' | 'complex').
   */
  describe('Complexity Level Validity', () => {
    it('should always return a valid complexity level for any arbitrary string', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryTaskString, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Result has a valid complexity level
          expect(VALID_COMPLEXITY_LEVELS).toContain(result.level);
        }),
        { numRuns: 100 }
      );
    });

    it('should always return a valid complexity level for strings with keywords', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryTaskWithKeywords, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Result has a valid complexity level
          expect(VALID_COMPLEXITY_LEVELS).toContain(result.level);
        }),
        { numRuns: 100 }
      );
    });

    it('should always return a valid complexity level for unicode strings', async () => {
      await fc.assert(
        fc.asyncProperty(fc.unicodeString({ minLength: 0, maxLength: 500 }), async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Result has a valid complexity level
          expect(VALID_COMPLEXITY_LEVELS).toContain(result.level);
        }),
        { numRuns: 100 }
      );
    });

    it('should always return a valid complexity level for very long strings', async () => {
      await fc.assert(
        fc.asyncProperty(fc.string({ minLength: 2000, maxLength: 10000 }), async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Result has a valid complexity level
          expect(VALID_COMPLEXITY_LEVELS).toContain(result.level);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.1, 1.6**
   *
   * Property: For any arbitrary string input, the classifier must return
   * a confidence score between 0.0 and 1.0 inclusive.
   */
  describe('Confidence Score Validity', () => {
    it('should always return confidence between 0.0 and 1.0 for any arbitrary string', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryTaskString, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Confidence is within valid range [0.0, 1.0]
          expect(result.confidence).toBeGreaterThanOrEqual(0.0);
          expect(result.confidence).toBeLessThanOrEqual(1.0);
        }),
        { numRuns: 100 }
      );
    });

    it('should always return confidence between 0.0 and 1.0 for strings with keywords', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryTaskWithKeywords, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Confidence is within valid range [0.0, 1.0]
          expect(result.confidence).toBeGreaterThanOrEqual(0.0);
          expect(result.confidence).toBeLessThanOrEqual(1.0);
        }),
        { numRuns: 100 }
      );
    });

    it('should always return confidence between 0.0 and 1.0 for unicode strings', async () => {
      await fc.assert(
        fc.asyncProperty(fc.unicodeString({ minLength: 0, maxLength: 500 }), async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Confidence is within valid range [0.0, 1.0]
          expect(result.confidence).toBeGreaterThanOrEqual(0.0);
          expect(result.confidence).toBeLessThanOrEqual(1.0);
        }),
        { numRuns: 100 }
      );
    });

    it('should always return confidence between 0.0 and 1.0 for very long strings', async () => {
      await fc.assert(
        fc.asyncProperty(fc.string({ minLength: 2000, maxLength: 10000 }), async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Confidence is within valid range [0.0, 1.0]
          expect(result.confidence).toBeGreaterThanOrEqual(0.0);
          expect(result.confidence).toBeLessThanOrEqual(1.0);
        }),
        { numRuns: 100 }
      );
    });

    it('should return confidence as a finite number', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryTaskString, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Confidence is a finite number
          expect(typeof result.confidence).toBe('number');
          expect(Number.isFinite(result.confidence)).toBe(true);
          expect(Number.isNaN(result.confidence)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.1, 1.6**
   *
   * Property: For any arbitrary string input, the classifier must return
   * both a valid complexity level AND a valid confidence score.
   */
  describe('Combined Output Validity', () => {
    it('should always return valid complexity level AND confidence for any input', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryTaskString, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Both properties are valid
          expect(VALID_COMPLEXITY_LEVELS).toContain(result.level);
          expect(result.confidence).toBeGreaterThanOrEqual(0.0);
          expect(result.confidence).toBeLessThanOrEqual(1.0);
          expect(typeof result.confidence).toBe('number');
          expect(Number.isFinite(result.confidence)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should return a complete ClassificationResult object', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryTaskString, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Result has required properties
          expect(result).toHaveProperty('level');
          expect(result).toHaveProperty('confidence');
          
          // Assert: Level is a string
          expect(typeof result.level).toBe('string');
          
          // Assert: Confidence is a number
          expect(typeof result.confidence).toBe('number');
        }),
        { numRuns: 100 }
      );
    });

    it('should handle mixed content strings correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(
            fc.string({ minLength: 0, maxLength: 200 }),
            fc.unicodeString({ minLength: 0, maxLength: 200 }),
            fc.string({ minLength: 0, maxLength: 200 })
          ),
          async ([prefix, unicode, suffix]) => {
            const task = prefix + unicode + suffix;

            // Act
            const result = await classifier.classify(task);

            // Assert: Both properties are valid
            expect(VALID_COMPLEXITY_LEVELS).toContain(result.level);
            expect(result.confidence).toBeGreaterThanOrEqual(0.0);
            expect(result.confidence).toBeLessThanOrEqual(1.0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.1, 1.6**
   *
   * Property: Edge cases should still produce valid output.
   */
  describe('Edge Case Handling', () => {
    it('should handle empty strings', async () => {
      await fc.assert(
        fc.asyncProperty(fc.constant(''), async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Valid output even for empty string
          expect(VALID_COMPLEXITY_LEVELS).toContain(result.level);
          expect(result.confidence).toBeGreaterThanOrEqual(0.0);
          expect(result.confidence).toBeLessThanOrEqual(1.0);
        }),
        { numRuns: 10 }
      );
    });

    it('should handle whitespace-only strings', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 100 }),
          async (task) => {
            // Act
            const result = await classifier.classify(task);

            // Assert: Valid output even for whitespace-only strings
            expect(VALID_COMPLEXITY_LEVELS).toContain(result.level);
            expect(result.confidence).toBeGreaterThanOrEqual(0.0);
            expect(result.confidence).toBeLessThanOrEqual(1.0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle strings with only special characters', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.stringOf(
            fc.constantFrom('!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '[', ']', '{', '}', '<', '>', '/', '\\', '|', '~', '`'),
            { minLength: 1, maxLength: 100 }
          ),
          async (task) => {
            // Act
            const result = await classifier.classify(task);

            // Assert: Valid output even for special character strings
            expect(VALID_COMPLEXITY_LEVELS).toContain(result.level);
            expect(result.confidence).toBeGreaterThanOrEqual(0.0);
            expect(result.confidence).toBeLessThanOrEqual(1.0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle strings with null bytes and control characters', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.stringOf(fc.integer({ min: 0, max: 31 }).map(n => String.fromCharCode(n)), { minLength: 1, maxLength: 50 }),
          async (task) => {
            // Act
            const result = await classifier.classify(task);

            // Assert: Valid output even for control character strings
            expect(VALID_COMPLEXITY_LEVELS).toContain(result.level);
            expect(result.confidence).toBeGreaterThanOrEqual(0.0);
            expect(result.confidence).toBeLessThanOrEqual(1.0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle extremely long strings', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 10000, maxLength: 50000 }),
          async (task) => {
            // Act
            const result = await classifier.classify(task);

            // Assert: Valid output even for extremely long strings
            expect(VALID_COMPLEXITY_LEVELS).toContain(result.level);
            expect(result.confidence).toBeGreaterThanOrEqual(0.0);
            expect(result.confidence).toBeLessThanOrEqual(1.0);
          }
        ),
        { numRuns: 50 } // Fewer runs due to large string generation
      );
    });
  });
});

// ============================================================================
// Property 2: Simple Task Classification
// ============================================================================

/**
 * Property-Based Tests for Task Classifier
 * Feature: model-router, Property 2: Simple Task Classification
 *
 * **Validates: Requirements 1.2**
 *
 * Property 2: For any task description containing simple-task indicators
 * (single-file changes, text formatting, simple CRUD operations, summarization,
 * or estimated output under 500 tokens), the TaskClassifier SHALL assign a
 * complexity level of 'simple'.
 */
describe('Property 2: Simple Task Classification', () => {
  let classifier: TaskClassifier;

  beforeEach(() => {
    classifier = new TaskClassifier();
  });

  /**
   * Simple task indicators from DEFAULT_CRITERIA
   */
  const SIMPLE_INDICATORS = [
    'format',
    'summarize',
    'list',
    'single file',
    'rename',
    'simple',
    'basic',
    'quick',
    'minor',
    'typo',
    'comment',
  ];

  /**
   * Generates a task string that contains at least one simple indicator.
   * The indicator is embedded in a realistic task description context.
   */
  const arbitrarySimpleTaskWithIndicator = fc.oneof(
    // Direct simple indicator usage
    fc.constantFrom(...SIMPLE_INDICATORS).map(indicator => `Please ${indicator} this code`),
    // Simple indicator with prefix context
    fc.tuple(
      fc.constantFrom(...SIMPLE_INDICATORS),
      fc.string({ minLength: 0, maxLength: 50 })
    ).map(([indicator, suffix]) => `${indicator} the ${suffix}`),
    // Simple indicator with suffix context
    fc.tuple(
      fc.string({ minLength: 0, maxLength: 50 }),
      fc.constantFrom(...SIMPLE_INDICATORS)
    ).map(([prefix, indicator]) => `${prefix} ${indicator}`),
    // Simple indicator embedded in sentence
    fc.tuple(
      fc.string({ minLength: 0, maxLength: 30 }),
      fc.constantFrom(...SIMPLE_INDICATORS),
      fc.string({ minLength: 0, maxLength: 30 })
    ).map(([prefix, indicator, suffix]) => `${prefix} ${indicator} ${suffix}`)
  );

  /**
   * Medium and complex indicators to avoid in simple task generation.
   * These would cause the classifier to prioritize higher complexity.
   */
  const MEDIUM_INDICATORS = [
    'refactor', 'api', 'integration', 'multiple files', 'test',
    'implement', 'feature', 'update', 'modify', 'enhance'
  ];
  const COMPLEX_INDICATORS = [
    'architecture', 'design', 'security', 'performance', 'system',
    'cross-module', 'migration', 'optimization', 'scale', 'infrastructure'
  ];

  /**
   * Generates realistic simple task descriptions using simple indicators.
   * Avoids medium/complex indicators to ensure pure simple classification.
   */
  const arbitraryRealisticSimpleTask = fc.oneof(
    // Format-related tasks
    fc.constantFrom(
      'format the code in main.ts',
      'format this file',
      'please format the JSON',
      'format the indentation'
    ),
    // Summarize-related tasks
    fc.constantFrom(
      'summarize this document',
      'summarize the meeting notes',
      'please summarize the changes',
      'summarize the README'
    ),
    // List-related tasks
    fc.constantFrom(
      'list all the files',
      'list the dependencies',
      'please list the functions',
      'list available options'
    ),
    // Single file tasks (avoiding 'update', 'modify' which are medium indicators)
    fc.constantFrom(
      'single file config.json',
      'change single file only',
      'edit single file README.md',
      'single file change needed'
    ),
    // Rename-related tasks
    fc.constantFrom(
      'rename the variable',
      'rename this function',
      'please rename the file',
      'rename the class'
    ),
    // Simple/basic/quick tasks (avoiding medium indicators)
    fc.constantFrom(
      'simple change to the header',
      'basic change to the footer',
      'quick fix for the button',
      'simple task needed'
    ),
    // Minor/typo/comment tasks
    fc.constantFrom(
      'fix minor issue in the code',
      'fix typo in the documentation',
      'add comment to explain the logic',
      'minor adjustment to the style'
    )
  );

  /**
   * Generates task strings with a simple indicator and short content
   * (under 500 tokens estimated).
   */
  const arbitraryShortSimpleTask = fc.tuple(
    fc.constantFrom(...SIMPLE_INDICATORS),
    fc.string({ minLength: 1, maxLength: 100 }) // Short content to stay under 500 tokens
  ).map(([indicator, context]) => `${indicator}: ${context}`);

  /**
   * **Validates: Requirements 1.2**
   *
   * Property: Tasks containing simple indicators SHALL be classified as 'simple'.
   */
  describe('Simple Indicator Classification', () => {
    it('should classify tasks with simple indicators as simple', async () => {
      await fc.assert(
        fc.asyncProperty(arbitrarySimpleTaskWithIndicator, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Task with simple indicator should be classified as 'simple'
          expect(result.level).toBe('simple');
        }),
        { numRuns: 100 }
      );
    });

    it('should classify realistic simple tasks as simple', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryRealisticSimpleTask, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Realistic simple task should be classified as 'simple'
          expect(result.level).toBe('simple');
        }),
        { numRuns: 100 }
      );
    });

    it('should classify short tasks with simple indicators as simple', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryShortSimpleTask, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Short task with simple indicator should be classified as 'simple'
          expect(result.level).toBe('simple');
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * Property: Each individual simple indicator should trigger simple classification.
   */
  describe('Individual Simple Indicator Tests', () => {
    it('should classify tasks with "format" indicator as simple', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `format ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "summarize" indicator as simple', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `summarize ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "list" indicator as simple', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `list ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "single file" indicator as simple', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Use alphanumeric strings without medium/complex indicators
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '.split('')), { minLength: 0, maxLength: 30 }),
          async (context) => {
            const task = `single file ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "rename" indicator as simple', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `rename ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "simple" indicator as simple', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `simple ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "basic" indicator as simple', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `basic ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "quick" indicator as simple', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `quick ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "minor" indicator as simple', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `minor ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "typo" indicator as simple', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `typo ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "comment" indicator as simple', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `comment ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * Property: Simple indicators should be case-insensitive.
   */
  describe('Case Insensitivity', () => {
    it('should classify tasks with uppercase simple indicators as simple', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...SIMPLE_INDICATORS.map(i => i.toUpperCase())),
          fc.string({ minLength: 0, maxLength: 50 }),
          async (indicator, context) => {
            const task = `${indicator} ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with mixed-case simple indicators as simple', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            'Format', 'SUMMARIZE', 'List', 'SINGLE FILE', 'Rename',
            'Simple', 'BASIC', 'Quick', 'MINOR', 'Typo', 'COMMENT'
          ),
          fc.string({ minLength: 0, maxLength: 50 }),
          async (indicator, context) => {
            const task = `${indicator} ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('simple');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// ============================================================================
// Property 3: Medium Task Classification
// ============================================================================

/**
 * Property-Based Tests for Task Classifier
 * Feature: model-router, Property 3: Medium Task Classification
 *
 * **Validates: Requirements 1.3**
 *
 * Property 3: For any task description containing medium-task indicators
 * (multi-file changes, API integrations, moderate refactoring, or code generation
 * under 2000 tokens), the TaskClassifier SHALL assign a complexity level of 'medium'.
 */
describe('Property 3: Medium Task Classification', () => {
  let classifier: TaskClassifier;

  beforeEach(() => {
    classifier = new TaskClassifier();
  });

  /**
   * Medium task indicators from DEFAULT_CRITERIA
   */
  const MEDIUM_INDICATORS = [
    'refactor',
    'api',
    'integration',
    'multiple files',
    'test',
    'implement',
    'feature',
    'update',
    'modify',
    'enhance',
  ];

  /**
   * Complex indicators to avoid in medium task generation.
   * These would cause the classifier to prioritize higher complexity.
   */
  const COMPLEX_INDICATORS = [
    'architecture', 'design', 'security', 'performance', 'system',
    'cross-module', 'migration', 'optimization', 'scale', 'infrastructure'
  ];

  /**
   * Generates a task string that contains at least one medium indicator.
   * The indicator is embedded in a realistic task description context.
   * Avoids complex indicators to ensure pure medium classification.
   */
  const arbitraryMediumTaskWithIndicator = fc.oneof(
    // Direct medium indicator usage
    fc.constantFrom(...MEDIUM_INDICATORS).map(indicator => `Please ${indicator} this code`),
    // Medium indicator with prefix context
    fc.tuple(
      fc.constantFrom(...MEDIUM_INDICATORS),
      fc.string({ minLength: 0, maxLength: 50 })
    ).map(([indicator, suffix]) => `${indicator} the ${suffix}`),
    // Medium indicator with suffix context
    fc.tuple(
      fc.string({ minLength: 0, maxLength: 50 }),
      fc.constantFrom(...MEDIUM_INDICATORS)
    ).map(([prefix, indicator]) => `${prefix} ${indicator}`),
    // Medium indicator embedded in sentence
    fc.tuple(
      fc.string({ minLength: 0, maxLength: 30 }),
      fc.constantFrom(...MEDIUM_INDICATORS),
      fc.string({ minLength: 0, maxLength: 30 })
    ).map(([prefix, indicator, suffix]) => `${prefix} ${indicator} ${suffix}`)
  );

  /**
   * Generates realistic medium task descriptions using medium indicators.
   * Avoids complex indicators to ensure pure medium classification.
   */
  const arbitraryRealisticMediumTask = fc.oneof(
    // Refactor-related tasks
    fc.constantFrom(
      'refactor the module',
      'refactor this function',
      'please refactor the class',
      'refactor the code'
    ),
    // API-related tasks
    fc.constantFrom(
      'api endpoint for users',
      'create api handler',
      'please add api route',
      'api call to backend'
    ),
    // Integration-related tasks
    fc.constantFrom(
      'integration with database',
      'add integration layer',
      'please create integration',
      'integration for service'
    ),
    // Multiple files tasks
    fc.constantFrom(
      'multiple files need changes',
      'change multiple files',
      'edit multiple files',
      'multiple files affected'
    ),
    // Test-related tasks
    fc.constantFrom(
      'test the function',
      'write test for module',
      'please add test cases',
      'test coverage needed'
    ),
    // Implement-related tasks
    fc.constantFrom(
      'implement the handler',
      'implement this logic',
      'please implement method',
      'implement the service'
    ),
    // Feature-related tasks
    fc.constantFrom(
      'feature for login',
      'add feature to dashboard',
      'please create feature',
      'feature request'
    ),
    // Update-related tasks
    fc.constantFrom(
      'update the config',
      'update this component',
      'please update the code',
      'update the dependencies'
    ),
    // Modify-related tasks
    fc.constantFrom(
      'modify the behavior',
      'modify this function',
      'please modify the logic',
      'modify the output'
    ),
    // Enhance-related tasks
    fc.constantFrom(
      'enhance the component',
      'enhance this module',
      'please enhance the code',
      'enhance the functionality'
    )
  );

  /**
   * Generates task strings with a medium indicator and moderate content
   * (under 2000 tokens estimated).
   */
  const arbitraryModerateMediumTask = fc.tuple(
    fc.constantFrom(...MEDIUM_INDICATORS),
    fc.string({ minLength: 1, maxLength: 200 }) // Moderate content to stay under 2000 tokens
  ).map(([indicator, context]) => `${indicator}: ${context}`);

  /**
   * **Validates: Requirements 1.3**
   *
   * Property: Tasks containing medium indicators SHALL be classified as 'medium'.
   */
  describe('Medium Indicator Classification', () => {
    it('should classify tasks with medium indicators as medium', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryMediumTaskWithIndicator, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Task with medium indicator should be classified as 'medium'
          expect(result.level).toBe('medium');
        }),
        { numRuns: 100 }
      );
    });

    it('should classify realistic medium tasks as medium', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryRealisticMediumTask, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Realistic medium task should be classified as 'medium'
          expect(result.level).toBe('medium');
        }),
        { numRuns: 100 }
      );
    });

    it('should classify moderate-length tasks with medium indicators as medium', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryModerateMediumTask, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Moderate-length task with medium indicator should be classified as 'medium'
          expect(result.level).toBe('medium');
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.3**
   *
   * Property: Each individual medium indicator should trigger medium classification.
   */
  describe('Individual Medium Indicator Tests', () => {
    it('should classify tasks with "refactor" indicator as medium', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `refactor ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('medium');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "api" indicator as medium', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `api ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('medium');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "integration" indicator as medium', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `integration ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('medium');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "multiple files" indicator as medium', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `multiple files ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('medium');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "test" indicator as medium', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `test ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('medium');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "implement" indicator as medium', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `implement ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('medium');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "feature" indicator as medium', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `feature ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('medium');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "update" indicator as medium', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `update ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('medium');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "modify" indicator as medium', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `modify ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('medium');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "enhance" indicator as medium', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `enhance ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('medium');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.3**
   *
   * Property: Medium indicators should be case-insensitive.
   */
  describe('Case Insensitivity', () => {
    it('should classify tasks with uppercase medium indicators as medium', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...MEDIUM_INDICATORS.map(i => i.toUpperCase())),
          fc.string({ minLength: 0, maxLength: 50 }),
          async (indicator, context) => {
            const task = `${indicator} ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('medium');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with mixed-case medium indicators as medium', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            'Refactor', 'API', 'Integration', 'MULTIPLE FILES', 'Test',
            'Implement', 'FEATURE', 'Update', 'MODIFY', 'Enhance'
          ),
          fc.string({ minLength: 0, maxLength: 50 }),
          async (indicator, context) => {
            const task = `${indicator} ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('medium');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// ============================================================================
// Property 4: Complex Task Classification
// ============================================================================

/**
 * Property-Based Tests for Task Classifier
 * Feature: model-router, Property 4: Complex Task Classification
 *
 * **Validates: Requirements 1.4**
 *
 * Property 4: For any task description containing complex-task indicators
 * (architectural decisions, system design, cross-module refactoring, security analysis,
 * or code generation over 2000 tokens), the TaskClassifier SHALL assign a
 * complexity level of 'complex'.
 */
describe('Property 4: Complex Task Classification', () => {
  let classifier: TaskClassifier;

  beforeEach(() => {
    classifier = new TaskClassifier();
  });

  /**
   * Complex task indicators from DEFAULT_CRITERIA
   */
  const COMPLEX_INDICATORS = [
    'architecture',
    'design',
    'security',
    'performance',
    'system',
    'cross-module',
    'migration',
    'optimization',
    'scale',
    'infrastructure',
  ];

  /**
   * Generates a task string that contains at least one complex indicator.
   * The indicator is embedded in a realistic task description context.
   */
  const arbitraryComplexTaskWithIndicator = fc.oneof(
    // Direct complex indicator usage
    fc.constantFrom(...COMPLEX_INDICATORS).map(indicator => `Please ${indicator} this code`),
    // Complex indicator with prefix context
    fc.tuple(
      fc.constantFrom(...COMPLEX_INDICATORS),
      fc.string({ minLength: 0, maxLength: 50 })
    ).map(([indicator, suffix]) => `${indicator} the ${suffix}`),
    // Complex indicator with suffix context
    fc.tuple(
      fc.string({ minLength: 0, maxLength: 50 }),
      fc.constantFrom(...COMPLEX_INDICATORS)
    ).map(([prefix, indicator]) => `${prefix} ${indicator}`),
    // Complex indicator embedded in sentence
    fc.tuple(
      fc.string({ minLength: 0, maxLength: 30 }),
      fc.constantFrom(...COMPLEX_INDICATORS),
      fc.string({ minLength: 0, maxLength: 30 })
    ).map(([prefix, indicator, suffix]) => `${prefix} ${indicator} ${suffix}`)
  );

  /**
   * Generates realistic complex task descriptions using complex indicators.
   * Note: Uses exact complex indicator keywords to ensure proper classification.
   * "scaling" is not used because it doesn't contain the exact keyword "scale" as a separate word.
   */
  const arbitraryRealisticComplexTask = fc.oneof(
    // Architecture-related tasks
    fc.constantFrom(
      'architecture review needed',
      'define the architecture',
      'please review architecture',
      'architecture decision required'
    ),
    // Design-related tasks
    fc.constantFrom(
      'design the system',
      'create design document',
      'please design the solution',
      'design patterns needed'
    ),
    // Security-related tasks
    fc.constantFrom(
      'security audit required',
      'review security concerns',
      'please analyze security',
      'security vulnerability check'
    ),
    // Performance-related tasks
    fc.constantFrom(
      'performance analysis needed',
      'optimize performance',
      'please review performance',
      'performance bottleneck'
    ),
    // System-related tasks
    fc.constantFrom(
      'system integration required',
      'design system components',
      'please review system',
      'system level changes'
    ),
    // Cross-module tasks
    fc.constantFrom(
      'cross-module refactoring',
      'cross-module dependencies',
      'please handle cross-module',
      'cross-module changes needed'
    ),
    // Migration-related tasks
    fc.constantFrom(
      'migration to new database',
      'data migration required',
      'please plan migration',
      'migration strategy needed'
    ),
    // Optimization-related tasks
    fc.constantFrom(
      'optimization of queries',
      'code optimization needed',
      'please run optimization',
      'optimization strategy'
    ),
    // Scale-related tasks (using exact keyword "scale")
    fc.constantFrom(
      'scale the application',
      'need to scale this',
      'please plan scale',
      'scale for high traffic'
    ),
    // Infrastructure-related tasks
    fc.constantFrom(
      'infrastructure setup',
      'infrastructure changes',
      'please review infrastructure',
      'infrastructure as code'
    )
  );

  /**
   * Generates task strings with a complex indicator and substantial content.
   */
  const arbitrarySubstantialComplexTask = fc.tuple(
    fc.constantFrom(...COMPLEX_INDICATORS),
    fc.string({ minLength: 1, maxLength: 300 })
  ).map(([indicator, context]) => `${indicator}: ${context}`);

  /**
   * **Validates: Requirements 1.4**
   *
   * Property: Tasks containing complex indicators SHALL be classified as 'complex'.
   */
  describe('Complex Indicator Classification', () => {
    it('should classify tasks with complex indicators as complex', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryComplexTaskWithIndicator, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Task with complex indicator should be classified as 'complex'
          expect(result.level).toBe('complex');
        }),
        { numRuns: 100 }
      );
    });

    it('should classify realistic complex tasks as complex', async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryRealisticComplexTask, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Realistic complex task should be classified as 'complex'
          expect(result.level).toBe('complex');
        }),
        { numRuns: 100 }
      );
    });

    it('should classify substantial tasks with complex indicators as complex', async () => {
      await fc.assert(
        fc.asyncProperty(arbitrarySubstantialComplexTask, async (task) => {
          // Act
          const result = await classifier.classify(task);

          // Assert: Substantial task with complex indicator should be classified as 'complex'
          expect(result.level).toBe('complex');
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Property: Each individual complex indicator should trigger complex classification.
   */
  describe('Individual Complex Indicator Tests', () => {
    it('should classify tasks with "architecture" indicator as complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `architecture ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "design" indicator as complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `design ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "security" indicator as complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `security ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "performance" indicator as complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `performance ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "system" indicator as complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `system ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "cross-module" indicator as complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `cross-module ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "migration" indicator as complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `migration ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "optimization" indicator as complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `optimization ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "scale" indicator as complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `scale ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with "infrastructure" indicator as complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 50 }),
          async (context) => {
            const task = `infrastructure ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Property: Complex indicators should be case-insensitive.
   */
  describe('Case Insensitivity', () => {
    it('should classify tasks with uppercase complex indicators as complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...COMPLEX_INDICATORS.map(i => i.toUpperCase())),
          fc.string({ minLength: 0, maxLength: 50 }),
          async (indicator, context) => {
            const task = `${indicator} ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should classify tasks with mixed-case complex indicators as complex', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            'Architecture', 'DESIGN', 'Security', 'PERFORMANCE', 'System',
            'CROSS-MODULE', 'Migration', 'OPTIMIZATION', 'Scale', 'INFRASTRUCTURE'
          ),
          fc.string({ minLength: 0, maxLength: 50 }),
          async (indicator, context) => {
            const task = `${indicator} ${context}`;
            const result = await classifier.classify(task);
            expect(result.level).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Property: Tasks with high token count (over 2000 tokens) should be classified as complex.
   * Note: Token estimation uses words * 1.3, so we need actual words (not just whitespace).
   */
  describe('Token-Based Complex Classification', () => {
    it('should classify very long tasks with many words as complex due to token estimation', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate arrays of words that will estimate to over 2000 tokens
          // Token estimation: words * 1.3, so ~1540 words needed for 2000 tokens
          fc.array(
            fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'), { minLength: 3, maxLength: 8 }),
            { minLength: 1600, maxLength: 2000 }
          ),
          async (words) => {
            const task = words.join(' ');

            // Act
            const result = await classifier.classify(task);

            // Assert: Very long task with many words should be classified as 'complex' due to token count
            expect(result.level).toBe('complex');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
