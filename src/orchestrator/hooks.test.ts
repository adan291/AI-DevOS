/**
 * Unit Tests for Discord Hooks
 * Tests for reaction handler, thread handler, and slash command handler
 * Requirements: 6.1, 6.4, 6.5, 6.6, 6.7, 7.2-7.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mapReactionToAgent,
  createReactionHandler,
  type ReactionContext,
} from './reaction-handler.js';
import {
  classifyThread,
  createThreadHandler,
} from './thread-handler.js';
import {
  mapCommandToAgents,
  createPlanFromCommand,
  createSlashCommandHandler,
} from './slash-command-handler.js';
import type { NormalizedEvent, ReactionPayload, ThreadPayload, SlashCommandPayload } from '../types/events.js';
import type { RedisStore, PostgresStore } from '../types/persistence.js';

describe('Reaction Handler Unit Tests', () => {
  describe('mapReactionToAgent', () => {
    describe('✅ (approve) reaction', () => {
      it('should map to reviewer in review state', () => {
        const context: ReactionContext = {
          thread: {
            threadId: 'thread-1',
            channelId: 'channel-1',
            type: 'feature',
            state: 'review',
            summary: '',
            decisions: [],
            artifacts: [],
            messageCount: 0,
            lastSummaryAt: 0,
          },
        };

        const result = mapReactionToAgent('✅', context);
        
        expect(result?.agentRole).toBe('reviewer');
      });

      it('should map to reviewer in in_progress state', () => {
        const context: ReactionContext = {
          thread: {
            threadId: 'thread-1',
            channelId: 'channel-1',
            type: 'feature',
            state: 'in_progress',
            summary: '',
            decisions: [],
            artifacts: [],
            messageCount: 0,
            lastSummaryAt: 0,
          },
        };

        const result = mapReactionToAgent('✅', context);
        
        expect(result?.agentRole).toBe('reviewer');
      });

      it('should map to devops in done state', () => {
        const context: ReactionContext = {
          thread: {
            threadId: 'thread-1',
            channelId: 'channel-1',
            type: 'feature',
            state: 'done',
            summary: '',
            decisions: [],
            artifacts: [],
            messageCount: 0,
            lastSummaryAt: 0,
          },
        };

        const result = mapReactionToAgent('✅', context);
        
        expect(result?.agentRole).toBe('devops');
      });

      it('should map to coordinator in open state', () => {
        const context: ReactionContext = {
          thread: {
            threadId: 'thread-1',
            channelId: 'channel-1',
            type: 'feature',
            state: 'open',
            summary: '',
            decisions: [],
            artifacts: [],
            messageCount: 0,
            lastSummaryAt: 0,
          },
        };

        const result = mapReactionToAgent('✅', context);
        
        expect(result?.agentRole).toBe('coordinator');
      });
    });

    describe('❌ (reject) reaction', () => {
      it('should always map to developer', () => {
        const states = ['open', 'in_progress', 'review', 'done'] as const;
        
        for (const state of states) {
          const context: ReactionContext = {
            thread: {
              threadId: 'thread-1',
              channelId: 'channel-1',
              type: 'feature',
              state,
              summary: '',
              decisions: [],
              artifacts: [],
              messageCount: 0,
              lastSummaryAt: 0,
            },
          };

          const result = mapReactionToAgent('❌', context);
          
          expect(result?.agentRole).toBe('developer');
        }
      });
    });

    describe('🔁 (retry) reaction', () => {
      it('should map to last agent when available', () => {
        const context: ReactionContext = {
          lastAgentRole: 'architect',
        };

        const result = mapReactionToAgent('🔁', context);
        
        expect(result?.agentRole).toBe('architect');
      });

      it('should map to coordinator when no last agent', () => {
        const context: ReactionContext = {};

        const result = mapReactionToAgent('🔁', context);
        
        expect(result?.agentRole).toBe('coordinator');
      });
    });

    describe('🚀 (deploy) reaction', () => {
      it('should always map to devops', () => {
        const context: ReactionContext = {};

        const result = mapReactionToAgent('🚀', context);
        
        expect(result?.agentRole).toBe('devops');
      });
    });
  });

  describe('ReactionHandler class', () => {
    it('should handle reaction_add events', async () => {
      const handler = createReactionHandler();
      const event: NormalizedEvent = {
        id: 'event-1',
        type: 'reaction_add',
        guildId: 'guild-1',
        channelId: 'channel-1',
        threadId: 'thread-1',
        userId: 'user-1',
        timestamp: Date.now(),
        payload: {
          emoji: '✅',
          messageId: 'msg-1',
        } as ReactionPayload,
      };

      const context: ReactionContext = {
        thread: {
          threadId: 'thread-1',
          channelId: 'channel-1',
          type: 'feature',
          state: 'review',
          summary: '',
          decisions: [],
          artifacts: [],
          messageCount: 0,
          lastSummaryAt: 0,
        },
      };

      const result = await handler.handle(event, context);
      
      expect(result?.agentRole).toBe('reviewer');
    });

    it('should return null for non-reaction events', async () => {
      const handler = createReactionHandler();
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

      const result = await handler.handle(event, {});
      
      expect(result).toBeNull();
    });
  });
});

describe('Thread Handler Unit Tests', () => {
  describe('classifyThread', () => {
    it('should classify feature threads', () => {
      const names = ['Add new feature', 'feature: login', 'implement auth'];
      
      for (const name of names) {
        const result = classifyThread(name);
        expect(result.type).toBe('feature');
      }
    });

    it('should classify bug threads', () => {
      const names = ['Fix bug in login', 'bug: crash on startup', 'error handling'];
      
      for (const name of names) {
        const result = classifyThread(name);
        expect(result.type).toBe('bug');
      }
    });

    it('should classify PR threads', () => {
      const names = ['Review PR #123', 'pull request for feature', 'merge branch'];
      
      for (const name of names) {
        const result = classifyThread(name);
        expect(result.type).toBe('pr');
      }
    });

    it('should classify task threads', () => {
      const names = ['Task: update docs', 'refactor code', 'cleanup old files'];
      
      for (const name of names) {
        const result = classifyThread(name);
        expect(result.type).toBe('task');
      }
    });

    it('should default to task for unknown patterns', () => {
      const result = classifyThread('xyz123abc');
      
      expect(result.type).toBe('task');
      expect(result.confidence).toBe(0.3);
    });
  });

  describe('ThreadHandler class', () => {
    let mockRedisStore: RedisStore;
    let mockPostgresStore: PostgresStore;

    beforeEach(() => {
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

    it('should handle thread_create events', async () => {
      const handler = createThreadHandler();
      const event: NormalizedEvent = {
        id: 'event-1',
        type: 'thread_create',
        guildId: 'guild-1',
        channelId: 'channel-1',
        threadId: 'thread-1',
        userId: 'user-1',
        timestamp: Date.now(),
        payload: {
          name: 'Add new feature',
          parentChannelId: 'channel-1',
        } as ThreadPayload,
      };

      const result = await handler.handle(event, mockRedisStore, mockPostgresStore);
      
      expect(result).not.toBeNull();
      expect(result?.type).toBe('feature');
      expect(result?.state).toBe('open');
      expect(mockRedisStore.setThreadState).toHaveBeenCalledWith('thread-1', 'open');
      expect(mockPostgresStore.upsertThread).toHaveBeenCalled();
    });

    it('should return null for non-thread_create events', async () => {
      const handler = createThreadHandler();
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

      const result = await handler.handle(event, mockRedisStore, mockPostgresStore);
      
      expect(result).toBeNull();
    });

    it('should use event.id as threadId when threadId is not present', async () => {
      const handler = createThreadHandler();
      const event: NormalizedEvent = {
        id: 'event-123',
        type: 'thread_create',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
        timestamp: Date.now(),
        payload: {
          name: 'Bug fix',
          parentChannelId: 'channel-1',
        } as ThreadPayload,
      };

      const result = await handler.handle(event, mockRedisStore, mockPostgresStore);
      
      expect(result?.threadId).toBe('event-123');
    });
  });
});

describe('Slash Command Handler Unit Tests', () => {
  describe('mapCommandToAgents', () => {
    it('should map start to coordinator', () => {
      const result = mapCommandToAgents('start');
      expect(result.agents).toContain('coordinator');
    });

    it('should map plan to planner', () => {
      const result = mapCommandToAgents('plan');
      expect(result.agents).toContain('planner');
    });

    it('should map code to developer', () => {
      const result = mapCommandToAgents('code');
      expect(result.agents).toContain('developer');
    });

    it('should map review to reviewer', () => {
      const result = mapCommandToAgents('review');
      expect(result.agents).toContain('reviewer');
    });

    it('should map test to qa', () => {
      const result = mapCommandToAgents('test');
      expect(result.agents).toContain('qa');
    });

    it('should map deploy to devops', () => {
      const result = mapCommandToAgents('deploy');
      expect(result.agents).toContain('devops');
    });

    it('should map summary to memory', () => {
      const result = mapCommandToAgents('summary');
      expect(result.agents).toContain('memory');
    });
  });

  describe('createPlanFromCommand', () => {
    it('should create plan with architect and planner for start command', () => {
      const plan = createPlanFromCommand('start');
      
      expect(plan.agents).toContain('architect');
      expect(plan.agents).toContain('planner');
    });

    it('should create direct plan for other commands', () => {
      const commands = ['plan', 'code', 'review', 'test', 'deploy', 'summary'] as const;
      const expectedAgents = ['planner', 'developer', 'reviewer', 'qa', 'devops', 'memory'];

      commands.forEach((command, index) => {
        const plan = createPlanFromCommand(command);
        expect(plan.agents).toContain(expectedAgents[index]);
      });
    });
  });

  describe('SlashCommandHandler class', () => {
    it('should handle slash_command events', async () => {
      const handler = createSlashCommandHandler();
      const event: NormalizedEvent = {
        id: 'event-1',
        type: 'slash_command',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
        timestamp: Date.now(),
        payload: {
          command: 'code',
        } as SlashCommandPayload,
      };

      const result = await handler.handle(event);
      
      expect(result).not.toBeNull();
      expect(result?.agents).toContain('developer');
    });

    it('should return null for non-slash_command events', async () => {
      const handler = createSlashCommandHandler();
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

      const result = await handler.handle(event);
      
      expect(result).toBeNull();
    });
  });
});

describe('Smoke Tests for Hooks', () => {
  it('should have 4 supported reaction emojis', () => {
    const emojis: ReactionPayload['emoji'][] = ['✅', '❌', '🔁', '🚀'];
    const context: ReactionContext = {};

    for (const emoji of emojis) {
      const result = mapReactionToAgent(emoji, context);
      expect(result).not.toBeNull();
    }
  });

  it('should have 7 slash commands mapped', () => {
    const commands = ['start', 'plan', 'code', 'review', 'test', 'deploy', 'summary'] as const;

    for (const command of commands) {
      const mapping = mapCommandToAgents(command);
      expect(mapping.agents.length).toBeGreaterThan(0);
    }
  });

  it('should have 4 thread types supported', () => {
    const typeKeywords = {
      feature: 'feature',
      bug: 'bug',
      pr: 'pull request',
      task: 'task',
    };

    for (const [expectedType, keyword] of Object.entries(typeKeywords)) {
      const result = classifyThread(keyword);
      expect(result.type).toBe(expectedType);
    }
  });
});
