/**
 * Property Tests for GitHub Integration
 * Property 11: Webhook de GitHub produce hilo de tipo PR
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { createPRFlowHandler, parseRepository } from './pr-flow-handler.js';
import type { GitHubClient } from './github-client.js';
import type { NormalizedEvent, GitHubWebhookPayload } from '../types/events.js';
import type { RedisStore, PostgresStore } from '../types/persistence.js';

describe('GitHub Integration Property Tests', () => {
  describe('Property 11: Webhook de GitHub produce hilo de tipo PR', () => {
    let mockGitHubClient: GitHubClient;
    let mockRedisStore: RedisStore;
    let mockPostgresStore: PostgresStore;

    beforeEach(() => {
      mockGitHubClient = {
        approvePR: vi.fn(),
        mergePR: vi.fn().mockResolvedValue(true),
        createReviewComment: vi.fn(),
        getPR: vi.fn(),
      };

      mockRedisStore = {
        getThreadState: vi.fn(),
        setThreadState: vi.fn().mockResolvedValue(undefined),
        getActiveSession: vi.fn(),
        setActiveSession: vi.fn(),
        incrementMessageCount: vi.fn(),
      };

      mockPostgresStore = {
        getOrg: vi.fn(),
        upsertOrg: vi.fn(),
        getProject: vi.fn(),
        upsertProject: vi.fn(),
        getThread: vi.fn(),
        upsertThread: vi.fn().mockResolvedValue(undefined),
        storeMemory: vi.fn(),
        getMemories: vi.fn(),
      };
    });

    // Arbitrary for PR numbers
    const prNumberArb = fc.integer({ min: 1, max: 99999 });
    
    // Arbitrary for PR titles
    const prTitleArb = fc.string({ minLength: 1, maxLength: 100 });
    
    // Arbitrary for repository names
    const repoArb = fc.tuple(
      fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-zA-Z0-9-]+$/.test(s)),
      fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-zA-Z0-9-]+$/.test(s))
    ).map(([owner, repo]) => `${owner}/${repo}`);

    // Arbitrary for GitHub usernames
    const usernameArb = fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-zA-Z0-9-]+$/.test(s));

    it('should create PR thread for all valid "opened" webhooks', async () => {
      await fc.assert(
        fc.asyncProperty(
          prNumberArb,
          prTitleArb,
          repoArb,
          usernameArb,
          async (prNumber, prTitle, repository, author) => {
            const handler = createPRFlowHandler(mockGitHubClient);
            
            const event: NormalizedEvent = {
              id: `event-${prNumber}`,
              type: 'github_webhook',
              guildId: 'guild-1',
              channelId: 'channel-1',
              userId: 'webhook-user',
              timestamp: Date.now(),
              payload: {
                action: 'opened',
                prNumber,
                prTitle,
                prUrl: `https://github.com/${repository}/pull/${prNumber}`,
                repository,
                author,
              } as GitHubWebhookPayload,
            };

            const result = await handler.handleWebhook(
              event,
              mockRedisStore,
              mockPostgresStore
            );

            // Should create a thread
            expect(result.action).toBe('thread_created');
            expect(result.threadId).toBeDefined();
            expect(result.threadId).toContain(`pr-${prNumber}`);
            expect(result.message).toContain(prTitle);

            // Should initialize Redis state
            expect(mockRedisStore.setThreadState).toHaveBeenCalled();

            // Should persist to PostgreSQL with type 'pr'
            expect(mockPostgresStore.upsertThread).toHaveBeenCalledWith(
              expect.any(String),
              expect.objectContaining({
                type: 'pr',
                state: 'open',
              })
            );
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should ignore non-opened webhook actions', async () => {
      const nonOpenedActions = ['closed', 'synchronize', 'review_submitted'] as const;

      for (const action of nonOpenedActions) {
        const handler = createPRFlowHandler(mockGitHubClient);
        
        const event: NormalizedEvent = {
          id: 'event-1',
          type: 'github_webhook',
          guildId: 'guild-1',
          channelId: 'channel-1',
          userId: 'webhook-user',
          timestamp: Date.now(),
          payload: {
            action,
            prNumber: 123,
            prTitle: 'Test PR',
            prUrl: 'https://github.com/owner/repo/pull/123',
            repository: 'owner/repo',
            author: 'testuser',
          } as GitHubWebhookPayload,
        };

        const result = await handler.handleWebhook(
          event,
          mockRedisStore,
          mockPostgresStore
        );

        expect(result.action).not.toBe('thread_created');
      }
    });

    it('should ignore non-github_webhook events', async () => {
      const handler = createPRFlowHandler(mockGitHubClient);
      
      const event: NormalizedEvent = {
        id: 'event-1',
        type: 'message',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
        timestamp: Date.now(),
        payload: {
          content: 'Hello',
          authorIsBot: false,
        },
      };

      const result = await handler.handleWebhook(
        event,
        mockRedisStore,
        mockPostgresStore
      );

      expect(result.action).toBe('ignored');
    });
  });

  describe('Repository Parsing', () => {
    it('should correctly parse valid repository strings', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-zA-Z0-9-]+$/.test(s)),
          fc.string({ minLength: 1, maxLength: 30 }).filter(s => /^[a-zA-Z0-9-]+$/.test(s)),
          (owner, repo) => {
            const result = parseRepository(`${owner}/${repo}`);
            
            expect(result.owner).toBe(owner);
            expect(result.repo).toBe(repo);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should throw for invalid repository formats', () => {
      const invalidFormats = ['owner', 'owner/repo/extra', '', '/repo', 'owner/'];
      
      for (const format of invalidFormats) {
        expect(() => parseRepository(format)).toThrow();
      }
    });
  });
});
