/**
 * Fallback Strategy Types
 * 
 * Defines interfaces and types for managing fallback logic when models fail.
 * Handles rate limit errors, non-rate-limit errors, and complexity escalation.
 */

import type { ModelSelection } from './model-router.js';

/** Fallback action to take */
export type FallbackAction =
  | { type: 'retry'; delayMs: number }
  | { type: 'fallback'; model: ModelSelection }
  | { type: 'escalate'; toLevel: 'medium' | 'complex' }
  | { type: 'fail'; reason: string };

/** Fallback attempt record */
export interface FallbackAttempt {
  model: ModelSelection;
  error: string;
  timestamp: Date;
}

/** Fallback Strategy interface */
export interface IFallbackStrategy {
  /**
   * Determine next action after a model failure.
   *
   * @param error - The error that occurred
   * @param currentModel - The model that failed
   * @param attempts - Previous fallback attempts
   * @returns The action to take
   */
  getNextAction(
    error: Error,
    currentModel: ModelSelection,
    attempts: FallbackAttempt[]
  ): Promise<FallbackAction>;

  /**
   * Check if error is a rate limit error.
   */
  isRateLimitError(error: Error): boolean;

  /**
   * Extract retry-after duration from rate limit error.
   */
  getRetryAfterMs(error: Error): number | null;
}

/** Maximum fallback attempts before failing */
export const MAX_FALLBACK_ATTEMPTS = 3;
