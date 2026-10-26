/**
 * Slash Command Handler
 * Maps slash commands to agent invocations
 * Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
 */

import type { AgentRole, ExecutionPlan } from '../types/agents.js';
import type { NormalizedEvent, SlashCommandPayload } from '../types/events.js';

/** Command to agent mapping */
export interface CommandMapping {
  agents: AgentRole[];
  reason: string;
}

/** Command mappings */
const COMMAND_MAPPINGS: Record<SlashCommandPayload['command'], CommandMapping> = {
  start: {
    agents: ['coordinator'],
    reason: 'Start command initiates Coordinator which assigns architect and planner',
  },
  plan: {
    agents: ['planner'],
    reason: 'Plan command directly invokes Planner agent',
  },
  code: {
    agents: ['developer'],
    reason: 'Code command directly invokes Developer agent',
  },
  review: {
    agents: ['reviewer'],
    reason: 'Review command directly invokes Reviewer agent',
  },
  test: {
    agents: ['qa'],
    reason: 'Test command directly invokes QA agent',
  },
  deploy: {
    agents: ['devops'],
    reason: 'Deploy command directly invokes DevOps agent',
  },
  summary: {
    agents: ['memory'],
    reason: 'Summary command directly invokes Memory agent',
  },
};

/**
 * Maps a slash command to the appropriate agent(s)
 */
export function mapCommandToAgents(
  command: SlashCommandPayload['command']
): CommandMapping {
  return COMMAND_MAPPINGS[command] ?? {
    agents: ['coordinator'],
    reason: `Unknown command "${command}", defaulting to Coordinator`,
  };
}

/**
 * Creates an execution plan from a slash command
 */
export function createPlanFromCommand(
  command: SlashCommandPayload['command'],
  options?: Record<string, string>
): ExecutionPlan {
  const mapping = mapCommandToAgents(command);
  
  // For 'start' command, Coordinator will create the full plan
  // For other commands, we create a direct plan
  if (command === 'start') {
    return {
      agents: ['architect', 'planner'],
      reason: 'Start command: Coordinator assigns architect and planner for new feature',
    };
  }

  return {
    agents: mapping.agents,
    reason: mapping.reason,
  };
}

/** Slash Command Handler interface */
export interface SlashCommandHandler {
  handle(event: NormalizedEvent): Promise<ExecutionPlan | null>;
}

/** Default implementation of SlashCommandHandler */
export class DefaultSlashCommandHandler implements SlashCommandHandler {
  async handle(event: NormalizedEvent): Promise<ExecutionPlan | null> {
    if (event.type !== 'slash_command') {
      return null;
    }

    const payload = event.payload as SlashCommandPayload;
    return createPlanFromCommand(payload.command, payload.options);
  }
}

/** Factory function */
export function createSlashCommandHandler(): SlashCommandHandler {
  return new DefaultSlashCommandHandler();
}
