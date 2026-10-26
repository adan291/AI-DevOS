/**
 * Orchestrator types
 * Defines the orchestrator interface and its sub-components
 */

import type { AgentRole, AgentResult } from './agents.js';
import type { NormalizedEvent } from './events.js';
import type { OrgContext, ProjectContext, ThreadContext } from './models.js';

/** Routing decision from EventRouter */
export interface RoutingDecision {
  shouldProcess: boolean;
  contextKeys: { 
    orgId: string; 
    projectId: string; 
    threadId?: string; 
  };
}

/** Full context loaded for agent execution */
export interface FullContext {
  org: OrgContext;
  project: ProjectContext;
  thread?: ThreadContext;
  memories?: Array<{ type: string; content: string }>;
  currentMessage?: string;
}

/** Event Router — determines if event should be processed */
export interface EventRouter {
  route(event: NormalizedEvent): Promise<RoutingDecision>;
}

/** Context Loader — loads context from persistence */
export interface ContextLoader {
  load(keys: RoutingDecision['contextKeys']): Promise<FullContext>;
}

/** Prompt Builder — constructs prompts with all layers */
export interface PromptBuilder {
  build(context: FullContext, agentRole: AgentRole, taskDescription: string): string;
}

/** Agent Executor — executes agents via LLM */
export interface AgentExecutor {
  execute(prompt: string, agentRole: AgentRole): Promise<AgentResult>;
}

/** Response Manager — sends responses to Discord */
export interface ResponseManager {
  send(event: NormalizedEvent, results: AgentResult[]): Promise<void>;
}

/** Main Orchestrator interface */
export interface Orchestrator {
  handleEvent(event: NormalizedEvent): Promise<void>;
}
