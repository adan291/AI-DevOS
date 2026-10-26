/**
 * PR Flow Handler
 * Handles GitHub PR webhooks and integrates with Discord threads
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */

import type { NormalizedEvent, GitHubWebhookPayload } from '../types/events.js';
import type { ThreadContext, ThreadState } from '../types/models.js';
import type { RedisStore, PostgresStore } from '../types/persistence.js';
import type { GitHubClient } from './github-client.js';

/** PR flow result */
export interface PRFlowResult {
  action: 'thread_created' | 'review_assigned' | 'merge_initiated' | 'ignored';
  threadId?: string;
  message: string;
}

/** PR Flow Handler interface */
export interface PRFlowHandler {
  /** Handle a GitHub webhook event */
  handleWebhook(
    event: NormalizedEvent,
    redisStore: RedisStore,
    postgresStore: PostgresStore
  ): Promise<PRFlowResult>;
  
  /** Initiate merge after approval */
  initiateMerge(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<boolean>;
}

/** Parse repository owner and name from full repository string */
export function parseRepository(repository: string): { owner: string; repo: string } {
  if (!repository || repository.trim() === '') {
    throw new Error(`Invalid repository format: ${repository}`);
  }
  
  const parts = repository.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository format: ${repository}`);
  }
  return { owner: parts[0], repo: parts[1] };
}

/** Default implementation of PRFlowHandler */
export class DefaultPRFlowHandler implements PRFlowHandler {
  constructor(private readonly githubClient: GitHubClient) {}

  async handleWebhook(
    event: NormalizedEvent,
    redisStore: RedisStore,
    postgresStore: PostgresStore
  ): Promise<PRFlowResult> {
    if (event.type !== 'github_webhook') {
      return {
        action: 'ignored',
        message: 'Not a GitHub webhook event',
      };
    }

    const payload = event.payload as GitHubWebhookPayload;

    switch (payload.action) {
      case 'opened':
        return this.handlePROpened(event, payload, redisStore, postgresStore);
      
      case 'synchronize':
        return {
          action: 'ignored',
          message: 'PR synchronized - no action needed',
        };
      
      case 'review_submitted':
        return {
          action: 'review_assigned',
          message: 'Review submitted notification',
        };
      
      case 'closed':
        return {
          action: 'ignored',
          message: 'PR closed',
        };
      
      default:
        return {
          action: 'ignored',
          message: `Unknown action: ${payload.action}`,
        };
    }
  }

  private async handlePROpened(
    event: NormalizedEvent,
    payload: GitHubWebhookPayload,
    redisStore: RedisStore,
    postgresStore: PostgresStore
  ): Promise<PRFlowResult> {
    const threadId = `pr-${payload.prNumber}-${Date.now()}`;
    const initialState: ThreadState = 'open';

    // Create thread context for PR
    const threadContext: ThreadContext = {
      threadId,
      channelId: event.channelId,
      type: 'pr',
      state: initialState,
      summary: `PR #${payload.prNumber}: ${payload.prTitle}`,
      decisions: [],
      artifacts: [{
        id: `artifact-${threadId}`,
        type: 'pr',
        content: JSON.stringify({
          prNumber: payload.prNumber,
          prTitle: payload.prTitle,
          prUrl: payload.prUrl,
          repository: payload.repository,
          author: payload.author,
        }),
        createdAt: Date.now(),
      }],
      messageCount: 0,
      lastSummaryAt: 0,
    };

    // Initialize state in Redis
    await redisStore.setThreadState(threadId, initialState);

    // Persist to PostgreSQL
    await postgresStore.upsertThread(threadId, {
      channelId: event.channelId,
      type: 'pr',
      state: initialState,
      summary: threadContext.summary,
      messageCount: 0,
      lastSummaryAt: 0,
    });

    return {
      action: 'thread_created',
      threadId,
      message: `Created PR thread for #${payload.prNumber}: ${payload.prTitle}`,
    };
  }

  async initiateMerge(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<boolean> {
    try {
      const success = await this.githubClient.mergePR(owner, repo, prNumber);
      return success;
    } catch (error) {
      console.error('[PRFlowHandler] Merge failed:', error);
      return false;
    }
  }
}

/** Factory function */
export function createPRFlowHandler(githubClient: GitHubClient): PRFlowHandler {
  return new DefaultPRFlowHandler(githubClient);
}
