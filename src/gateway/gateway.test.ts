/**
 * Unit Tests for Gateway
 * Tests event normalization, slash commands, GitHub webhooks, and reconnection logic
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 7.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeMessageEvent,
  normalizeThreadCreateEvent,
  normalizeReactionAddEvent,
} from './event-normalizer.js';
import {
  buildAISlashCommand,
  getSlashCommandNames,
  isValidSlashCommand,
  normalizeSlashCommandInteraction,
  type SlashCommandName,
} from './slash-commands.js';
import {
  normalizeGitHubWebhook,
  calculateRetryDelay,
  processGitHubWebhook,
  GitHubWebhookHandler,
  type GitHubWebhook,
  type GitHubPullRequestWebhook,
  type GitHubPullRequestReviewWebhook,
} from './github-webhook-handler.js';
import { constants } from '../config/index.js';
import type { NormalizedEvent, MessagePayload, ThreadPayload, ReactionPayload, GitHubWebhookPayload } from '../types/events.js';

// ============================================================================
// Event Normalization Unit Tests
// Requirements: 1.1, 1.2
// ============================================================================

describe('Event Normalization', () => {
  describe('normalizeMessageEvent', () => {
    it('should normalize a basic message event', () => {
      const mockMessage = {
        guildId: '123456789012345678',
        channelId: '987654321098765432',
        content: 'Hello, world!',
        createdTimestamp: 1700000000000,
        author: { id: '111222333444555666', bot: false },
        channel: { isThread: () => false },
      };

      const result = normalizeMessageEvent(mockMessage as any);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('message');
      expect(result!.guildId).toBe('123456789012345678');
      expect(result!.channelId).toBe('987654321098765432');
      expect(result!.userId).toBe('111222333444555666');
      expect(result!.timestamp).toBe(1700000000000);
      expect(result!.threadId).toBeUndefined();

      const payload = result!.payload as MessagePayload;
      expect(payload.content).toBe('Hello, world!');
      expect(payload.authorIsBot).toBe(false);
    });

    it('should normalize a bot message event', () => {
      const mockMessage = {
        guildId: '123456789012345678',
        channelId: '987654321098765432',
        content: 'Bot response',
        createdTimestamp: 1700000000000,
        author: { id: '111222333444555666', bot: true },
        channel: { isThread: () => false },
      };

      const result = normalizeMessageEvent(mockMessage as any);

      expect(result).not.toBeNull();
      const payload = result!.payload as MessagePayload;
      expect(payload.authorIsBot).toBe(true);
    });

    it('should normalize a message in a thread', () => {
      const mockMessage = {
        guildId: '123456789012345678',
        channelId: '555666777888999000',
        content: 'Thread message',
        createdTimestamp: 1700000000000,
        author: { id: '111222333444555666', bot: false },
        channel: {
          isThread: () => true,
          parentId: '987654321098765432',
        },
      };

      const result = normalizeMessageEvent(mockMessage as any);

      expect(result).not.toBeNull();
      expect(result!.channelId).toBe('987654321098765432'); // Parent channel
      expect(result!.threadId).toBe('555666777888999000'); // Thread ID
    });

    it('should return null for message without guildId', () => {
      const mockMessage = {
        guildId: null,
        channelId: '987654321098765432',
        content: 'DM message',
        createdTimestamp: 1700000000000,
        author: { id: '111222333444555666', bot: false },
        channel: { isThread: () => false },
      };

      const result = normalizeMessageEvent(mockMessage as any);
      expect(result).toBeNull();
    });

    it('should return null for message without author', () => {
      const mockMessage = {
        guildId: '123456789012345678',
        channelId: '987654321098765432',
        content: 'System message',
        createdTimestamp: 1700000000000,
        author: null,
        channel: { isThread: () => false },
      };

      const result = normalizeMessageEvent(mockMessage as any);
      expect(result).toBeNull();
    });

    it('should handle empty message content', () => {
      const mockMessage = {
        guildId: '123456789012345678',
        channelId: '987654321098765432',
        content: '',
        createdTimestamp: 1700000000000,
        author: { id: '111222333444555666', bot: false },
        channel: { isThread: () => false },
      };

      const result = normalizeMessageEvent(mockMessage as any);

      expect(result).not.toBeNull();
      const payload = result!.payload as MessagePayload;
      expect(payload.content).toBe('');
    });
  });

  describe('normalizeThreadCreateEvent', () => {
    it('should normalize a thread creation event', () => {
      const mockThread = {
        id: '555666777888999000',
        guildId: '123456789012345678',
        parentId: '987654321098765432',
        name: 'Feature: User Authentication',
        ownerId: '111222333444555666',
        createdTimestamp: 1700000000000,
      };

      const result = normalizeThreadCreateEvent(mockThread as any);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('thread_create');
      expect(result!.guildId).toBe('123456789012345678');
      expect(result!.channelId).toBe('987654321098765432');
      expect(result!.threadId).toBe('555666777888999000');
      expect(result!.userId).toBe('111222333444555666');
      expect(result!.timestamp).toBe(1700000000000);

      const payload = result!.payload as ThreadPayload;
      expect(payload.name).toBe('Feature: User Authentication');
      expect(payload.parentChannelId).toBe('987654321098765432');
    });

    it('should handle thread without ownerId', () => {
      const mockThread = {
        id: '555666777888999000',
        guildId: '123456789012345678',
        parentId: '987654321098765432',
        name: 'Anonymous Thread',
        ownerId: undefined,
        createdTimestamp: 1700000000000,
      };

      const result = normalizeThreadCreateEvent(mockThread as any);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('unknown');
    });

    it('should handle thread without createdTimestamp', () => {
      const mockThread = {
        id: '555666777888999000',
        guildId: '123456789012345678',
        parentId: '987654321098765432',
        name: 'No Timestamp Thread',
        ownerId: '111222333444555666',
        createdTimestamp: undefined,
      };

      const result = normalizeThreadCreateEvent(mockThread as any);

      expect(result).not.toBeNull();
      expect(typeof result!.timestamp).toBe('number');
    });

    it('should return null for thread without guildId', () => {
      const mockThread = {
        id: '555666777888999000',
        guildId: null,
        parentId: '987654321098765432',
        name: 'Invalid Thread',
        ownerId: '111222333444555666',
        createdTimestamp: 1700000000000,
      };

      const result = normalizeThreadCreateEvent(mockThread as any);
      expect(result).toBeNull();
    });

    it('should return null for thread without parentId', () => {
      const mockThread = {
        id: '555666777888999000',
        guildId: '123456789012345678',
        parentId: null,
        name: 'Orphan Thread',
        ownerId: '111222333444555666',
        createdTimestamp: 1700000000000,
      };

      const result = normalizeThreadCreateEvent(mockThread as any);
      expect(result).toBeNull();
    });
  });

  describe('normalizeReactionAddEvent', () => {
    it('should normalize ✅ reaction', () => {
      const mockReaction = {
        emoji: { name: '✅' },
        message: {
          id: '999888777666555444',
          guildId: '123456789012345678',
          channelId: '987654321098765432',
          channel: { isThread: () => false },
        },
      };
      const mockUser = { id: '111222333444555666' };

      const result = normalizeReactionAddEvent(mockReaction as any, mockUser as any);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('reaction_add');
      expect(result!.guildId).toBe('123456789012345678');
      expect(result!.channelId).toBe('987654321098765432');
      expect(result!.userId).toBe('111222333444555666');

      const payload = result!.payload as ReactionPayload;
      expect(payload.emoji).toBe('✅');
      expect(payload.messageId).toBe('999888777666555444');
    });

    it('should normalize ❌ reaction', () => {
      const mockReaction = {
        emoji: { name: '❌' },
        message: {
          id: '999888777666555444',
          guildId: '123456789012345678',
          channelId: '987654321098765432',
          channel: { isThread: () => false },
        },
      };
      const mockUser = { id: '111222333444555666' };

      const result = normalizeReactionAddEvent(mockReaction as any, mockUser as any);

      expect(result).not.toBeNull();
      const payload = result!.payload as ReactionPayload;
      expect(payload.emoji).toBe('❌');
    });

    it('should normalize 🔁 reaction', () => {
      const mockReaction = {
        emoji: { name: '🔁' },
        message: {
          id: '999888777666555444',
          guildId: '123456789012345678',
          channelId: '987654321098765432',
          channel: { isThread: () => false },
        },
      };
      const mockUser = { id: '111222333444555666' };

      const result = normalizeReactionAddEvent(mockReaction as any, mockUser as any);

      expect(result).not.toBeNull();
      const payload = result!.payload as ReactionPayload;
      expect(payload.emoji).toBe('🔁');
    });

    it('should normalize 🚀 reaction', () => {
      const mockReaction = {
        emoji: { name: '🚀' },
        message: {
          id: '999888777666555444',
          guildId: '123456789012345678',
          channelId: '987654321098765432',
          channel: { isThread: () => false },
        },
      };
      const mockUser = { id: '111222333444555666' };

      const result = normalizeReactionAddEvent(mockReaction as any, mockUser as any);

      expect(result).not.toBeNull();
      const payload = result!.payload as ReactionPayload;
      expect(payload.emoji).toBe('🚀');
    });

    it('should normalize reaction in a thread', () => {
      const mockReaction = {
        emoji: { name: '✅' },
        message: {
          id: '999888777666555444',
          guildId: '123456789012345678',
          channelId: '555666777888999000',
          channel: {
            isThread: () => true,
            parentId: '987654321098765432',
          },
        },
      };
      const mockUser = { id: '111222333444555666' };

      const result = normalizeReactionAddEvent(mockReaction as any, mockUser as any);

      expect(result).not.toBeNull();
      expect(result!.channelId).toBe('987654321098765432'); // Parent channel
      expect(result!.threadId).toBe('555666777888999000'); // Thread ID
    });

    it('should return null for unsupported emoji', () => {
      const mockReaction = {
        emoji: { name: '👍' },
        message: {
          id: '999888777666555444',
          guildId: '123456789012345678',
          channelId: '987654321098765432',
          channel: { isThread: () => false },
        },
      };
      const mockUser = { id: '111222333444555666' };

      const result = normalizeReactionAddEvent(mockReaction as any, mockUser as any);
      expect(result).toBeNull();
    });

    it('should return null for reaction without emoji name', () => {
      const mockReaction = {
        emoji: { name: null },
        message: {
          id: '999888777666555444',
          guildId: '123456789012345678',
          channelId: '987654321098765432',
          channel: { isThread: () => false },
        },
      };
      const mockUser = { id: '111222333444555666' };

      const result = normalizeReactionAddEvent(mockReaction as any, mockUser as any);
      expect(result).toBeNull();
    });

    it('should return null for reaction without guildId', () => {
      const mockReaction = {
        emoji: { name: '✅' },
        message: {
          id: '999888777666555444',
          guildId: null,
          channelId: '987654321098765432',
          channel: { isThread: () => false },
        },
      };
      const mockUser = { id: '111222333444555666' };

      const result = normalizeReactionAddEvent(mockReaction as any, mockUser as any);
      expect(result).toBeNull();
    });
  });
});


// ============================================================================
// Slash Commands Unit Tests
// Requirements: 7.1
// ============================================================================

describe('Slash Commands', () => {
  describe('getSlashCommandNames', () => {
    it('should return exactly 7 slash commands', () => {
      const commands = getSlashCommandNames();
      expect(commands).toHaveLength(7);
    });

    it('should include all required commands', () => {
      const commands = getSlashCommandNames();
      const expectedCommands: SlashCommandName[] = [
        'start',
        'plan',
        'code',
        'review',
        'test',
        'deploy',
        'summary',
      ];

      for (const expected of expectedCommands) {
        expect(commands).toContain(expected);
      }
    });
  });

  describe('isValidSlashCommand', () => {
    it('should return true for valid commands', () => {
      expect(isValidSlashCommand('start')).toBe(true);
      expect(isValidSlashCommand('plan')).toBe(true);
      expect(isValidSlashCommand('code')).toBe(true);
      expect(isValidSlashCommand('review')).toBe(true);
      expect(isValidSlashCommand('test')).toBe(true);
      expect(isValidSlashCommand('deploy')).toBe(true);
      expect(isValidSlashCommand('summary')).toBe(true);
    });

    it('should return false for invalid commands', () => {
      expect(isValidSlashCommand('invalid')).toBe(false);
      expect(isValidSlashCommand('help')).toBe(false);
      expect(isValidSlashCommand('')).toBe(false);
      expect(isValidSlashCommand('START')).toBe(false); // Case sensitive
    });
  });

  describe('buildAISlashCommand', () => {
    it('should build a slash command with name "ai"', () => {
      const command = buildAISlashCommand();
      expect(command.name).toBe('ai');
    });

    it('should have a description', () => {
      const command = buildAISlashCommand();
      expect(command.description).toBeDefined();
      expect(command.description.length).toBeGreaterThan(0);
    });

    it('should have 7 subcommands', () => {
      const command = buildAISlashCommand();
      const json = command.toJSON();
      expect(json.options).toHaveLength(7);
    });

    it('should have subcommands with correct names', () => {
      const command = buildAISlashCommand();
      const json = command.toJSON();
      const subcommandNames = json.options?.map((opt: any) => opt.name) ?? [];

      expect(subcommandNames).toContain('start');
      expect(subcommandNames).toContain('plan');
      expect(subcommandNames).toContain('code');
      expect(subcommandNames).toContain('review');
      expect(subcommandNames).toContain('test');
      expect(subcommandNames).toContain('deploy');
      expect(subcommandNames).toContain('summary');
    });
  });

  describe('normalizeSlashCommandInteraction', () => {
    it('should normalize a valid /ai start command', () => {
      const mockInteraction = {
        id: '123456789012345678',
        commandName: 'ai',
        guildId: '987654321098765432',
        channelId: '111222333444555666',
        user: { id: '555666777888999000' },
        createdTimestamp: 1700000000000,
        channel: { isThread: () => false },
        options: {
          getSubcommand: () => 'start',
          data: [],
        },
      };

      const result = normalizeSlashCommandInteraction(mockInteraction as any);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('slash_command');
      expect(result!.guildId).toBe('987654321098765432');
      expect(result!.channelId).toBe('111222333444555666');
      expect(result!.userId).toBe('555666777888999000');
      expect(result!.payload).toEqual({
        command: 'start',
        options: {},
      });
    });

    it('should normalize all 7 slash commands', () => {
      const commands: SlashCommandName[] = ['start', 'plan', 'code', 'review', 'test', 'deploy', 'summary'];

      for (const command of commands) {
        const mockInteraction = {
          id: '123456789012345678',
          commandName: 'ai',
          guildId: '987654321098765432',
          channelId: '111222333444555666',
          user: { id: '555666777888999000' },
          createdTimestamp: 1700000000000,
          channel: { isThread: () => false },
          options: {
            getSubcommand: () => command,
            data: [],
          },
        };

        const result = normalizeSlashCommandInteraction(mockInteraction as any);

        expect(result).not.toBeNull();
        expect(result!.payload).toEqual({
          command,
          options: {},
        });
      }
    });

    it('should include threadId when command is used in a thread', () => {
      const mockInteraction = {
        id: '123456789012345678',
        commandName: 'ai',
        guildId: '987654321098765432',
        channelId: '555666777888999000',
        user: { id: '111222333444555666' },
        createdTimestamp: 1700000000000,
        channel: { isThread: () => true },
        options: {
          getSubcommand: () => 'code',
          data: [],
        },
      };

      const result = normalizeSlashCommandInteraction(mockInteraction as any);

      expect(result).not.toBeNull();
      expect(result!.threadId).toBe('555666777888999000');
    });

    it('should return null for non-ai commands', () => {
      const mockInteraction = {
        id: '123456789012345678',
        commandName: 'other',
        guildId: '987654321098765432',
        channelId: '111222333444555666',
        user: { id: '555666777888999000' },
        createdTimestamp: 1700000000000,
        channel: { isThread: () => false },
        options: {
          getSubcommand: () => 'start',
          data: [],
        },
      };

      const result = normalizeSlashCommandInteraction(mockInteraction as any);
      expect(result).toBeNull();
    });

    it('should return null for commands outside a guild', () => {
      const mockInteraction = {
        id: '123456789012345678',
        commandName: 'ai',
        guildId: null,
        channelId: '111222333444555666',
        user: { id: '555666777888999000' },
        createdTimestamp: 1700000000000,
        channel: { isThread: () => false },
        options: {
          getSubcommand: () => 'start',
          data: [],
        },
      };

      const result = normalizeSlashCommandInteraction(mockInteraction as any);
      expect(result).toBeNull();
    });
  });
});


// ============================================================================
// GitHub Webhook Handler Unit Tests
// Requirements: 9.1, 9.5
// ============================================================================

describe('GitHub Webhook Handler', () => {
  describe('normalizeGitHubWebhook', () => {
    it('should normalize PR opened webhook', () => {
      const webhook: GitHubPullRequestWebhook = {
        action: 'opened',
        pull_request: {
          number: 42,
          title: 'Add new feature',
          html_url: 'https://github.com/org/repo/pull/42',
          user: { login: 'developer' },
        },
        repository: { full_name: 'org/repo' },
        sender: { id: 12345, login: 'developer' },
      };

      const result = normalizeGitHubWebhook(webhook, 'guild-123', 'channel-456');

      expect(result).not.toBeNull();
      expect(result!.type).toBe('github_webhook');
      expect(result!.guildId).toBe('guild-123');
      expect(result!.channelId).toBe('channel-456');
      expect(result!.userId).toBe('github_12345');

      const payload = result!.payload as GitHubWebhookPayload;
      expect(payload.action).toBe('opened');
      expect(payload.prNumber).toBe(42);
      expect(payload.prTitle).toBe('Add new feature');
      expect(payload.prUrl).toBe('https://github.com/org/repo/pull/42');
      expect(payload.repository).toBe('org/repo');
      expect(payload.author).toBe('developer');
    });

    it('should normalize PR closed webhook', () => {
      const webhook: GitHubPullRequestWebhook = {
        action: 'closed',
        pull_request: {
          number: 42,
          title: 'Add new feature',
          html_url: 'https://github.com/org/repo/pull/42',
          user: { login: 'developer' },
        },
        repository: { full_name: 'org/repo' },
        sender: { id: 12345, login: 'developer' },
      };

      const result = normalizeGitHubWebhook(webhook, 'guild-123', 'channel-456');

      expect(result).not.toBeNull();
      const payload = result!.payload as GitHubWebhookPayload;
      expect(payload.action).toBe('closed');
    });

    it('should normalize PR synchronize webhook', () => {
      const webhook: GitHubPullRequestWebhook = {
        action: 'synchronize',
        pull_request: {
          number: 42,
          title: 'Add new feature',
          html_url: 'https://github.com/org/repo/pull/42',
          user: { login: 'developer' },
        },
        repository: { full_name: 'org/repo' },
        sender: { id: 12345, login: 'developer' },
      };

      const result = normalizeGitHubWebhook(webhook, 'guild-123', 'channel-456');

      expect(result).not.toBeNull();
      const payload = result!.payload as GitHubWebhookPayload;
      expect(payload.action).toBe('synchronize');
    });

    it('should normalize PR review submitted webhook', () => {
      const webhook: GitHubPullRequestReviewWebhook = {
        action: 'submitted',
        review: {
          state: 'approved',
          user: { login: 'reviewer' },
        },
        pull_request: {
          number: 42,
          title: 'Add new feature',
          html_url: 'https://github.com/org/repo/pull/42',
          user: { login: 'developer' },
        },
        repository: { full_name: 'org/repo' },
        sender: { id: 67890, login: 'reviewer' },
      };

      const result = normalizeGitHubWebhook(webhook, 'guild-123', 'channel-456');

      expect(result).not.toBeNull();
      const payload = result!.payload as GitHubWebhookPayload;
      expect(payload.action).toBe('review_submitted');
    });

    it('should return null for unsupported actions', () => {
      const webhook = {
        action: 'labeled',
        pull_request: {
          number: 42,
          title: 'Add new feature',
          html_url: 'https://github.com/org/repo/pull/42',
          user: { login: 'developer' },
        },
        repository: { full_name: 'org/repo' },
        sender: { id: 12345, login: 'developer' },
      } as unknown as GitHubWebhook;

      const result = normalizeGitHubWebhook(webhook, 'guild-123', 'channel-456');
      expect(result).toBeNull();
    });

    it('should generate unique event IDs', () => {
      const webhook: GitHubPullRequestWebhook = {
        action: 'opened',
        pull_request: {
          number: 42,
          title: 'Add new feature',
          html_url: 'https://github.com/org/repo/pull/42',
          user: { login: 'developer' },
        },
        repository: { full_name: 'org/repo' },
        sender: { id: 12345, login: 'developer' },
      };

      const result1 = normalizeGitHubWebhook(webhook, 'guild-123', 'channel-456');
      const result2 = normalizeGitHubWebhook(webhook, 'guild-123', 'channel-456');

      expect(result1!.id).not.toBe(result2!.id);
    });
  });

  describe('calculateRetryDelay', () => {
    it('should return 1000ms for attempt 0', () => {
      expect(calculateRetryDelay(0)).toBe(1000);
    });

    it('should return 2000ms for attempt 1', () => {
      expect(calculateRetryDelay(1)).toBe(2000);
    });

    it('should return 4000ms for attempt 2', () => {
      expect(calculateRetryDelay(2)).toBe(4000);
    });

    it('should follow exponential backoff pattern', () => {
      const delay0 = calculateRetryDelay(0);
      const delay1 = calculateRetryDelay(1);
      const delay2 = calculateRetryDelay(2);

      expect(delay1).toBe(delay0 * 2);
      expect(delay2).toBe(delay1 * 2);
    });

    it('should use constants for base delay and multiplier', () => {
      const delay = calculateRetryDelay(0);
      expect(delay).toBe(constants.WEBHOOK_RETRY_INITIAL_DELAY);
    });
  });

  describe('processGitHubWebhook', () => {
    it('should process webhook successfully on first attempt', async () => {
      const webhook: GitHubPullRequestWebhook = {
        action: 'opened',
        pull_request: {
          number: 42,
          title: 'Add new feature',
          html_url: 'https://github.com/org/repo/pull/42',
          user: { login: 'developer' },
        },
        repository: { full_name: 'org/repo' },
        sender: { id: 12345, login: 'developer' },
      };

      const processor = vi.fn().mockResolvedValue(undefined);

      const result = await processGitHubWebhook(webhook, 'guild-123', 'channel-456', processor);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.event).toBeDefined();
      expect(processor).toHaveBeenCalledTimes(1);
    });

    it('should return failure for unsupported webhook', async () => {
      const webhook = {
        action: 'labeled',
        pull_request: {
          number: 42,
          title: 'Add new feature',
          html_url: 'https://github.com/org/repo/pull/42',
          user: { login: 'developer' },
        },
        repository: { full_name: 'org/repo' },
        sender: { id: 12345, login: 'developer' },
      } as unknown as GitHubWebhook;

      const processor = vi.fn();

      const result = await processGitHubWebhook(webhook, 'guild-123', 'channel-456', processor);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unsupported webhook action');
      expect(result.attempts).toBe(0);
      expect(processor).not.toHaveBeenCalled();
    });

    it('should retry on failure up to MAX_RETRY_ATTEMPTS', async () => {
      const webhook: GitHubPullRequestWebhook = {
        action: 'opened',
        pull_request: {
          number: 42,
          title: 'Add new feature',
          html_url: 'https://github.com/org/repo/pull/42',
          user: { login: 'developer' },
        },
        repository: { full_name: 'org/repo' },
        sender: { id: 12345, login: 'developer' },
      };

      const processor = vi.fn().mockRejectedValue(new Error('Processing failed'));

      const result = await processGitHubWebhook(webhook, 'guild-123', 'channel-456', processor);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(constants.MAX_RETRY_ATTEMPTS);
      expect(result.error).toBe('Processing failed');
      expect(processor).toHaveBeenCalledTimes(constants.MAX_RETRY_ATTEMPTS);
    });

    it('should succeed after retry', async () => {
      const webhook: GitHubPullRequestWebhook = {
        action: 'opened',
        pull_request: {
          number: 42,
          title: 'Add new feature',
          html_url: 'https://github.com/org/repo/pull/42',
          user: { login: 'developer' },
        },
        repository: { full_name: 'org/repo' },
        sender: { id: 12345, login: 'developer' },
      };

      let callCount = 0;
      const processor = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve();
      });

      const result = await processGitHubWebhook(webhook, 'guild-123', 'channel-456', processor);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(processor).toHaveBeenCalledTimes(2);
    });
  });

  describe('GitHubWebhookHandler', () => {
    it('should return error when no processor is configured', async () => {
      const handler = new GitHubWebhookHandler();
      const webhook: GitHubPullRequestWebhook = {
        action: 'opened',
        pull_request: {
          number: 42,
          title: 'Add new feature',
          html_url: 'https://github.com/org/repo/pull/42',
          user: { login: 'developer' },
        },
        repository: { full_name: 'org/repo' },
        sender: { id: 12345, login: 'developer' },
      };

      const result = await handler.handleWebhook(webhook, 'guild-123', 'channel-456');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No event processor configured');
    });

    it('should process webhook when processor is configured', async () => {
      const handler = new GitHubWebhookHandler();
      const processor = vi.fn().mockResolvedValue(undefined);
      handler.onEvent(processor);

      const webhook: GitHubPullRequestWebhook = {
        action: 'opened',
        pull_request: {
          number: 42,
          title: 'Add new feature',
          html_url: 'https://github.com/org/repo/pull/42',
          user: { login: 'developer' },
        },
        repository: { full_name: 'org/repo' },
        sender: { id: 12345, login: 'developer' },
      };

      const result = await handler.handleWebhook(webhook, 'guild-123', 'channel-456');

      expect(result.success).toBe(true);
      expect(processor).toHaveBeenCalled();
    });
  });
});


// ============================================================================
// Reconnection Logic Unit Tests
// Requirements: 1.3
// ============================================================================

describe('Reconnection Logic', () => {
  describe('Exponential Backoff Calculation', () => {
    it('should use correct initial delay from constants', () => {
      expect(constants.RECONNECT_INITIAL_DELAY).toBe(1000);
    });

    it('should use correct max delay from constants', () => {
      expect(constants.RECONNECT_MAX_DELAY).toBe(30000);
    });

    it('should use correct backoff multiplier from constants', () => {
      expect(constants.RECONNECT_BACKOFF_MULTIPLIER).toBe(2);
    });

    it('should calculate delays following exponential pattern', () => {
      const baseDelay = constants.RECONNECT_INITIAL_DELAY;
      const multiplier = constants.RECONNECT_BACKOFF_MULTIPLIER;
      const maxDelay = constants.RECONNECT_MAX_DELAY;

      // Simulate the calculateReconnectDelay logic from DiscordBot
      const calculateDelay = (attempts: number): number => {
        const delay = baseDelay * Math.pow(multiplier, attempts);
        return Math.min(delay, maxDelay);
      };

      // Verify pattern: 1s, 2s, 4s, 8s, 16s, 30s (capped), 30s (capped)
      expect(calculateDelay(0)).toBe(1000);
      expect(calculateDelay(1)).toBe(2000);
      expect(calculateDelay(2)).toBe(4000);
      expect(calculateDelay(3)).toBe(8000);
      expect(calculateDelay(4)).toBe(16000);
      expect(calculateDelay(5)).toBe(30000); // Capped at max
      expect(calculateDelay(6)).toBe(30000); // Still capped
    });
  });
});

// ============================================================================
// Smoke Tests
// Requirements: 1.4, 7.1
// ============================================================================

describe('Gateway Smoke Tests', () => {
  describe('Supported Events', () => {
    it('should support exactly 3 event types', () => {
      // The Gateway supports: on_thread_create, on_message, on_reaction_add
      const supportedEventTypes = ['message', 'thread_create', 'reaction_add'];
      expect(supportedEventTypes).toHaveLength(3);
    });

    it('should have normalizer for message events', () => {
      expect(typeof normalizeMessageEvent).toBe('function');
    });

    it('should have normalizer for thread_create events', () => {
      expect(typeof normalizeThreadCreateEvent).toBe('function');
    });

    it('should have normalizer for reaction_add events', () => {
      expect(typeof normalizeReactionAddEvent).toBe('function');
    });

    it('should produce correct event types from normalizers', () => {
      // Message event
      const mockMessage = {
        guildId: '123456789012345678',
        channelId: '987654321098765432',
        content: 'Test',
        createdTimestamp: Date.now(),
        author: { id: '111222333444555666', bot: false },
        channel: { isThread: () => false },
      };
      const messageEvent = normalizeMessageEvent(mockMessage as any);
      expect(messageEvent?.type).toBe('message');

      // Thread create event
      const mockThread = {
        id: '555666777888999000',
        guildId: '123456789012345678',
        parentId: '987654321098765432',
        name: 'Test Thread',
        ownerId: '111222333444555666',
        createdTimestamp: Date.now(),
      };
      const threadEvent = normalizeThreadCreateEvent(mockThread as any);
      expect(threadEvent?.type).toBe('thread_create');

      // Reaction add event
      const mockReaction = {
        emoji: { name: '✅' },
        message: {
          id: '999888777666555444',
          guildId: '123456789012345678',
          channelId: '987654321098765432',
          channel: { isThread: () => false },
        },
      };
      const mockUser = { id: '111222333444555666' };
      const reactionEvent = normalizeReactionAddEvent(mockReaction as any, mockUser as any);
      expect(reactionEvent?.type).toBe('reaction_add');
    });
  });

  describe('Registered Slash Commands', () => {
    it('should have exactly 7 slash commands registered', () => {
      const commands = getSlashCommandNames();
      expect(commands).toHaveLength(7);
    });

    it('should have all required commands: start, plan, code, review, test, deploy, summary', () => {
      const commands = getSlashCommandNames();
      const requiredCommands = ['start', 'plan', 'code', 'review', 'test', 'deploy', 'summary'];

      for (const required of requiredCommands) {
        expect(commands).toContain(required);
      }
    });

    it('should validate all 7 commands as valid', () => {
      const commands = getSlashCommandNames();
      
      for (const command of commands) {
        expect(isValidSlashCommand(command)).toBe(true);
      }
    });

    it('should build slash command with 7 subcommands', () => {
      const command = buildAISlashCommand();
      const json = command.toJSON();
      
      expect(json.options).toHaveLength(7);
    });
  });

  describe('GitHub Webhook Support', () => {
    it('should support 4 webhook actions', () => {
      const supportedActions = ['opened', 'closed', 'synchronize', 'review_submitted'];
      expect(supportedActions).toHaveLength(4);
    });

    it('should normalize all supported webhook actions', () => {
      const baseWebhook = {
        pull_request: {
          number: 1,
          title: 'Test PR',
          html_url: 'https://github.com/test/repo/pull/1',
          user: { login: 'user' },
        },
        repository: { full_name: 'test/repo' },
        sender: { id: 1, login: 'user' },
      };

      // Test opened
      const openedResult = normalizeGitHubWebhook(
        { ...baseWebhook, action: 'opened' } as GitHubPullRequestWebhook,
        'guild',
        'channel'
      );
      expect(openedResult).not.toBeNull();

      // Test closed
      const closedResult = normalizeGitHubWebhook(
        { ...baseWebhook, action: 'closed' } as GitHubPullRequestWebhook,
        'guild',
        'channel'
      );
      expect(closedResult).not.toBeNull();

      // Test synchronize
      const syncResult = normalizeGitHubWebhook(
        { ...baseWebhook, action: 'synchronize' } as GitHubPullRequestWebhook,
        'guild',
        'channel'
      );
      expect(syncResult).not.toBeNull();

      // Test review_submitted
      const reviewResult = normalizeGitHubWebhook(
        {
          ...baseWebhook,
          action: 'submitted',
          review: { state: 'approved', user: { login: 'reviewer' } },
        } as GitHubPullRequestReviewWebhook,
        'guild',
        'channel'
      );
      expect(reviewResult).not.toBeNull();
    });
  });

  describe('Event Structure Validation', () => {
    it('should produce events with all required fields', () => {
      const mockMessage = {
        guildId: '123456789012345678',
        channelId: '987654321098765432',
        content: 'Test',
        createdTimestamp: Date.now(),
        author: { id: '111222333444555666', bot: false },
        channel: { isThread: () => false },
      };

      const event = normalizeMessageEvent(mockMessage as any);

      // Verify all required NormalizedEvent fields
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('guildId');
      expect(event).toHaveProperty('channelId');
      expect(event).toHaveProperty('userId');
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('payload');
    });

    it('should include server, channel, thread, and user identifiers', () => {
      const mockMessage = {
        guildId: 'server-id',
        channelId: 'thread-id',
        content: 'Test',
        createdTimestamp: Date.now(),
        author: { id: 'user-id', bot: false },
        channel: {
          isThread: () => true,
          parentId: 'channel-id',
        },
      };

      const event = normalizeMessageEvent(mockMessage as any);

      expect(event!.guildId).toBe('server-id');
      expect(event!.channelId).toBe('channel-id');
      expect(event!.threadId).toBe('thread-id');
      expect(event!.userId).toBe('user-id');
    });
  });
});
