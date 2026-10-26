/**
 * GitHub Webhook Handler
 * 
 * Receives GitHub webhook payloads and normalizes them to NormalizedEvent format.
 * Implements retry with exponential backoff for processing failures.
 * 
 * Supports PR events: opened, closed, synchronize, review_submitted
 */

import { constants } from '../config/index.js';
import type { NormalizedEvent, GitHubWebhookPayload } from '../types/events.js';

/**
 * Raw GitHub webhook payload for Pull Request events
 */
export interface GitHubPullRequestWebhook {
  action: string;
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    user: {
      login: string;
    };
  };
  repository: {
    full_name: string;
  };
  sender: {
    id: number;
    login: string;
  };
}

/**
 * Raw GitHub webhook payload for Pull Request Review events
 */
export interface GitHubPullRequestReviewWebhook {
  action: string;
  review: {
    state: string;
    user: {
      login: string;
    };
  };
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    user: {
      login: string;
    };
  };
  repository: {
    full_name: string;
  };
  sender: {
    id: number;
    login: string;
  };
}

/**
 * Union type for supported GitHub webhook payloads
 */
export type GitHubWebhook = GitHubPullRequestWebhook | GitHubPullRequestReviewWebhook;

/**
 * Supported GitHub webhook actions
 */
const SUPPORTED_ACTIONS = ['opened', 'closed', 'synchronize', 'review_submitted'] as const;
type SupportedAction = typeof SUPPORTED_ACTIONS[number];

/**
 * Generates a unique event ID for GitHub webhooks
 */
function generateEventId(): string {
  return `evt_gh_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Checks if the action is a supported PR action
 */
function isSupportedAction(action: string): action is SupportedAction {
  return SUPPORTED_ACTIONS.includes(action as SupportedAction);
}

/**
 * Type guard for Pull Request Review webhook
 */
function isPullRequestReviewWebhook(
  webhook: GitHubWebhook
): webhook is GitHubPullRequestReviewWebhook {
  return 'review' in webhook;
}

/**
 * Maps GitHub webhook action to normalized action
 * For review webhooks with 'submitted' action, maps to 'review_submitted'
 */
function mapAction(webhook: GitHubWebhook): SupportedAction | null {
  if (isPullRequestReviewWebhook(webhook)) {
    if (webhook.action === 'submitted') {
      return 'review_submitted';
    }
    return null;
  }
  
  if (isSupportedAction(webhook.action)) {
    return webhook.action;
  }
  
  return null;
}

/**
 * Normalizes a GitHub webhook payload to NormalizedEvent
 * 
 * @param webhook - Raw GitHub webhook payload
 * @param guildId - Discord guild ID to associate with the event
 * @param channelId - Discord channel ID to associate with the event
 * @returns NormalizedEvent or null if webhook is not supported
 */
export function normalizeGitHubWebhook(
  webhook: GitHubWebhook,
  guildId: string,
  channelId: string
): NormalizedEvent | null {
  const action = mapAction(webhook);
  
  if (!action) {
    return null;
  }

  const pullRequest = webhook.pull_request;
  const repository = webhook.repository;

  const payload: GitHubWebhookPayload = {
    action,
    prNumber: pullRequest.number,
    prTitle: pullRequest.title,
    prUrl: pullRequest.html_url,
    repository: repository.full_name,
    author: pullRequest.user.login,
  };

  return {
    id: generateEventId(),
    type: 'github_webhook',
    guildId,
    channelId,
    userId: `github_${webhook.sender.id}`,
    timestamp: Date.now(),
    payload,
  };
}

/**
 * Result of webhook processing
 */
export interface WebhookProcessResult {
  success: boolean;
  event?: NormalizedEvent;
  error?: string;
  attempts: number;
}

/**
 * Callback type for processing normalized events
 */
export type WebhookEventProcessor = (event: NormalizedEvent) => Promise<void>;

/**
 * Calculates delay for retry attempt using exponential backoff
 * Pattern: 1s, 2s, 4s (for attempts 0, 1, 2)
 * 
 * @param attempt - Current attempt number (0-indexed)
 * @returns Delay in milliseconds
 */
export function calculateRetryDelay(attempt: number): number {
  const baseDelay = constants.WEBHOOK_RETRY_INITIAL_DELAY;
  const multiplier = constants.WEBHOOK_RETRY_BACKOFF_MULTIPLIER;
  
  return baseDelay * Math.pow(multiplier, attempt);
}

/**
 * Delays execution for the specified duration
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Processes a GitHub webhook with retry logic
 * 
 * Implements retry up to MAX_RETRY_ATTEMPTS (3) times with exponential backoff.
 * Delays: 1s, 2s, 4s between attempts.
 * 
 * @param webhook - Raw GitHub webhook payload
 * @param guildId - Discord guild ID
 * @param channelId - Discord channel ID
 * @param processor - Callback to process the normalized event
 * @returns Processing result with success status and attempt count
 */
export async function processGitHubWebhook(
  webhook: GitHubWebhook,
  guildId: string,
  channelId: string,
  processor: WebhookEventProcessor
): Promise<WebhookProcessResult> {
  const event = normalizeGitHubWebhook(webhook, guildId, channelId);
  
  if (!event) {
    return {
      success: false,
      error: 'Unsupported webhook action',
      attempts: 0,
    };
  }

  const maxAttempts = constants.MAX_RETRY_ATTEMPTS;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await processor(event);
      return {
        success: true,
        event,
        attempts: attempt + 1,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[GitHubWebhook] Processing failed (attempt ${attempt + 1}/${maxAttempts}):`,
        lastError.message
      );

      // Don't delay after the last attempt
      if (attempt < maxAttempts - 1) {
        const retryDelay = calculateRetryDelay(attempt);
        console.log(`[GitHubWebhook] Retrying in ${retryDelay}ms...`);
        await delay(retryDelay);
      }
    }
  }

  return {
    success: false,
    event,
    error: lastError?.message ?? 'Unknown error',
    attempts: maxAttempts,
  };
}

/**
 * GitHub Webhook Handler class for managing webhook processing
 */
export class GitHubWebhookHandler {
  private processor: WebhookEventProcessor | null = null;

  /**
   * Sets the event processor callback
   */
  onEvent(processor: WebhookEventProcessor): void {
    this.processor = processor;
  }

  /**
   * Handles an incoming GitHub webhook
   * 
   * @param webhook - Raw GitHub webhook payload
   * @param guildId - Discord guild ID to associate with the event
   * @param channelId - Discord channel ID to associate with the event
   * @returns Processing result
   */
  async handleWebhook(
    webhook: GitHubWebhook,
    guildId: string,
    channelId: string
  ): Promise<WebhookProcessResult> {
    if (!this.processor) {
      return {
        success: false,
        error: 'No event processor configured',
        attempts: 0,
      };
    }

    return processGitHubWebhook(webhook, guildId, channelId, this.processor);
  }
}
