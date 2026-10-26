/**
 * Agent types for the Motor de Agentes
 * Defines agent roles, interfaces and execution plans
 */

import type { FullContext } from './orchestrator.js';

/** The 8 agent roles supported by the system */
export type AgentRole = 
  | 'coordinator' 
  | 'architect' 
  | 'planner' 
  | 'developer' 
  | 'reviewer' 
  | 'qa' 
  | 'devops' 
  | 'memory';

/** Result of an agent execution */
export interface AgentResult {
  role: AgentRole;
  output: string;
  content?: string;  // alias for output
  structured?: Record<string, unknown>;  // JSON structured output (Memory Agent)
  success: boolean;
  error?: string;
  alreadySent?: boolean;  // true if response was already sent via streaming
}

/** Callback for streaming chunks */
export type StreamCallback = (chunk: string, fullText: string) => Promise<void>;

/** Agent interface — all agents implement this */
export interface Agent {
  role: AgentRole;
  execute(context: FullContext, taskDescription: string, onStream?: StreamCallback): Promise<AgentResult>;
}

/** Execution plan returned by the Coordinator */
export interface ExecutionPlan {
  agents: AgentRole[];       // ordered sequence
  reason: string;            // justification for the plan
  createProject?: boolean;   // whether to create Discord project structure
  projectName?: string;      // name for the new project
}

/** Agent prompt configuration */
export interface AgentPromptConfig {
  role: AgentRole;
  systemPrompt: string;      // fixed role prompt
}
