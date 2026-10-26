/**
 * Unit Tests for Advanced Features
 * Tests for auto-summary, error detection, and debate manager
 * Requirements: 8.1, 8.2, 8.3, 10.1, 10.2, 10.3, 10.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldTriggerSummary,
  createAutoSummaryHandler,
  AUTO_SUMMARY_THRESHOLD,
} from './auto-summary.js';
import {
  detectError,
  createErrorDetectorHandler,
} from './error-detector.js';
import {
  createDebateManager,
  DEBATE_MAX_TURNS,
} from './debate-manager.js';
import type { Agent, AgentResult } from '../types/agents.js';
import type { ThreadContext } from '../types/models.js';
import type { PostgresStore, VectorStore, RedisStore } from '../types/persistence.js';
import type { NormalizedEvent, MessagePayload } from '../types/events.js';

describe('Auto-Summary Unit Tests', () => {
  describe('shouldTriggerSummary', () => {
    it('should return false when below threshold', () => {
      expect(shouldTriggerSummary(10, 0)).toBe(false);
      expect(shouldTriggerSummary(14, 0)).toBe(false);
      expect(shouldTriggerSummary(20, 10)).toBe(false);
    });

    it('should return true when at or above threshold', () => {
      expect(shouldTriggerSummary(15, 0)).toBe(true);
      expect(shouldTriggerSummary(16, 0)).toBe(true);
      expect(shouldTriggerSummary(30, 15)).toBe(true);
    });

    it('should use custom threshold', () => {
      expect(shouldTriggerSummary(5, 0, 5)).toBe(true);
      expect(shouldTriggerSummary(4, 0, 5)).toBe(false);
    });
  });

  describe('AutoSummaryHandler', () => {
    let mockMemoryAgent: Agent;
    let mockPostgresStore: PostgresStore;
    let mockVectorStore: VectorStore;

    beforeEach(() => {
      mockMemoryAgent = {
        role: 'memory',
        execute: vi.fn().mockResolvedValue({
          role: 'memory',
          output: 'Summary: Decision: Use TypeScript. Issue: Performance concerns.',
          success: true,
        } as AgentResult),
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

      mockVectorStore = {
        store: vi.fn().mockResolvedValue(undefined),
        query: vi.fn(),
      };
    });

    it('should not trigger when below threshold', async () => {
      const handler = createAutoSummaryHandler();
      const thread: ThreadContext = {
        threadId: 'thread-1',
        channelId: 'channel-1',
        type: 'feature',
        state: 'open',
        summary: '',
        decisions: [],
        artifacts: [],
        messageCount: 10,
        lastSummaryAt: 0,
      };

      const result = await handler.checkAndTrigger(
        thread,
        mockMemoryAgent,
        mockPostgresStore,
        mockVectorStore
      );

      expect(result.triggered).toBe(false);
      expect(mockMemoryAgent.execute).not.toHaveBeenCalled();
    });

    it('should trigger when at threshold', async () => {
      const handler = createAutoSummaryHandler();
      const thread: ThreadContext = {
        threadId: 'thread-1',
        channelId: 'channel-1',
        type: 'feature',
        state: 'open',
        summary: '',
        decisions: [],
        artifacts: [],
        messageCount: 15,
        lastSummaryAt: 0,
      };

      const result = await handler.checkAndTrigger(
        thread,
        mockMemoryAgent,
        mockPostgresStore,
        mockVectorStore
      );

      expect(result.triggered).toBe(true);
      expect(mockMemoryAgent.execute).toHaveBeenCalled();
      expect(mockPostgresStore.upsertThread).toHaveBeenCalled();
      expect(mockVectorStore.store).toHaveBeenCalled();
    });

    it('should persist summary to both stores', async () => {
      const handler = createAutoSummaryHandler();
      const thread: ThreadContext = {
        threadId: 'thread-1',
        channelId: 'channel-1',
        type: 'feature',
        state: 'in_progress',
        summary: 'Previous summary',
        decisions: [{ id: 'd1', description: 'Use React', status: 'approved', createdAt: Date.now() }],
        artifacts: [],
        messageCount: 30,
        lastSummaryAt: 15,
      };

      await handler.checkAndTrigger(
        thread,
        mockMemoryAgent,
        mockPostgresStore,
        mockVectorStore
      );

      expect(mockPostgresStore.upsertThread).toHaveBeenCalledWith(
        'thread-1',
        expect.objectContaining({
          lastSummaryAt: 30,
        })
      );

      expect(mockVectorStore.store).toHaveBeenCalledWith(
        expect.stringContaining('summary-thread-1'),
        expect.any(String),
        expect.objectContaining({
          threadId: 'thread-1',
          type: 'summary',
        })
      );
    });
  });
});

describe('Error Detector Unit Tests', () => {
  describe('detectError', () => {
    it('should detect JavaScript errors', () => {
      const errors = [
        { msg: 'TypeError: Cannot read property "x" of undefined', type: 'exception' },
        { msg: 'ReferenceError: foo is not defined', type: 'exception' },
        { msg: 'SyntaxError: Unexpected token }', type: 'exception' },
      ];

      for (const { msg, type } of errors) {
        const result = detectError(msg);
        expect(result.hasError).toBe(true);
        expect(result.errorType).toBe(type);
      }
    });

    it('should detect stack traces', () => {
      const stackTrace = `
        Error: Something went wrong
        at Object.<anonymous> (/app/src/index.js:10:5)
        at Module._compile (internal/modules/cjs/loader.js:1063:30)
      `;

      const result = detectError(stackTrace);
      expect(result.hasError).toBe(true);
      // Stack trace pattern matches first
      expect(['stack_trace', 'error_message']).toContain(result.errorType);
    });

    it('should detect build failures', () => {
      const messages = [
        'Build failed with exit code 1',
        'Compilation error in file.ts',
        'Tests failed: 5 of 20',
      ];

      for (const message of messages) {
        const result = detectError(message);
        expect(result.hasError).toBe(true);
      }
    });

    it('should detect critical errors', () => {
      const criticalErrors = [
        'Application crashed unexpectedly',
        'panic: runtime error',
        'Segmentation fault (core dumped)',
      ];

      for (const error of criticalErrors) {
        const result = detectError(error);
        expect(result.hasError).toBe(true);
        expect(result.severity).toBe('critical');
      }
    });

    it('should not detect errors in normal messages', () => {
      const normalMessages = [
        'Hello, world!',
        'The feature is complete',
        'Please review this code',
        'Updated the README',
      ];

      for (const message of normalMessages) {
        const result = detectError(message);
        expect(result.hasError).toBe(false);
      }
    });

    it('should extract error context', () => {
      const message = 'Some prefix text Error: Connection refused some suffix text';
      const result = detectError(message);

      expect(result.hasError).toBe(true);
      expect(result.errorContext).toContain('Error: Connection refused');
    });
  });

  describe('ErrorDetectorHandler', () => {
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

    it('should create bug thread for error messages', async () => {
      const handler = createErrorDetectorHandler();
      const event: NormalizedEvent = {
        id: 'event-1',
        type: 'message',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
        timestamp: Date.now(),
        payload: {
          content: 'Error: Database connection failed',
          authorIsBot: false,
        } as MessagePayload,
      };

      const result = await handler.detectAndCreateThread(
        event,
        mockRedisStore,
        mockPostgresStore
      );

      expect(result).not.toBeNull();
      expect(result?.type).toBe('bug');
      expect(result?.state).toBe('open');
      expect(mockRedisStore.setThreadState).toHaveBeenCalled();
      expect(mockPostgresStore.upsertThread).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: 'bug' })
      );
    });

    it('should not create thread for normal messages', async () => {
      const handler = createErrorDetectorHandler();
      const event: NormalizedEvent = {
        id: 'event-1',
        type: 'message',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
        timestamp: Date.now(),
        payload: {
          content: 'Hello, how are you?',
          authorIsBot: false,
        } as MessagePayload,
      };

      const result = await handler.detectAndCreateThread(
        event,
        mockRedisStore,
        mockPostgresStore
      );

      expect(result).toBeNull();
    });

    it('should skip bot messages', async () => {
      const handler = createErrorDetectorHandler();
      const event: NormalizedEvent = {
        id: 'event-1',
        type: 'message',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'bot-1',
        timestamp: Date.now(),
        payload: {
          content: 'Error: Something went wrong',
          authorIsBot: true,
        } as MessagePayload,
      };

      const result = await handler.detectAndCreateThread(
        event,
        mockRedisStore,
        mockPostgresStore
      );

      expect(result).toBeNull();
    });

    it('should skip non-message events', async () => {
      const handler = createErrorDetectorHandler();
      const event: NormalizedEvent = {
        id: 'event-1',
        type: 'thread_create',
        guildId: 'guild-1',
        channelId: 'channel-1',
        userId: 'user-1',
        timestamp: Date.now(),
        payload: {
          name: 'Error: Bug thread',
          parentChannelId: 'channel-1',
        },
      };

      const result = await handler.detectAndCreateThread(
        event,
        mockRedisStore,
        mockPostgresStore
      );

      expect(result).toBeNull();
    });
  });
});

describe('Debate Manager Unit Tests', () => {
  let mockArchitect: Agent;
  let mockReviewer: Agent;

  beforeEach(() => {
    mockArchitect = {
      role: 'architect',
      execute: vi.fn().mockResolvedValue({
        role: 'architect',
        output: 'Architect position: We should use microservices',
        success: true,
      } as AgentResult),
    };

    mockReviewer = {
      role: 'reviewer',
      execute: vi.fn().mockResolvedValue({
        role: 'reviewer',
        output: 'Reviewer position: Monolith might be simpler',
        success: true,
      } as AgentResult),
    };
  });

  describe('startDebate', () => {
    it('should alternate between participants', async () => {
      const debateManager = createDebateManager({ maxTurns: 4 });
      const agents = new Map<string, Agent>([
        ['architect', mockArchitect],
        ['reviewer', mockReviewer],
      ]);

      const result = await debateManager.startDebate(
        'Architecture decision',
        'Building a new service',
        agents as any
      );

      expect(result.turns.length).toBe(4);
      expect(result.turns[0].agent).toBe('architect');
      expect(result.turns[1].agent).toBe('reviewer');
      expect(result.turns[2].agent).toBe('architect');
      expect(result.turns[3].agent).toBe('reviewer');
    });

    it('should stop early on consensus', async () => {
      const consensusArchitect: Agent = {
        role: 'architect',
        execute: vi.fn().mockResolvedValue({
          role: 'architect',
          output: 'CONSENSUS REACHED: We agree to use a modular monolith',
          success: true,
        } as AgentResult),
      };

      const debateManager = createDebateManager({ maxTurns: 10 });
      const agents = new Map<string, Agent>([
        ['architect', consensusArchitect],
        ['reviewer', mockReviewer],
      ]);

      const result = await debateManager.startDebate(
        'Architecture decision',
        'Building a new service',
        agents as any
      );

      expect(result.consensus).toBe(true);
      expect(result.turns.length).toBe(1);
      expect(result.summary).toContain('consensus');
    });

    it('should generate no-consensus summary when limit reached', async () => {
      const debateManager = createDebateManager({ maxTurns: 2 });
      const agents = new Map<string, Agent>([
        ['architect', mockArchitect],
        ['reviewer', mockReviewer],
      ]);

      const result = await debateManager.startDebate(
        'Architecture decision',
        'Building a new service',
        agents as any
      );

      expect(result.consensus).toBe(false);
      expect(result.summary).toContain('without consensus');
      expect(result.summary).toContain('USER ACTION REQUIRED');
    });

    it('should throw error if agent not found', async () => {
      const debateManager = createDebateManager();
      const agents = new Map<string, Agent>([
        ['architect', mockArchitect],
        // Missing reviewer
      ]);

      await expect(
        debateManager.startDebate(
          'Architecture decision',
          'Building a new service',
          agents as any
        )
      ).rejects.toThrow('Agent not found');
    });

    it('should record timestamps for each turn', async () => {
      const debateManager = createDebateManager({ maxTurns: 2 });
      const agents = new Map<string, Agent>([
        ['architect', mockArchitect],
        ['reviewer', mockReviewer],
      ]);

      const result = await debateManager.startDebate(
        'Test topic',
        'Test context',
        agents as any
      );

      for (const turn of result.turns) {
        expect(turn.timestamp).toBeDefined();
        expect(turn.timestamp).toBeGreaterThan(0);
      }
    });
  });

  describe('consensus detection', () => {
    it('should detect various consensus phrases', async () => {
      const consensusPhrases = [
        'CONSENSUS REACHED',
        'We agree on the approach',
        'Agreed approach: use TypeScript',
        'We found common ground',
        'Mutual agreement achieved',
      ];

      for (const phrase of consensusPhrases) {
        const consensusAgent: Agent = {
          role: 'architect',
          execute: vi.fn().mockResolvedValue({
            role: 'architect',
            output: phrase,
            success: true,
          } as AgentResult),
        };

        const debateManager = createDebateManager({ maxTurns: 10 });
        const agents = new Map<string, Agent>([
          ['architect', consensusAgent],
          ['reviewer', mockReviewer],
        ]);

        const result = await debateManager.startDebate(
          'Test',
          'Context',
          agents as any
        );

        expect(result.consensus).toBe(true);
      }
    });
  });
});

describe('Smoke Tests for Advanced Features', () => {
  it('should have correct AUTO_SUMMARY_THRESHOLD', () => {
    expect(AUTO_SUMMARY_THRESHOLD).toBe(15);
  });

  it('should have correct DEBATE_MAX_TURNS', () => {
    expect(DEBATE_MAX_TURNS).toBe(4);
  });

  it('should export all factory functions', () => {
    expect(createAutoSummaryHandler).toBeDefined();
    expect(createErrorDetectorHandler).toBeDefined();
    expect(createDebateManager).toBeDefined();
  });
});
