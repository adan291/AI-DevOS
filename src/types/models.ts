/**
 * Data model types for persistence
 * Represents the core domain entities
 */

import type { AgentRole, AgentResult } from './agents.js';

/** Organization context (1 per Discord server) */
export interface OrgContext {
  guildId: string;
  standards: string[];
  architecture: string[];
}

/** Project context (1 per Discord channel) */
export interface ProjectContext {
  channelId: string;
  guildId: string;
  name: string;
  stack: string[];
  rules: string[];
}

/** Thread type classification */
export type ThreadType = 'feature' | 'bug' | 'pr' | 'task';

/** Thread state machine */
export type ThreadState = 'open' | 'in_progress' | 'review' | 'done';

/** Decision made by an agent */
export interface Decision {
  id: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  madeBy?: AgentRole;
  createdAt: number;
}

/** Artifact produced by an agent */
export interface Artifact {
  id: string;
  type: 'code' | 'plan' | 'review' | 'test' | 'deployment' | 'pr' | 'error_log';
  content: string;
  agentRole?: AgentRole;
  createdAt: number;
}

/** Thread context (1 per Discord thread) */
export interface ThreadContext {
  threadId: string;
  id?: string;  // alias for threadId
  channelId: string;
  type: ThreadType;
  title?: string;
  summary: string;
  state: ThreadState;
  decisions: Decision[];
  artifacts: Artifact[];
  messageCount: number;
  lastSummaryAt: number;
}

/** Memory entry for persistent knowledge */
export interface MemoryEntry {
  id: string;
  threadId: string;
  type: 'decision' | 'pattern' | 'error' | 'summary';
  content: Record<string, unknown>;
  timestamp: number;
}

/** Session data for active execution plans */
export interface SessionData {
  plan: AgentRole[];
  currentIndex: number;
  results: AgentResult[];
}
