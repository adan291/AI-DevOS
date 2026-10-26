/**
 * Event Router
 * 
 * Determines if an event should be processed and extracts context keys
 * (orgId, projectId, threadId) from NormalizedEvent.
 * 
 * The router is the first component in the orchestrator pipeline,
 * filtering events and preparing them for context loading.
 */

import type { NormalizedEvent } from '../types/events.js';
import type { EventRouter, RoutingDecision } from '../types/orchestrator.js';

/**
 * Event types that should be processed by the orchestrator
 */
const PROCESSABLE_EVENT_TYPES: NormalizedEvent['type'][] = [
  'message',
  'thread_create',
  'reaction_add',
  'slash_command',
  'github_webhook',
];

/**
 * Default implementation of EventRouter
 * 
 * Determines if an event should be processed based on event type
 * and extracts context keys for the ContextLoader.
 */
export class DefaultEventRouter implements EventRouter {
  /**
   * Routes an event by determining if it should be processed
   * and extracting the context keys needed for loading context.
   * 
   * @param event - The normalized event to route
   * @returns RoutingDecision with shouldProcess flag and contextKeys
   */
  async route(event: NormalizedEvent): Promise<RoutingDecision> {
    const shouldProcess = this.shouldProcessEvent(event);
    const contextKeys = this.extractContextKeys(event);

    return {
      shouldProcess,
      contextKeys,
    };
  }

  /**
   * Determines if an event should be processed by the orchestrator.
   * 
   * Events are processed if:
   * 1. The event type is in the list of processable types
   * 2. For message events: the message is not from a bot (to avoid loops)
   * 
   * @param event - The normalized event to check
   * @returns true if the event should be processed
   */
  private shouldProcessEvent(event: NormalizedEvent): boolean {
    // Check if event type is processable
    if (!PROCESSABLE_EVENT_TYPES.includes(event.type)) {
      return false;
    }

    // For message events, skip bot messages to avoid infinite loops
    if (event.type === 'message') {
      const payload = event.payload as { authorIsBot?: boolean };
      if (payload.authorIsBot) {
        return false;
      }
    }

    return true;
  }

  /**
   * Extracts context keys from a normalized event.
   * 
   * Context keys are used by the ContextLoader to fetch:
   * - orgId (guildId): Organization/Discord server context
   * - projectId (channelId): Project/Discord channel context
   * - threadId: Thread/Discord thread context (optional)
   * 
   * @param event - The normalized event to extract keys from
   * @returns Context keys for loading org, project, and thread context
   */
  private extractContextKeys(event: NormalizedEvent): RoutingDecision['contextKeys'] {
    return {
      orgId: event.guildId,
      projectId: event.channelId,
      threadId: event.threadId,
    };
  }
}

/**
 * Creates a new EventRouter instance
 */
export function createEventRouter(): EventRouter {
  return new DefaultEventRouter();
}
