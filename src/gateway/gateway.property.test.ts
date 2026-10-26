/**
 * Property-Based Tests for Event Normalization
 * Feature: discord-ai-devos, Property 1: Normalización de eventos preserva estructura completa
 *
 * **Validates: Requirements 1.1, 1.2**
 *
 * Property 1: For any Discord event (message, thread_create, reaction_add),
 * the Gateway normalization function must produce a NormalizedEvent that contains:
 * id, type, guildId, channelId, userId, timestamp and the correct payload,
 * without applying business logic transformations to the content.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  normalizeMessageEvent,
  normalizeThreadCreateEvent,
  normalizeReactionAddEvent,
} from './event-normalizer.js';
import type { NormalizedEvent, MessagePayload, ThreadPayload, ReactionPayload } from '../types/events.js';

// ============================================================================
// Fast-Check Arbitraries (Generators) for Discord.js Mock Objects
// ============================================================================

/**
 * Generates a non-empty string ID (simulating Discord snowflake IDs)
 */
const snowflakeIdArb = fc.stringMatching(/^[0-9]{17,19}$/);

/**
 * Generates a valid emoji for reactions
 */
const supportedEmojiArb = fc.constantFrom('✅', '❌', '🔁', '🚀');

/**
 * Generates an unsupported emoji (for negative testing)
 */
const unsupportedEmojiArb = fc.constantFrom('👍', '👎', '❤️', '😀', '🎉');

/**
 * Generates a mock discord.js Message object for non-thread channels
 */
const mockMessageArb = fc.record({
  guildId: snowflakeIdArb,
  channelId: snowflakeIdArb,
  content: fc.string({ maxLength: 2000 }),
  createdTimestamp: fc.integer({ min: 1609459200000, max: Date.now() + 86400000 }),
  author: fc.record({
    id: snowflakeIdArb,
    bot: fc.boolean(),
  }),
  channel: fc.record({
    isThread: fc.constant(() => false),
  }),
});

/**
 * Generates a mock discord.js Message object for thread channels
 */
const mockThreadMessageArb = fc.record({
  guildId: snowflakeIdArb,
  channelId: snowflakeIdArb,
  content: fc.string({ maxLength: 2000 }),
  createdTimestamp: fc.integer({ min: 1609459200000, max: Date.now() + 86400000 }),
  author: fc.record({
    id: snowflakeIdArb,
    bot: fc.boolean(),
  }),
  channel: fc.record({
    isThread: fc.constant(() => true),
    parentId: snowflakeIdArb,
  }),
});

/**
 * Generates a mock discord.js ThreadChannel object
 */
const mockThreadChannelArb = fc.record({
  id: snowflakeIdArb,
  guildId: snowflakeIdArb,
  parentId: snowflakeIdArb,
  name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  ownerId: fc.option(snowflakeIdArb, { nil: undefined }),
  createdTimestamp: fc.option(fc.integer({ min: 1609459200000, max: Date.now() + 86400000 }), { nil: undefined }),
});

/**
 * Generates a mock discord.js MessageReaction object with supported emoji
 */
const mockReactionArb = (emoji: string) => fc.record({
  emoji: fc.record({
    name: fc.constant(emoji),
  }),
  message: fc.record({
    id: snowflakeIdArb,
    guildId: snowflakeIdArb,
    channelId: snowflakeIdArb,
    channel: fc.record({
      isThread: fc.constant(() => false),
    }),
  }),
});

/**
 * Generates a mock discord.js MessageReaction object for thread channels
 */
const mockThreadReactionArb = (emoji: string) => fc.record({
  emoji: fc.record({
    name: fc.constant(emoji),
  }),
  message: fc.record({
    id: snowflakeIdArb,
    guildId: snowflakeIdArb,
    channelId: snowflakeIdArb,
    channel: fc.record({
      isThread: fc.constant(() => true),
      parentId: snowflakeIdArb,
    }),
  }),
});

/**
 * Generates a mock discord.js User object
 */
