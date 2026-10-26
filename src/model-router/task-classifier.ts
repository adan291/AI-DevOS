/**
 * Task Classifier
 * 
 * Analyzes task descriptions to determine complexity level.
 * Uses keyword matching and token estimation for classification.
 */

import type { ComplexityLevel, ClassificationResult } from './model-router.js';

/** Criteria for complexity classification */
export interface ClassificationCriteria {
  simple: string[];  // Keywords/patterns for simple tasks
  medium: string[];  // Keywords/patterns for medium tasks
  complex: string[]; // Keywords/patterns for complex tasks
}

/** Task Classifier interface */
export interface ITaskClassifier {
  /**
   * Classify a task's complexity level.
   * Must complete within 2 seconds.
   */
  classify(task: string): Promise<ClassificationResult>;

  /**
   * Update classification criteria at runtime.
   */
  updateCriteria(criteria: Partial<ClassificationCriteria>): void;
}

/** Default classification criteria */
export const DEFAULT_CRITERIA: ClassificationCriteria = {
  simple: [
    'format', 'summarize', 'list', 'single file', 'rename',
    'simple', 'basic', 'quick', 'minor', 'typo', 'comment'
  ],
  medium: [
    'refactor', 'api', 'integration', 'multiple files', 'test',
    'implement', 'feature', 'update', 'modify', 'enhance'
  ],
  complex: [
    'architecture', 'design', 'security', 'performance', 'system',
    'cross-module', 'migration', 'optimization', 'scale', 'infrastructure'
  ]
};

/** Token thresholds for classification */
export const TOKEN_THRESHOLDS = {
  simple: 500,    // Under 500 tokens
  medium: 2000,   // Under 2000 tokens
  complex: 2000   // Over 2000 tokens
};

/** Classification timeout in milliseconds */
const CLASSIFICATION_TIMEOUT_MS = 2000;

/**
 * TaskClassifier implementation
 * 
 * Classifies task complexity using keyword matching and token estimation.
 * Returns medium complexity with low confidence on timeout or error.
 */
export class TaskClassifier implements ITaskClassifier {
  private criteria: ClassificationCriteria;

  constructor(criteria?: Partial<ClassificationCriteria>) {
    this.criteria = {
      simple: criteria?.simple ?? [...DEFAULT_CRITERIA.simple],
      medium: criteria?.medium ?? [...DEFAULT_CRITERIA.medium],
      complex: criteria?.complex ?? [...DEFAULT_CRITERIA.complex],
    };
  }

  /**
   * Classify a task's complexity level.
   * Must complete within 2 seconds, returns medium fallback on timeout.
   */
  async classify(task: string): Promise<ClassificationResult> {
    // Handle empty or null task - return medium with 0.5 confidence as safe default
    if (!task || task.trim().length === 0) {
      return {
        level: 'medium',
        confidence: 0.5,
        reasoning: 'Empty or null task string - defaulting to medium complexity',
      };
    }

    // Create a promise that performs the classification
    const classificationPromise = this.performClassification(task);

    // Create a timeout promise
    const timeoutPromise = new Promise<ClassificationResult>((resolve) => {
      setTimeout(() => {
        resolve({
          level: 'medium',
          confidence: 0.3,
          reasoning: 'Classification timeout - defaulting to medium complexity',
        });
      }, CLASSIFICATION_TIMEOUT_MS);
    });

    // Race between classification and timeout
    return Promise.race([classificationPromise, timeoutPromise]);
  }

  /**
   * Update classification criteria at runtime.
   */
  updateCriteria(criteria: Partial<ClassificationCriteria>): void {
    if (criteria.simple) {
      this.criteria.simple = [...criteria.simple];
    }
    if (criteria.medium) {
      this.criteria.medium = [...criteria.medium];
    }
    if (criteria.complex) {
      this.criteria.complex = [...criteria.complex];
    }
  }

