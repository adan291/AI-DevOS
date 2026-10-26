/**
 * Reaction Handler
 * Maps Discord reactions to agent invocations
 * Requirements: 6.4, 6.5, 6.6, 6.7
 */

import type { AgentRole } from '../types/agents.js';
import type { NormalizedEvent, ReactionPayload } from '../types/events.js';
import type { ThreadContext, ThreadState } from '../types/models.js';

/** Reaction to agent mapping result */
export interface ReactionMapping {
  agentRole: AgentRole;
  reason: string;
}

/** Context needed for reaction handling */
export interface ReactionContext {
  thread?: ThreadContext;
  lastAgentRole?: AgentRole;
}

/**
 * Maps a reaction emoji to the appropriate agent based on context
 * 
 * Mapping rules:
 * - ✅ (approve): Reviewer if in review state, DevOps if approved
 * - ❌ (reject): Developer to fix issues
 * - 🔁 (retry): Re-run the last agent
 * - 🚀 (deploy): DevOps for deployment
 */
export function mapReactionToAgent(
  emoji: ReactionPayload['emoji'],
  context: ReactionContext
): ReactionMapping | null {
  const threadState = context.thread?.state ?? 'open';
  const lastAgent = context.lastAgentRole;

  switch (emoji) {
    case '✅':
      return mapApproveReaction(threadState);
    
    case '❌':
      return {
        agentRole: 'developer',
        reason: 'Rejection requires Developer to address issues',
      };
    
    case '🔁':
      return mapRetryReaction(lastAgent);
    
    case '🚀':
      return {
        agentRole: 'devops',
        reason: 'Deploy request triggers DevOps agent',
      };
    
    default:
      return null;
  }
}

/**
 * Maps approve reaction based on thread state
 */
function mapApproveReaction(state: ThreadState): ReactionMapping {
  switch (state) {
    case 'review':
      return {
        agentRole: 'reviewer',
        reason: 'Approval in review state confirms Reviewer assessment',
      };
    
    case 'in_progress':
      return {
        agentRole: 'reviewer',
        reason: 'Approval in progress triggers review phase',
      };
    
    case 'done':
      return {
        agentRole: 'devops',
        reason: 'Approval on done thread triggers deployment',
      };
    
    case 'open':
    default:
      return {
        agentRole: 'coordinator',
        reason: 'Approval on open thread starts coordination',
      };
  }
}

/**
 * Maps retry reaction to re-run the last agent
 */
function mapRetryReaction(lastAgent?: AgentRole): ReactionMapping {
  if (lastAgent) {
    return {
      agentRole: lastAgent,
      reason: `Retry requested for last agent: ${lastAgent}`,
    };
  }
  
  return {
    agentRole: 'coordinator',
    reason: 'No previous agent found, starting with Coordinator',
  };
}

/** Reaction Handler interface */
export interface ReactionHandler {
  handle(event: NormalizedEvent, context: ReactionContext): Promise<ReactionMapping | null>;
}

/** Default implementation of ReactionHandler */
export class DefaultReactionHandler implements ReactionHandler {
  async handle(
    event: NormalizedEvent,
    context: ReactionContext
  ): Promise<ReactionMapping | null> {
    if (event.type !== 'reaction_add') {
      return null;
    }

    const payload = event.payload as ReactionPayload;
    return mapReactionToAgent(payload.emoji, context);
  }
}

/** Factory function */
export function createReactionHandler(): ReactionHandler {
  return new DefaultReactionHandler();
}
