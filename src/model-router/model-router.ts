/**
 * Model Router Core Types
 * 
 * Defines the core interfaces and types for the intelligent LLM selection system
 * that optimizes model usage based on task complexity.
 */

import type { AgentRole } from '../types/agents.js';

/** Complexity levels for task classification */
export type ComplexityLevel = 'simple' | 'medium' | 'complex';

/** LLM Provider identifiers */
export type Provider = 'groq' | 'anthropic' | 'openai' | 'ollama';

/** Classification result from TaskClassifier */
export interface ClassificationResult {
  level: ComplexityLevel;
  confidence: number; // 0.0 to 1.0
  reasoning?: string;
}

/** Model selection result returned to BaseAgent */
export interface ModelSelection {
  provider: Provider;
  model: string;
  estimatedCostPer1KTokens: number;
  complexity: ComplexityLevel;
}

/** Execution metrics for tracking */
export interface ExecutionMetrics {
  provider: Provider;
  model: string;
  complexity: ComplexityLevel;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  error?: string;
  fallbackUsed: boolean;
  agentRole: AgentRole;
}

/** Model Router interface */
export interface IModelRouter {
  /**
   * Select the optimal model for a task.
   * Called by BaseAgent before LLM API calls.
   */
  selectModel(task: string, agentRole: AgentRole): Promise<ModelSelection>;

  /**
   * Handle model failure and get fallback.
   * Returns next model to try or null if all fallbacks exhausted.
   */
  handleFailure(
    error: Error,
    currentModel: ModelSelection,
    attemptedModels: ModelSelection[]
  ): Promise<ModelSelection | null>;

  /**
   * Record execution metrics after LLM call completes.
   */
  recordExecution(metrics: ExecutionMetrics): Promise<void>;

  /**
   * Check if Model Router is available.
   * BaseAgent falls back to default if false.
   */
  isAvailable(): boolean;
}