  /**
   * Perform the actual classification logic.
   */
  private async performClassification(task: string): Promise<ClassificationResult> {
    try {
      const normalizedTask = task.toLowerCase();
      
      // Count keyword matches for each level
      const simpleMatches = this.countKeywordMatches(normalizedTask, this.criteria.simple);
      const mediumMatches = this.countKeywordMatches(normalizedTask, this.criteria.medium);
      const complexMatches = this.countKeywordMatches(normalizedTask, this.criteria.complex);

      // Estimate token count (rough approximation: words * 1.3)
      const estimatedTokens = this.estimateTokenCount(task);

      // Determine level based on keyword matches and token estimation
      const { level, confidence, reasoning } = this.determineComplexity(
        simpleMatches,
        mediumMatches,
        complexMatches,
        estimatedTokens
      );

      return { level, confidence, reasoning };
    } catch (error) {
      // On internal error, return medium with low confidence
      return {
        level: 'medium',
        confidence: 0.3,
        reasoning: `Classification error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Count how many keywords from the list match in the task.
   */
  private countKeywordMatches(normalizedTask: string, keywords: string[]): number {
    let count = 0;
    for (const keyword of keywords) {
      if (normalizedTask.includes(keyword.toLowerCase())) {
        count++;
      }
    }
    return count;
  }

  /**
   * Estimate token count from task string.
   * Uses rough approximation: words * 1.3
   */
  private estimateTokenCount(task: string): number {
    const words = task.split(/\s+/).filter(word => word.length > 0);
    return Math.ceil(words.length * 1.3);
  }

  /**
   * Determine complexity level based on keyword matches and token estimation.
   * Returns level, confidence, and reasoning.
   */
  private determineComplexity(
    simpleMatches: number,
    mediumMatches: number,
    complexMatches: number,
    estimatedTokens: number
  ): { level: ComplexityLevel; confidence: number; reasoning: string } {
    const totalMatches = simpleMatches + mediumMatches + complexMatches;
    
    // Token-based classification takes precedence for extreme cases
    if (estimatedTokens > TOKEN_THRESHOLDS.complex) {
      const confidence = Math.min(0.9, 0.6 + (complexMatches / Math.max(1, totalMatches)) * 0.3);
      return {
        level: 'complex',
        confidence,
        reasoning: `High token estimate (${estimatedTokens}) indicates complex task`,
      };
    }

    // If no keyword matches, use token-based classification
    if (totalMatches === 0) {
      if (estimatedTokens <= TOKEN_THRESHOLDS.simple) {
        return {
          level: 'simple',
          confidence: 0.5,
          reasoning: `No keyword matches, low token estimate (${estimatedTokens})`,
        };
      } else if (estimatedTokens <= TOKEN_THRESHOLDS.medium) {
        return {
          level: 'medium',
          confidence: 0.5,
          reasoning: `No keyword matches, moderate token estimate (${estimatedTokens})`,
        };
      } else {
        return {
          level: 'complex',
          confidence: 0.5,
          reasoning: `No keyword matches, high token estimate (${estimatedTokens})`,
        };
      }
    }

    // Keyword-based classification with confidence based on match strength
    // Complex keywords have highest priority
    if (complexMatches > 0 && complexMatches >= simpleMatches && complexMatches >= mediumMatches) {
      const confidence = this.calculateConfidence(complexMatches, totalMatches, estimatedTokens, 'complex');
      return {
        level: 'complex',
        confidence,
        reasoning: `Complex keywords matched (${complexMatches}), tokens: ${estimatedTokens}`,
      };
    }

    // Medium keywords
    if (mediumMatches > 0 && mediumMatches >= simpleMatches) {
      const confidence = this.calculateConfidence(mediumMatches, totalMatches, estimatedTokens, 'medium');
      return {
        level: 'medium',
        confidence,
        reasoning: `Medium keywords matched (${mediumMatches}), tokens: ${estimatedTokens}`,
      };
    }

    // Simple keywords
    if (simpleMatches > 0) {
      // Check if token count suggests higher complexity
      if (estimatedTokens > TOKEN_THRESHOLDS.medium) {
        const confidence = this.calculateConfidence(simpleMatches, totalMatches, estimatedTokens, 'medium');
        return {
          level: 'medium',
          confidence: confidence * 0.8, // Lower confidence due to conflicting signals
          reasoning: `Simple keywords matched (${simpleMatches}) but high token estimate (${estimatedTokens})`,
        };
      }
      const confidence = this.calculateConfidence(simpleMatches, totalMatches, estimatedTokens, 'simple');
      return {
        level: 'simple',
        confidence,
        reasoning: `Simple keywords matched (${simpleMatches}), tokens: ${estimatedTokens}`,
      };
    }

    // Default to medium if we somehow get here
    return {
      level: 'medium',
      confidence: 0.5,
      reasoning: 'Default classification',
    };
  }

  /**
   * Calculate confidence score based on match strength and token alignment.
   */
  private calculateConfidence(
    matchCount: number,
    totalMatches: number,
    estimatedTokens: number,
    level: ComplexityLevel
  ): number {
    // Base confidence from match ratio
    const matchRatio = matchCount / Math.max(1, totalMatches);
    let confidence = 0.5 + (matchRatio * 0.3);

    // Adjust based on token alignment with level
    const tokenAligned = this.isTokenAlignedWithLevel(estimatedTokens, level);
    if (tokenAligned) {
      confidence += 0.1;
    } else {
      confidence -= 0.1;
    }

    // Boost confidence for multiple matches
    if (matchCount >= 3) {
      confidence += 0.1;
    }

    // Clamp to valid range [0.0, 1.0]
    return Math.max(0.0, Math.min(1.0, confidence));
  }

  /**
   * Check if token count aligns with the expected level.
   */
  private isTokenAlignedWithLevel(estimatedTokens: number, level: ComplexityLevel): boolean {
    switch (level) {
      case 'simple':
        return estimatedTokens <= TOKEN_THRESHOLDS.simple;
      case 'medium':
        return estimatedTokens > TOKEN_THRESHOLDS.simple && estimatedTokens <= TOKEN_THRESHOLDS.medium;
      case 'complex':
        return estimatedTokens > TOKEN_THRESHOLDS.medium;
    }
  }
}
