/**
 * Unit tests for Event Router
 */

import { describe, it, expect } from 'vitest';
import { DefaultEventRouter, createEventRouter } from './event-router.js';
import type { NormalizedEvent, MessagePayload, ReactionPayload, ThreadPayload, SlashCommandPayload, GitHubWebhookPayload } from '../types/events.js';

describe('EventRouter', () => {
  describe('createEventRouter', () => {
    it('should create a DefaultEventRouter instance', () => {
      const router = createEventRouter();
      expect(router).toBeInstanceOf(DefaultEventRouter);
    });
  });

  describe('route', () => {
    const router = new DefaultEventRouter();

    describe('shouldProcess determination', () => {
      it('should process message events from non-bot users', async () => {
        const event: NormalizedEvent = {
          id: 'evt_123',
          type: 'message',
          guildId: 'guild_1',
          channelId: 'channel_1',
          threadId: 'thread_1',
          userId: 'user_1',
          timestamp: Date.now(),
          payload: { content: 'Hello', authorIsBot: false } as MessagePayload,
        };

        const decision = await router.route(event);
        expect(decision.shouldProcess).toBe(true);
      });

      it('should NOT process message events from bots', async () => {
        const event: NormalizedEvent = {
          id: 'evt_123',
          type: 'message',
          guildId: 'guild_1',
          channelId: 'channel_1',
          userId: 'bot_1',
          timestamp: Date.now(),
          payload: { content: 'Bot message', authorIsBot: true } as MessagePayload,
        };

        const decision = await router.route(event);
        expect(decision.shouldProcess).toBe(false);
      });

      it('should process thread_create events', async () => {
        const event: NormalizedEvent = {
          id: 'evt_123',
          type: 'thread_create',
          guildId: 'guild_1',
          channelId: 'channel_1',
          threadId: 'thread_1',
          userId: 'user_1',
          timestamp: Date.now(),
          payload: { name: 'New Thread', parentChannelId: 'channel_1' } as ThreadPayload,
        };

        const decision = await router.route(event);
        expect(decision.shouldProcess).toBe(true);
      });

      it('should process reaction_add events', async () => {
        const event: NormalizedEvent = {
          id: 'evt_123',
          type: 'reaction_add',
          guildId: 'guild_1',
          channelId: 'channel_1',
          threadId: 'thread_1',
          userId: 'user_1',
          timestamp: Date.now(),
          payload: { emoji: '✅', messageId: 'msg_1' } as ReactionPayload,
        };

        const decision = await router.route(event);
        expect(decision.shouldProcess).toBe(true);
      });

      it('should process slash_command events', async () => {
        const event: NormalizedEvent = {
          id: 'evt_123',
          type: 'slash_command',
          guildId: 'guild_1',
          channelId: 'channel_1',
          userId: 'user_1',
          timestamp: Date.now(),
          payload: { command: 'start' } as SlashCommandPayload,
        };

        const decision = await router.route(event);
        expect(decision.shouldProcess).toBe(true);
      });

      it('should process github_webhook events', async () => {
        const event: NormalizedEvent = {
          id: 'evt_123',
          type: 'github_webhook',
          guildId: 'guild_1',
          channelId: 'channel_1',
          userId: 'github',
          timestamp: Date.now(),
          payload: {
            action: 'opened',
            prNumber: 42,
            prTitle: 'Fix bug',
            prUrl: 'https://github.com/org/repo/pull/42',
            repository: 'org/repo',
            author: 'developer',
          } as GitHubWebhookPayload,
        };

        const decision = await router.route(event);
        expect(decision.shouldProcess).toBe(true);
      });
    });

    describe('contextKeys extraction', () => {
      it('should extract orgId from guildId', async () => {
        const event: NormalizedEvent = {
          id: 'evt_123',
          type: 'message',
          guildId: 'guild_abc',
          channelId: 'channel_xyz',
          userId: 'user_1',
          timestamp: Date.now(),
          payload: { content: 'Test', authorIsBot: false } as MessagePayload,
        };

        const decision = await router.route(event);
        expect(decision.contextKeys.orgId).toBe('guild_abc');
      });

      it('should extract projectId from channelId', async () => {
        const event: NormalizedEvent = {
          id: 'evt_123',
          type: 'message',
          guildId: 'guild_abc',
          channelId: 'channel_xyz',
          userId: 'user_1',
          timestamp: Date.now(),
          payload: { content: 'Test', authorIsBot: false } as MessagePayload,
        };

        const decision = await router.route(event);
        expect(decision.contextKeys.projectId).toBe('channel_xyz');
      });

      it('should extract threadId when present', async () => {
        const event: NormalizedEvent = {
          id: 'evt_123',
          type: 'message',
          guildId: 'guild_abc',
          channelId: 'channel_xyz',
          threadId: 'thread_123',
          userId: 'user_1',
          timestamp: Date.now(),
          payload: { content: 'Test', authorIsBot: false } as MessagePayload,
        };

        const decision = await router.route(event);
        expect(decision.contextKeys.threadId).toBe('thread_123');
      });

      it('should have undefined threadId when not present', async () => {
        const event: NormalizedEvent = {
          id: 'evt_123',
          type: 'slash_command',
          guildId: 'guild_abc',
          channelId: 'channel_xyz',
          userId: 'user_1',
          timestamp: Date.now(),
          payload: { command: 'plan' } as SlashCommandPayload,
        };

        const decision = await router.route(event);
        expect(decision.contextKeys.threadId).toBeUndefined();
      });
    });

    describe('combined behavior', () => {
      it('should return correct decision for processable event with all context', async () => {
        const event: NormalizedEvent = {
          id: 'evt_full',
          type: 'thread_create',
          guildId: 'org_123',
          channelId: 'project_456',
          threadId: 'thread_789',
          userId: 'user_abc',
          timestamp: Date.now(),
          payload: { name: 'Feature: Add login', parentChannelId: 'project_456' } as ThreadPayload,
        };

        const decision = await router.route(event);
        
        expect(decision).toEqual({
          shouldProcess: true,
          contextKeys: {
            orgId: 'org_123',
            projectId: 'project_456',
            threadId: 'thread_789',
          },
        });
      });

      it('should still extract context keys even when shouldProcess is false', async () => {
        const event: NormalizedEvent = {
          id: 'evt_bot',
          type: 'message',
          guildId: 'org_123',
          channelId: 'project_456',
          threadId: 'thread_789',
          userId: 'bot_user',
          timestamp: Date.now(),
          payload: { content: 'Bot response', authorIsBot: true } as MessagePayload,
        };

        const decision = await router.route(event);
        
        expect(decision.shouldProcess).toBe(false);
        expect(decision.contextKeys).toEqual({
          orgId: 'org_123',
          projectId: 'project_456',
          threadId: 'thread_789',
        });
      });
    });
  });
});
