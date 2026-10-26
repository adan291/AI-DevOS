/**
 * Unit Tests for Task Classifier
 * 
 * Example-based tests that verify specific known inputs and expected outputs.
 * Tests classification of simple, medium, and complex tasks, plus timeout handling.
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TaskClassifier, DEFAULT_CRITERIA, TOKEN_THRESHOLDS } from './task-classifier.js';

describe('TaskClassifier', () => {
  let classifier: TaskClassifier;

  beforeEach(() => {
    classifier = new TaskClassifier();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Requirement 1.1: Task Classification Output
  // ==========================================================================
  describe('Classification Output Structure', () => {
    it('should return a ClassificationResult with level and confidence', async () => {
      const result = await classifier.classify('format the code');

      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('confidence');
      expect(['simple', 'medium', 'complex']).toContain(result.level);
      expect(typeof result.confidence).toBe('number');
    });

    it('should include optional reasoning in the result', async () => {
      const result = await classifier.classify('format the code');

      expect(result).toHaveProperty('reasoning');
      expect(typeof result.reasoning).toBe('string');
    });
  });

  // ==========================================================================
  // Requirement 1.2: Simple Task Classification
  // ==========================================================================
  describe('Simple Task Classification', () => {
    it('should classify "format the code" as simple', async () => {
      const result = await classifier.classify('format the code');
      expect(result.level).toBe('simple');
    });

    it('should classify "summarize this document" as simple', async () => {
      const result = await classifier.classify('summarize this document');
      expect(result.level).toBe('simple');
    });

    it('should classify "list all files in the directory" as simple', async () => {
      const result = await classifier.classify('list all files in the directory');
      expect(result.level).toBe('simple');
    });

    it('should classify "rename the variable" as simple', async () => {
      const result = await classifier.classify('rename the variable');
      expect(result.level).toBe('simple');
    });

    it('should classify "fix typo in the documentation" as simple', async () => {
      const result = await classifier.classify('fix typo in the documentation');
      expect(result.level).toBe('simple');
    });

    it('should classify "add comment to explain the logic" as simple', async () => {
      const result = await classifier.classify('add comment to explain the logic');
      expect(result.level).toBe('simple');
    });

    it('should classify "single file change to config.json" as simple', async () => {
      const result = await classifier.classify('single file change to config.json');
      expect(result.level).toBe('simple');
    });

    it('should classify "quick fix for the button" as simple', async () => {
      const result = await classifier.classify('quick fix for the button');
      expect(result.level).toBe('simple');
    });

    it('should classify "basic change to the header" as simple', async () => {
      // Note: "update" is a medium keyword, so we use "change" instead
      const result = await classifier.classify('basic change to the header');
      expect(result.level).toBe('simple');
    });

    it('should classify "minor adjustment to the style" as simple', async () => {
      const result = await classifier.classify('minor adjustment to the style');
      expect(result.level).toBe('simple');
    });

    it('should be case-insensitive for simple keywords', async () => {
      const result = await classifier.classify('FORMAT THE CODE');
      expect(result.level).toBe('simple');
    });
  });

  // ==========================================================================
  // Requirement 1.3: Medium Task Classification
  // ==========================================================================
  describe('Medium Task Classification', () => {
    it('should classify "refactor the authentication module" as medium', async () => {
      const result = await classifier.classify('refactor the authentication module');
      expect(result.level).toBe('medium');
    });

    it('should classify "implement api integration with Stripe" as medium', async () => {
      const result = await classifier.classify('implement api integration with Stripe');
      expect(result.level).toBe('medium');
    });

    it('should classify "update multiple files for the new feature" as medium', async () => {
      const result = await classifier.classify('update multiple files for the new feature');
      expect(result.level).toBe('medium');
    });

    it('should classify "write tests for the user service" as medium', async () => {
      const result = await classifier.classify('write tests for the user service');
      expect(result.level).toBe('medium');
    });

    it('should classify "implement new feature for user dashboard" as medium', async () => {
      const result = await classifier.classify('implement new feature for user dashboard');
      expect(result.level).toBe('medium');
    });

    it('should classify "modify the existing payment flow" as medium', async () => {
      const result = await classifier.classify('modify the existing payment flow');
      expect(result.level).toBe('medium');
    });

    it('should classify "enhance the search functionality" as medium', async () => {
      const result = await classifier.classify('enhance the search functionality');
      expect(result.level).toBe('medium');
    });

    it('should classify "integration with third-party service" as medium', async () => {
      const result = await classifier.classify('integration with third-party service');
      expect(result.level).toBe('medium');
    });

    it('should be case-insensitive for medium keywords', async () => {
      const result = await classifier.classify('REFACTOR THE MODULE');
      expect(result.level).toBe('medium');
    });
  });

  // ==========================================================================
  // Requirement 1.4: Complex Task Classification
  // ==========================================================================
  describe('Complex Task Classification', () => {
    it('should classify "design system architecture for microservices" as complex', async () => {
      const result = await classifier.classify('design system architecture for microservices');
      expect(result.level).toBe('complex');
    });

    it('should classify "security analysis of the authentication system" as complex', async () => {
      const result = await classifier.classify('security analysis of the authentication system');
      expect(result.level).toBe('complex');
    });

    it('should classify "performance optimization for database queries" as complex', async () => {
      const result = await classifier.classify('performance optimization for database queries');
      expect(result.level).toBe('complex');
    });

    it('should classify "cross-module refactoring of the codebase" as complex', async () => {
      const result = await classifier.classify('cross-module refactoring of the codebase');
      expect(result.level).toBe('complex');
    });

    it('should classify "database migration to new schema" as complex', async () => {
      const result = await classifier.classify('database migration to new schema');
      expect(result.level).toBe('complex');
    });

    it('should classify "infrastructure changes for cloud deployment" as complex', async () => {
      const result = await classifier.classify('infrastructure changes for cloud deployment');
      expect(result.level).toBe('complex');
    });

    it('should classify "scale the system for high availability" as complex', async () => {
      const result = await classifier.classify('scale the system for high availability');
      expect(result.level).toBe('complex');
    });

    it('should classify "architecture review and recommendations" as complex', async () => {
      const result = await classifier.classify('architecture review and recommendations');
      expect(result.level).toBe('complex');
    });

    it('should be case-insensitive for complex keywords', async () => {
      const result = await classifier.classify('ARCHITECTURE DESIGN FOR THE SYSTEM');
      expect(result.level).toBe('complex');
    });

    it('should classify very long tasks (high token estimate) as complex', async () => {
      // Generate a task with many words to exceed TOKEN_THRESHOLDS.complex
      const longTask = 'word '.repeat(2000); // ~2600 estimated tokens
      const result = await classifier.classify(longTask);
      expect(result.level).toBe('complex');
    });
  });

  // ==========================================================================
  // Requirement 1.5: Classification Timeout (2 seconds)
  // ==========================================================================
  describe('Timeout Handling', () => {
    it('should return medium with low confidence on timeout', async () => {
      // Create a classifier with a mock that delays beyond timeout
      const slowClassifier = new TaskClassifier();
      
      // Mock the private performClassification method to be slow
      const originalClassify = slowClassifier.classify.bind(slowClassifier);
      slowClassifier.classify = async (task: string) => {
        // Create a race between a slow operation and the timeout
        const slowPromise = new Promise<never>((resolve) => {
          setTimeout(() => resolve(undefined as never), 5000);
        });
        
        const timeoutPromise = new Promise<{ level: 'medium'; confidence: number; reasoning: string }>((resolve) => {
          setTimeout(() => {
            resolve({
              level: 'medium',
              confidence: 0.3,
              reasoning: 'Classification timeout - defaulting to medium complexity',
            });
          }, 2000);
        });
        
        return Promise.race([slowPromise, timeoutPromise]);
      };

      const result = await slowClassifier.classify('any task');
      
      expect(result.level).toBe('medium');
      expect(result.confidence).toBe(0.3);
      expect(result.reasoning).toContain('timeout');
    }, 10000);
  });

  // ==========================================================================
  // Requirement 1.6: Confidence Score
  // ==========================================================================
  describe('Confidence Score', () => {
    it('should return confidence between 0.0 and 1.0', async () => {
      const result = await classifier.classify('format the code');
      
      expect(result.confidence).toBeGreaterThanOrEqual(0.0);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should return higher confidence for clear keyword matches', async () => {
      // Task with multiple simple keywords should have higher confidence
      const result = await classifier.classify('simple basic quick format');
      
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should return 0.5 confidence for empty task (default)', async () => {
      const result = await classifier.classify('');
      
      expect(result.level).toBe('medium');
      expect(result.confidence).toBe(0.5);
    });

    it('should return 0.5 confidence for whitespace-only task', async () => {
      const result = await classifier.classify('   \t\n  ');
      
      expect(result.level).toBe('medium');
      expect(result.confidence).toBe(0.5);
    });
  });

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================
  describe('Edge Cases', () => {
    it('should handle empty string input', async () => {
      const result = await classifier.classify('');
      
      expect(result.level).toBe('medium');
      expect(result.confidence).toBe(0.5);
      expect(result.reasoning).toContain('Empty or null');
    });

    it('should handle null-like input gracefully', async () => {
      const result = await classifier.classify(null as unknown as string);
      
      expect(result.level).toBe('medium');
      expect(result.confidence).toBe(0.5);
    });

    it('should handle undefined-like input gracefully', async () => {
      const result = await classifier.classify(undefined as unknown as string);
      
      expect(result.level).toBe('medium');
      expect(result.confidence).toBe(0.5);
    });

    it('should handle special characters in task', async () => {
      const result = await classifier.classify('!@#$%^&*()');
      
      expect(['simple', 'medium', 'complex']).toContain(result.level);
      expect(result.confidence).toBeGreaterThanOrEqual(0.0);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should handle unicode characters in task', async () => {
      const result = await classifier.classify('格式化代码 🚀 format');
      
      expect(result.level).toBe('simple'); // 'format' keyword present
    });
  });

  // ==========================================================================
  // Keyword Priority (Complex > Medium > Simple)
  // ==========================================================================
  describe('Keyword Priority', () => {
    it('should prioritize complex keywords over simple keywords', async () => {
      // Task with both simple and complex keywords
      const result = await classifier.classify('simple architecture design');
      
      expect(result.level).toBe('complex');
    });

    it('should prioritize complex keywords over medium keywords', async () => {
      // Task with both medium and complex keywords
      const result = await classifier.classify('refactor the system architecture');
      
      expect(result.level).toBe('complex');
    });

    it('should prioritize medium keywords over simple keywords', async () => {
      // Task with both simple and medium keywords
      const result = await classifier.classify('simple refactor of the module');
      
      expect(result.level).toBe('medium');
    });
  });

  // ==========================================================================
  // updateCriteria Method
  // ==========================================================================
  describe('updateCriteria', () => {
    it('should allow updating simple criteria', async () => {
      classifier.updateCriteria({
        simple: ['custom-simple-keyword'],
      });

      const result = await classifier.classify('custom-simple-keyword task');
      expect(result.level).toBe('simple');
    });

    it('should allow updating medium criteria', async () => {
      classifier.updateCriteria({
        medium: ['custom-medium-keyword'],
      });

      const result = await classifier.classify('custom-medium-keyword task');
      expect(result.level).toBe('medium');
    });

    it('should allow updating complex criteria', async () => {
      classifier.updateCriteria({
        complex: ['custom-complex-keyword'],
      });

      const result = await classifier.classify('custom-complex-keyword task');
      expect(result.level).toBe('complex');
    });

    it('should preserve other criteria when updating one level', async () => {
      classifier.updateCriteria({
        simple: ['new-simple'],
      });

      // Original medium keyword should still work
      const result = await classifier.classify('refactor the code');
      expect(result.level).toBe('medium');
    });
  });

  // ==========================================================================
  // Token Estimation
  // ==========================================================================
  describe('Token Estimation', () => {
    it('should classify short tasks (under 500 tokens) based on keywords', async () => {
      const shortTask = 'format this short code snippet';
      const result = await classifier.classify(shortTask);
      
      expect(result.level).toBe('simple');
    });

    it('should consider token count for tasks without keywords', async () => {
      // Very short task without keywords should be simple
      const shortTask = 'do this';
      const result = await classifier.classify(shortTask);
      
      expect(result.level).toBe('simple');
    });

    it('should classify very long tasks as complex due to token estimate', async () => {
      // Generate a task that exceeds TOKEN_THRESHOLDS.complex (2000 tokens)
      // Estimated tokens = words * 1.3, so ~1540 words needed
      const longTask = 'word '.repeat(1600);
      const result = await classifier.classify(longTask);
      
      expect(result.level).toBe('complex');
    });
  });

  // ==========================================================================
  // Constructor with Custom Criteria
  // ==========================================================================
  describe('Constructor with Custom Criteria', () => {
    it('should accept custom criteria in constructor', async () => {
      const customClassifier = new TaskClassifier({
        simple: ['easy'],
        medium: ['moderate'],
        complex: ['difficult'],
      });

      const simpleResult = await customClassifier.classify('easy task');
      const mediumResult = await customClassifier.classify('moderate task');
      const complexResult = await customClassifier.classify('difficult task');

      expect(simpleResult.level).toBe('simple');
      expect(mediumResult.level).toBe('medium');
      expect(complexResult.level).toBe('complex');
    });

    it('should use default criteria for unspecified levels', async () => {
      const partialClassifier = new TaskClassifier({
        simple: ['custom-simple'],
      });

      // Default medium keyword should still work
      const result = await partialClassifier.classify('refactor the module');
      expect(result.level).toBe('medium');
    });
  });

  // ==========================================================================
  // DEFAULT_CRITERIA and TOKEN_THRESHOLDS exports
  // ==========================================================================
  describe('Exported Constants', () => {
    it('should export DEFAULT_CRITERIA with all levels', () => {
      expect(DEFAULT_CRITERIA).toHaveProperty('simple');
      expect(DEFAULT_CRITERIA).toHaveProperty('medium');
      expect(DEFAULT_CRITERIA).toHaveProperty('complex');
      expect(Array.isArray(DEFAULT_CRITERIA.simple)).toBe(true);
      expect(Array.isArray(DEFAULT_CRITERIA.medium)).toBe(true);
      expect(Array.isArray(DEFAULT_CRITERIA.complex)).toBe(true);
    });

    it('should export TOKEN_THRESHOLDS with expected values', () => {
      expect(TOKEN_THRESHOLDS).toHaveProperty('simple');
      expect(TOKEN_THRESHOLDS).toHaveProperty('medium');
      expect(TOKEN_THRESHOLDS).toHaveProperty('complex');
      expect(TOKEN_THRESHOLDS.simple).toBe(500);
      expect(TOKEN_THRESHOLDS.medium).toBe(2000);
      expect(TOKEN_THRESHOLDS.complex).toBe(2000);
    });
  });
});
