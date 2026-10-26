/**
 * Event types for the Gateway
 * Normalized event format for all Discord and GitHub events
 */

import type { AgentRole } from './agents.js';

/** Payload for message events */
export interface MessagePayload {
  content: string;
  authorIsBot: boolean;
}

/** Payload for thread creation events */
export interface ThreadPayload {
  name: string;
  parentChannelId: string;
}

/** Payload for reaction events */
export interface ReactionPayload {
  emoji: '✅' | '❌' | '🔁' | '🚀';
  messageId: string;
  targetAgentRole?: AgentRole;
}

/** Payload for slash command events */
export interface SlashCommandPayload {
  command: 'start' | 'plan' | 'code' | 'review' | 'test' | 'deploy' | 'summary';
  options?: Record<string, string>;
}

/** Payload for GitHub webhook events */
export interface GitHubWebhookPayload {
  action: 'opened' | 'closed' | 'synchronize' | 'review_submitted';
  prNumber: number;
  prTitle: string;
  prUrl: string;
  repository: string;
  author: string;
}

/** Union type for all event payloads */
export type EventPayload =
  | MessagePayload
  | ThreadPayload
  | ReactionPayload
  | SlashCommandPayload
  | GitHubWebhookPayload;

/** Normalized event — unified format for all Gateway events */
export interface NormalizedEvent {
  id: string;
  type: 'message' | 'thread_create' | 'reaction_add' | 'slash_command' | 'github_webhook';
  guildId: string;      // Discord server
  channelId: string;    // channel = project
  threadId?: string;    // thread = task
  userId: string;       // event author
  timestamp: number;
  payload: EventPayload;
}