const mockUserArb = fc.record({
  id: snowflakeIdArb,
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Property 1: Normalización de eventos preserva estructura completa', () => {
  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * Property: For any valid message event, normalizeMessageEvent produces a
   * NormalizedEvent with all required fields: id, type, guildId, channelId,
   * userId, timestamp, and correct MessagePayload.
   */
  describe('Message Events', () => {
    it('should produce NormalizedEvent with complete structure for non-thread messages', async () => {
      await fc.assert(
        fc.asyncProperty(mockMessageArb, async (mockMessage) => {
          // Act
          const result = normalizeMessageEvent(mockMessage as any);

          // Assert: Result is not null
          expect(result).not.toBeNull();
          const event = result as NormalizedEvent;

          // Assert: All required fields are present
          expect(event.id).toBeDefined();
          expect(typeof event.id).toBe('string');
          expect(event.id.length).toBeGreaterThan(0);

          expect(event.type).toBe('message');

          expect(event.guildId).toBe(mockMessage.guildId);
          expect(event.channelId).toBe(mockMessage.channelId);
          expect(event.userId).toBe(mockMessage.author.id);
          expect(event.timestamp).toBe(mockMessage.createdTimestamp);

          // Assert: threadId is undefined for non-thread messages
          expect(event.threadId).toBeUndefined();

          // Assert: Payload preserves content without transformation
          const payload = event.payload as MessagePayload;
          expect(payload.content).toBe(mockMessage.content);
          expect(payload.authorIsBot).toBe(mockMessage.author.bot);
        }),
        { numRuns: 100 }
      );
    });

    it('should produce NormalizedEvent with threadId for thread messages', async () => {
      await fc.assert(
        fc.asyncProperty(mockThreadMessageArb, async (mockMessage) => {
          // Act
          const result = normalizeMessageEvent(mockMessage as any);

          // Assert: Result is not null
          expect(result).not.toBeNull();
          const event = result as NormalizedEvent;

          // Assert: All required fields are present
          expect(event.id).toBeDefined();
          expect(event.type).toBe('message');
          expect(event.guildId).toBe(mockMessage.guildId);
          expect(event.userId).toBe(mockMessage.author.id);
          expect(event.timestamp).toBe(mockMessage.createdTimestamp);

          // Assert: channelId is the parent channel, threadId is the thread
          expect(event.channelId).toBe(mockMessage.channel.parentId);
          expect(event.threadId).toBe(mockMessage.channelId);

          // Assert: Payload preserves content
          const payload = event.payload as MessagePayload;
          expect(payload.content).toBe(mockMessage.content);
          expect(payload.authorIsBot).toBe(mockMessage.author.bot);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve message content exactly without business logic transformation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ maxLength: 2000 }),
          fc.boolean(),
          snowflakeIdArb,
          snowflakeIdArb,
          snowflakeIdArb,
          async (content, isBot, guildId, channelId, authorId) => {
            const mockMessage = {
              guildId,
              channelId,
              content,
              createdTimestamp: Date.now(),
              author: { id: authorId, bot: isBot },
              channel: { isThread: () => false },
            };

            const result = normalizeMessageEvent(mockMessage as any);
            expect(result).not.toBeNull();

            const payload = result!.payload as MessagePayload;
            // Content must be exactly preserved - no trimming, no transformation
            expect(payload.content).toBe(content);
            expect(payload.authorIsBot).toBe(isBot);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * Property: For any valid thread_create event, normalizeThreadCreateEvent produces
   * a NormalizedEvent with all required fields and correct ThreadPayload.
   */
  describe('Thread Create Events', () => {
    it('should produce NormalizedEvent with complete structure for thread creation', async () => {
      await fc.assert(
        fc.asyncProperty(mockThreadChannelArb, async (mockThread) => {
          // Act
          const result = normalizeThreadCreateEvent(mockThread as any);

          // Assert: Result is not null
          expect(result).not.toBeNull();
          const event = result as NormalizedEvent;

          // Assert: All required fields are present
          expect(event.id).toBeDefined();
          expect(typeof event.id).toBe('string');
          expect(event.id.length).toBeGreaterThan(0);

          expect(event.type).toBe('thread_create');

          expect(event.guildId).toBe(mockThread.guildId);
          expect(event.channelId).toBe(mockThread.parentId);
          expect(event.threadId).toBe(mockThread.id);
          expect(event.userId).toBe(mockThread.ownerId ?? 'unknown');
          expect(typeof event.timestamp).toBe('number');

          // Assert: Payload preserves thread data
          const payload = event.payload as ThreadPayload;
          expect(payload.name).toBe(mockThread.name);
          expect(payload.parentChannelId).toBe(mockThread.parentId);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve thread name exactly without transformation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
          snowflakeIdArb,
          snowflakeIdArb,
          snowflakeIdArb,
          async (threadName, threadId, guildId, parentId) => {
            const mockThread = {
              id: threadId,
              guildId,
              parentId,
              name: threadName,
              ownerId: '123456789012345678',
              createdTimestamp: Date.now(),
            };

            const result = normalizeThreadCreateEvent(mockThread as any);
            expect(result).not.toBeNull();

            const payload = result!.payload as ThreadPayload;
            // Thread name must be exactly preserved
            expect(payload.name).toBe(threadName);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * Property: For any valid reaction_add event with supported emoji,
   * normalizeReactionAddEvent produces a NormalizedEvent with all required fields
   * and correct ReactionPayload.
   */
  describe('Reaction Add Events', () => {
    it('should produce NormalizedEvent with complete structure for supported reactions', async () => {
      await fc.assert(
        fc.asyncProperty(
          supportedEmojiArb,
          mockUserArb,
          async (emoji, mockUser) => {
            const mockReaction = {
              emoji: { name: emoji },
              message: {
                id: '123456789012345678',
                guildId: '987654321098765432',
                channelId: '111222333444555666',
                channel: { isThread: () => false },
              },
            };

            // Act
            const result = normalizeReactionAddEvent(mockReaction as any, mockUser as any);

            // Assert: Result is not null for supported emojis
            expect(result).not.toBeNull();
            const event = result as NormalizedEvent;

            // Assert: All required fields are present
            expect(event.id).toBeDefined();
            expect(typeof event.id).toBe('string');
            expect(event.id.length).toBeGreaterThan(0);

            expect(event.type).toBe('reaction_add');

            expect(event.guildId).toBe(mockReaction.message.guildId);
            expect(event.channelId).toBe(mockReaction.message.channelId);
            expect(event.userId).toBe(mockUser.id);
            expect(typeof event.timestamp).toBe('number');

            // Assert: Payload contains correct emoji and messageId
            const payload = event.payload as ReactionPayload;
            expect(payload.emoji).toBe(emoji);
            expect(payload.messageId).toBe(mockReaction.message.id);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should produce NormalizedEvent with threadId for reactions in threads', async () => {
      await fc.assert(
        fc.asyncProperty(
          supportedEmojiArb,
          snowflakeIdArb,
          snowflakeIdArb,
          snowflakeIdArb,
          snowflakeIdArb,
          snowflakeIdArb,
          async (emoji, userId, messageId, guildId, channelId, parentId) => {
            const mockReaction = {
              emoji: { name: emoji },
              message: {
                id: messageId,
                guildId,
                channelId,
                channel: {
                  isThread: () => true,
                  parentId,
                },
              },
            };
            const mockUser = { id: userId };

            // Act
            const result = normalizeReactionAddEvent(mockReaction as any, mockUser as any);

            // Assert: Result is not null
            expect(result).not.toBeNull();
            const event = result as NormalizedEvent;

            // Assert: channelId is parent, threadId is the thread channel
            expect(event.channelId).toBe(parentId);
            expect(event.threadId).toBe(channelId);

            // Assert: Payload is correct
            const payload = event.payload as ReactionPayload;
            expect(payload.emoji).toBe(emoji);
            expect(payload.messageId).toBe(messageId);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return null for unsupported emoji reactions', async () => {
      await fc.assert(
        fc.asyncProperty(
          unsupportedEmojiArb,
          mockUserArb,
          async (emoji, mockUser) => {
            const mockReaction = {
              emoji: { name: emoji },
              message: {
                id: '123456789012345678',
                guildId: '987654321098765432',
                channelId: '111222333444555666',
                channel: { isThread: () => false },
              },
            };

            // Act
            const result = normalizeReactionAddEvent(mockReaction as any, mockUser as any);

            // Assert: Result is null for unsupported emojis
            expect(result).toBeNull();
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * Property: Event IDs are unique across all event types.
   * Each normalized event must have a unique identifier.
   */
  describe('Event ID Uniqueness', () => {
    it('should generate unique IDs for multiple events', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 5, max: 20 }),
          async (count) => {
            const ids = new Set<string>();

            for (let i = 0; i < count; i++) {
              const mockMessage = {
                guildId: '123456789012345678',
                channelId: '987654321098765432',
                content: `Message ${i}`,
                createdTimestamp: Date.now() + i,
                author: { id: '111222333444555666', bot: false },
                channel: { isThread: () => false },
              };

              const result = normalizeMessageEvent(mockMessage as any);
              expect(result).not.toBeNull();
              ids.add(result!.id);
            }

            // All IDs should be unique
            expect(ids.size).toBe(count);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * Property: Normalization returns null for invalid/incomplete events.
   * This ensures the Gateway doesn't forward malformed events.
   */
  describe('Invalid Event Handling', () => {
    it('should return null for messages without guildId', async () => {
      const mockMessage = {
        guildId: null,
        channelId: '123456789012345678',
        content: 'test',
        createdTimestamp: Date.now(),
        author: { id: '111222333444555666', bot: false },
        channel: { isThread: () => false },
      };

      const result = normalizeMessageEvent(mockMessage as any);
      expect(result).toBeNull();
    });

    it('should return null for messages without author', async () => {
      const mockMessage = {
        guildId: '123456789012345678',
        channelId: '987654321098765432',
        content: 'test',
        createdTimestamp: Date.now(),
        author: null,
        channel: { isThread: () => false },
      };

      const result = normalizeMessageEvent(mockMessage as any);
      expect(result).toBeNull();
    });

    it('should return null for threads without parentId', async () => {
      const mockThread = {
        id: '123456789012345678',
        guildId: '987654321098765432',
        parentId: null,
        name: 'Test Thread',
        ownerId: '111222333444555666',
        createdTimestamp: Date.now(),
      };

      const result = normalizeThreadCreateEvent(mockThread as any);
      expect(result).toBeNull();
    });

    it('should return null for reactions without emoji name', async () => {
      const mockReaction = {
        emoji: { name: null },
        message: {
          id: '123456789012345678',
          guildId: '987654321098765432',
          channelId: '111222333444555666',
          channel: { isThread: () => false },
        },
      };
      const mockUser = { id: '999888777666555444' };

      const result = normalizeReactionAddEvent(mockReaction as any, mockUser as any);
      expect(result).toBeNull();
    });
  });
});


// ============================================================================
// Feature: discord-ai-devos, Property 12: Retry con backoff exponencial
// ============================================================================

import { calculateRetryDelay, normalizeGitHubWebhook, type GitHubWebhook } from './github-webhook-handler.js';
import { constants } from '../config/index.js';

/**
 * Property-Based Tests for Exponential Backoff Retry
 * Feature: discord-ai-devos, Property 12: Retry con backoff exponencial
 *
 * **Validates: Requirements 9.5**
 *
 * Property 12: For any GitHub webhook that fails processing, the system must
 * retry up to 3 times with exponential backoff, where the delay for attempt N
 * is always greater than the delay for attempt N-1.
 * 
 * Backoff pattern: 1s, 2s, 4s (for attempts 0, 1, 2)
 */
describe('Property 12: Retry con backoff exponencial', () => {
  /**
   * **Validates: Requirements 9.5**
   *
   * Property: For any sequence of retry attempts, the delay for attempt N
   * must be strictly greater than the delay for attempt N-1.
   */
  describe('Exponential Backoff Delays', () => {
    it('should produce increasing delays for consecutive attempts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 10 }), // Test beyond max retries to verify pattern
          async (maxAttempt) => {
            let previousDelay = 0;

            for (let attempt = 0; attempt <= maxAttempt; attempt++) {
              const currentDelay = calculateRetryDelay(attempt);

              // Assert: Current delay is greater than previous delay
              expect(currentDelay).toBeGreaterThan(previousDelay);

              previousDelay = currentDelay;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should follow the pattern: 1s, 2s, 4s for attempts 0, 1, 2', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(null), // No random input needed, just verify the pattern
          async () => {
            const delay0 = calculateRetryDelay(0);
            const delay1 = calculateRetryDelay(1);
            const delay2 = calculateRetryDelay(2);

            // Assert: Delays follow the expected pattern
            expect(delay0).toBe(1000); // 1s
            expect(delay1).toBe(2000); // 2s
            expect(delay2).toBe(4000); // 4s

            // Assert: Each delay is double the previous (exponential with multiplier 2)
            expect(delay1).toBe(delay0 * constants.WEBHOOK_RETRY_BACKOFF_MULTIPLIER);
            expect(delay2).toBe(delay1 * constants.WEBHOOK_RETRY_BACKOFF_MULTIPLIER);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should calculate delay using base * multiplier^attempt formula', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 5 }),
          async (attempt) => {
            const expectedDelay = constants.WEBHOOK_RETRY_INITIAL_DELAY * 
              Math.pow(constants.WEBHOOK_RETRY_BACKOFF_MULTIPLIER, attempt);
            
            const actualDelay = calculateRetryDelay(attempt);

            expect(actualDelay).toBe(expectedDelay);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 9.5**
   *
   * Property: The system must retry a maximum of 3 times (MAX_RETRY_ATTEMPTS).
   */
  describe('Maximum Retry Attempts', () => {
    it('should respect MAX_RETRY_ATTEMPTS constant of 3', () => {
      expect(constants.MAX_RETRY_ATTEMPTS).toBe(3);
    });

    it('should have delays defined for all retry attempts (0 to MAX-1)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: constants.MAX_RETRY_ATTEMPTS - 1 }),
          async (attempt) => {
            const delay = calculateRetryDelay(attempt);
            
            // Assert: Delay is a positive number
            expect(delay).toBeGreaterThan(0);
            expect(typeof delay).toBe('number');
            expect(Number.isFinite(delay)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should produce exactly 3 distinct delays for the 3 retry attempts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(null),
          async () => {
            const delays = new Set<number>();
            
            for (let attempt = 0; attempt < constants.MAX_RETRY_ATTEMPTS; attempt++) {
              delays.add(calculateRetryDelay(attempt));
            }
            
            // Assert: All 3 delays are unique
            expect(delays.size).toBe(constants.MAX_RETRY_ATTEMPTS);
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  /**
   * **Validates: Requirements 9.5**
   *
   * Property: For random failure sequences, delays are always increasing
   * and the system respects the maximum retry limit.
   */
  describe('Random Failure Sequences', () => {
    it('should produce strictly increasing delays for any sequence of attempts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 2, maxLength: 10 }),
          async (attemptNumbers) => {
            // Sort to get consecutive attempts
            const sortedAttempts = [...attemptNumbers].sort((a, b) => a - b);
            
            // Calculate delays for each attempt
            const delays = sortedAttempts.map(attempt => calculateRetryDelay(attempt));
            
            // Verify delays are strictly increasing
            for (let i = 1; i < delays.length; i++) {
              if (sortedAttempts[i] > sortedAttempts[i - 1]) {
                expect(delays[i]).toBeGreaterThan(delays[i - 1]);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should calculate correct delays for random attempt sequences within MAX_RETRY_ATTEMPTS', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: constants.MAX_RETRY_ATTEMPTS }),
          async (numAttempts) => {
            const delays: number[] = [];
            
            for (let attempt = 0; attempt < numAttempts; attempt++) {
              delays.push(calculateRetryDelay(attempt));
            }
            
            // Verify all delays are positive and increasing
            for (let i = 0; i < delays.length; i++) {
              expect(delays[i]).toBeGreaterThan(0);
              if (i > 0) {
                expect(delays[i]).toBeGreaterThan(delays[i - 1]);
              }
            }
            
            // Verify the ratio between consecutive delays equals the multiplier
            for (let i = 1; i < delays.length; i++) {
              expect(delays[i] / delays[i - 1]).toBe(constants.WEBHOOK_RETRY_BACKOFF_MULTIPLIER);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 9.5**
   *
   * Property: Unsupported webhook actions should not be normalized.
   */
  describe('Unsupported Actions', () => {
    it('should return null for unsupported webhook actions', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('edited', 'labeled', 'assigned', 'converted_to_draft', 'milestoned'),
          snowflakeIdArb,
          snowflakeIdArb,
          async (unsupportedAction, guildId, channelId) => {
            const webhook = {
              action: unsupportedAction,
              pull_request: {
                number: 111,
                title: 'Unsupported Action PR',
                html_url: 'https://github.com/test/repo/pull/111',
                user: { login: 'unsupporteduser' },
              },
              repository: { full_name: 'test/repo' },
              sender: { id: 33333, login: 'unsupporteduser' },
            } as unknown as GitHubWebhook;

            const result = normalizeGitHubWebhook(webhook, guildId, channelId);

            // Assert: Unsupported actions return null (no event to process)
            expect(result).toBeNull();
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should normalize supported webhook actions', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('opened', 'closed', 'synchronize'),
          snowflakeIdArb,
          snowflakeIdArb,
          fc.integer({ min: 1, max: 9999 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          async (supportedAction, guildId, channelId, prNumber, prTitle) => {
            const webhook: GitHubWebhook = {
              action: supportedAction,
              pull_request: {
                number: prNumber,
                title: prTitle,
                html_url: `https://github.com/test/repo/pull/${prNumber}`,
                user: { login: 'testuser' },
              },
              repository: { full_name: 'test/repo' },
              sender: { id: 12345, login: 'testuser' },
            };

            const result = normalizeGitHubWebhook(webhook, guildId, channelId);

            // Assert: Supported actions produce a normalized event
            expect(result).not.toBeNull();
            expect(result!.type).toBe('github_webhook');
            expect(result!.guildId).toBe(guildId);
            expect(result!.channelId).toBe(channelId);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 9.5**
   *
   * Property: Backoff delays grow exponentially with the correct base and multiplier.
   */
  describe('Exponential Growth Verification', () => {
    it('should double the delay for each subsequent attempt', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 8 }),
          async (attempt) => {
            const currentDelay = calculateRetryDelay(attempt);
            const nextDelay = calculateRetryDelay(attempt + 1);
            
            // Assert: Next delay is exactly double the current delay
            expect(nextDelay).toBe(currentDelay * 2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use the correct initial delay from constants', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(null),
          async () => {
            const initialDelay = calculateRetryDelay(0);
            
            // Assert: Initial delay matches the constant
            expect(initialDelay).toBe(constants.WEBHOOK_RETRY_INITIAL_DELAY);
            expect(initialDelay).toBe(1000); // 1 second
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should use the correct multiplier from constants', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 5 }),
          async (attempt) => {
            const delay = calculateRetryDelay(attempt);
            const expectedDelay = constants.WEBHOOK_RETRY_INITIAL_DELAY * 
              Math.pow(constants.WEBHOOK_RETRY_BACKOFF_MULTIPLIER, attempt);
            
            expect(delay).toBe(expectedDelay);
            expect(constants.WEBHOOK_RETRY_BACKOFF_MULTIPLIER).toBe(2);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
