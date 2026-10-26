/**
 * Unit Tests for GitHub Integration
 * Tests for GitHubClient and PR flow
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DefaultGitHubClient, createGitHubClient } from './github-client.js';
import { createPRFlowHandler, parseRepository } from './pr-flow-handler.js';
import type { GitHubClient } from './github-client.js';
import type { NormalizedEvent, GitHubWebhookPayload } from '../types/events.js';
import type { RedisStore, PostgresStore } from '../types/persistence.js';

describe('GitHubClient Unit Tests', () => {
  describe('createGitHubClient', () => {
    it('should create a GitHubClient instance', () => {
      const client = createGitHubClient('test-token');
      expect(client).toBeDefined();
      expect(client.approvePR).toBeDefined();
      expect(client.mergePR).toBeDefined();
      expect(client.createReviewComment).toBeDefined();
      expect(client.getPR).toBeDefined();
    });
  });

  describe('DefaultGitHubClient with mocked fetch', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should call approvePR with correct parameters', async () => {
      const mockResponse = {
        id: 123,
        state: 'APPROVED',
        body: 'Approved by AI DevOS',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      });

      const client = createGitHubClient('test-token');
      const result = await client.approvePR('owner', 'repo', 42, 'LGTM');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/pulls/42/reviews',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );

      expect(result.state).toBe('APPROVED');
    });

    it('should call mergePR with correct parameters', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ merged: true }),
      });

      const client = createGitHubClient('test-token');
      const result = await client.mergePR('owner', 'repo', 42, 'Merge PR #42');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/pulls/42/merge',
        expect.objectContaining({
          method: 'PUT',
        })
      );

      expect(result).toBe(true);
    });

    it('should return false when merge fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 405,
        text: () => Promise.resolve('Method not allowed'),
      });

      const client = createGitHubClient('test-token');
      const result = await client.mergePR('owner', 'repo', 42);

      expect(result).toBe(false);
    });

    it('should call createReviewComment with correct parameters', async () => {
      const mockPR = {
        number: 42,
        title: 'Test PR',
        state: 'open',
        html_url: 'https://github.com/owner/repo/pull/42',
        user: { login: 'testuser' },
        head: { ref: 'feature', sha: 'abc123' },
        base: { ref: 'main' },
      };

      const mockComment = {
        id: 456,
        body: 'Review comment',
        path: 'src/file.ts',
        line: 10,
      };

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPR),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: () => Promise.resolve(mockComment),
        });

      const client = createGitHubClient('test-token');
      const result = await client.createReviewComment(
        'owner',
        'repo',
        42,
        'Review comment',
        'src/file.ts',
        10
      );

      expect(result.body).toBe('Review comment');
      expect(result.path).toBe('src/file.ts');
    });

    it('should call getPR with correct parameters', async () => {
      const mockPR = {
        number: 42,
        title: 'Test PR',
        state: 'open',
        html_url: 'https://github.com/owner/repo/pull/42',
        user: { login: 'testuser' },
        head: { ref: 'feature', sha: 'abc123' },
        base: { ref: 'main' },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPR),
      });

      const client = createGitHubClient('test-token');
      const result = await client.getPR('owner', 'repo', 42);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/pulls/42',
        expect.objectContaining({
          method: 'GET',
        })
      );

      expect(result.number).toBe(42);
      expect(result.title).toBe('Test PR');
    });

    it('should throw error on API failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found'),
      });

      const client = createGitHubClient('test-token');
      
      await expect(client.getPR('owner', 'repo', 999)).rejects.toThrow('GitHub API error');
    });
  });
});

describe('PR Flow Handler Unit Tests', () => {
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

  describe('handleWebhook', () => {
    it('should create thread for opened PR', async () => {
      const handler = createPRFlowHandler(mockGitHubClient);
      
      const event: NormalizedEvent = {
        id: 'event-1',
        type: 'github_webhook',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'webhook-user',
        timestamp: Date.now(),
        payload: {
          action: 'opened',
          prNumber: 123,
          prTitle: 'Add new feature',
          prUrl: 'https://github.com/owner/repo/pull/123',
          repository: 'owner/repo',
          author: 'testuser',
        } as GitHubWebhookPayload,
      };

      const result = await handler.handleWebhook(event, mockRedisStore, mockPostgresStore);

      expect(result.action).toBe('thread_created');
      expect(result.threadId).toContain('pr-123');
      expect(result.message).toContain('Add new feature');
      expect(mockRedisStore.setThreadState).toHaveBeenCalled();
      expect(mockPostgresStore.upsertThread).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          type: 'pr',
          state: 'open',
        })
      );
    });

    it('should ignore closed PR', async () => {
      const handler = createPRFlowHandler(mockGitHubClient);
      
      const event: NormalizedEvent = {
        id: 'event-1',
        type: 'github_webhook',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'webhook-user',
        timestamp: Date.now(),
        payload: {
          action: 'closed',
          prNumber: 123,
          prTitle: 'Add new feature',
          prUrl: 'https://github.com/owner/repo/pull/123',
          repository: 'owner/repo',
          author: 'testuser',
        } as GitHubWebhookPayload,
      };

      const result = await handler.handleWebhook(event, mockRedisStore, mockPostgresStore);

      expect(result.action).toBe('ignored');
    });

    it('should handle synchronize action', async () => {
      const handler = createPRFlowHandler(mockGitHubClient);
      
      const event: NormalizedEvent = {
        id: 'event-1',
        type: 'github_webhook',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'webhook-user',
        timestamp: Date.now(),
        payload: {
          action: 'synchronize',
          prNumber: 123,
          prTitle: 'Add new feature',
          prUrl: 'https://github.com/owner/repo/pull/123',
          repository: 'owner/repo',
          author: 'testuser',
        } as GitHubWebhookPayload,
      };

      const result = await handler.handleWebhook(event, mockRedisStore, mockPostgresStore);

      expect(result.action).toBe('ignored');
      expect(result.message).toContain('synchronized');
    });

    it('should handle review_submitted action', async () => {
      const handler = createPRFlowHandler(mockGitHubClient);
      
      const event: NormalizedEvent = {
        id: 'event-1',
        type: 'github_webhook',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'webhook-user',
        timestamp: Date.now(),
        payload: {
          action: 'review_submitted',
          prNumber: 123,
          prTitle: 'Add new feature',
          prUrl: 'https://github.com/owner/repo/pull/123',
          repository: 'owner/repo',
          author: 'testuser',
        } as GitHubWebhookPayload,
      };

      const result = await handler.handleWebhook(event, mockRedisStore, mockPostgresStore);

      expect(result.action).toBe('review_assigned');
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

      const result = await handler.handleWebhook(event, mockRedisStore, mockPostgresStore);

      expect(result.action).toBe('ignored');
    });
  });

  describe('initiateMerge', () => {
    it('should call GitHubClient.mergePR', async () => {
      const handler = createPRFlowHandler(mockGitHubClient);
      
      const result = await handler.initiateMerge('owner', 'repo', 123);

      expect(mockGitHubClient.mergePR).toHaveBeenCalledWith('owner', 'repo', 123);
      expect(result).toBe(true);
    });

    it('should return false when merge fails', async () => {
      (mockGitHubClient.mergePR as any).mockResolvedValue(false);
      
      const handler = createPRFlowHandler(mockGitHubClient);
      
      const result = await handler.initiateMerge('owner', 'repo', 123);

      expect(result).toBe(false);
    });
  });
});

describe('parseRepository', () => {
  it('should parse valid repository strings', () => {
    expect(parseRepository('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
    expect(parseRepository('my-org/my-repo')).toEqual({ owner: 'my-org', repo: 'my-repo' });
    expect(parseRepository('user123/project456')).toEqual({ owner: 'user123', repo: 'project456' });
  });

  it('should throw for invalid formats', () => {
    expect(() => parseRepository('owner')).toThrow('Invalid repository format');
    expect(() => parseRepository('owner/repo/extra')).toThrow('Invalid repository format');
    expect(() => parseRepository('')).toThrow('Invalid repository format');
  });
});

describe('PR Flow Integration Tests', () => {
  it('should handle complete PR flow: webhook → thread → review → merge', async () => {
    const mockGitHubClient: GitHubClient = {
      approvePR: vi.fn().mockResolvedValue({ id: 1, state: 'APPROVED', body: 'LGTM' }),
      mergePR: vi.fn().mockResolvedValue(true),
      createReviewComment: vi.fn(),
      getPR: vi.fn(),
    };

    const mockRedisStore: RedisStore = {
      getThreadState: vi.fn(),
      setThreadState: vi.fn().mockResolvedValue(undefined),
      getActiveSession: vi.fn(),
      setActiveSession: vi.fn(),
      incrementMessageCount: vi.fn(),
    };

    const mockPostgresStore: PostgresStore = {
      getOrg: vi.fn(),
      upsertOrg: vi.fn(),
      getProject: vi.fn(),
      upsertProject: vi.fn(),
      getThread: vi.fn(),
      upsertThread: vi.fn().mockResolvedValue(undefined),
      storeMemory: vi.fn(),
      getMemories: vi.fn(),
    };

    const handler = createPRFlowHandler(mockGitHubClient);

    // Step 1: Webhook creates thread
    const webhookEvent: NormalizedEvent = {
      id: 'event-1',
      type: 'github_webhook',
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'webhook-user',
      timestamp: Date.now(),
      payload: {
        action: 'opened',
        prNumber: 42,
        prTitle: 'Add authentication',
        prUrl: 'https://github.com/owner/repo/pull/42',
        repository: 'owner/repo',
        author: 'developer',
      } as GitHubWebhookPayload,
    };

    const threadResult = await handler.handleWebhook(
      webhookEvent,
      mockRedisStore,
      mockPostgresStore
    );

    expect(threadResult.action).toBe('thread_created');
    expect(threadResult.threadId).toBeDefined();

    // Step 2: Merge after approval
    const mergeResult = await handler.initiateMerge('owner', 'repo', 42);

    expect(mergeResult).toBe(true);
    expect(mockGitHubClient.mergePR).toHaveBeenCalledWith('owner', 'repo', 42);
  });
});
