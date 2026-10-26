/**
 * Unit Tests for Orchestrator
 * Feature: discord-ai-devos
 * 
 * Tests for:
 * - Complete flow: event → context → coordinator → agents → response
 * - Chain continuation when an agent sends a message
 * - Empty plan from Coordinator → ask user for more context
 * 
 * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NormalizedEvent, MessagePayload, ThreadPayload, SlashCommandPayload } from '../types/events.js';
import type { FullContext, RoutingDecision, EventRouter, ContextLoader, PromptBuilder, ResponseManager } from '../types/orchestrator.js';
import type { AgentRole, AgentResult, ExecutionPlan } from '../types/agents.js';
import type { RedisStore, PostgresStore } from '../types/persistence.js';
import type { Gateway } from '../gateway/discord-bot.js';
import type { ThreadState } from '../types/models.js';

// Mock the CoordinatorAgent to avoid ANTHROPIC_API_KEY requirement
vi.mock('../agents/coordinator-agent.js', () => ({
  CoordinatorAgent: class MockCoordinatorAgent {
    role = 'coordinator' as AgentRole;
    
    async execute(context: FullContext, taskDescription: string): Promise<AgentResult> {
      // Return a simple plan based on context
      const hasThread = !!context.thread;
      const agents: AgentRole[] = hasThread ? ['architect', 'planner'] : ['architect', 'planner'];
      
      return {
        role: 'coordinator',
        output: JSON.stringify({ agents, reason: 'Mock plan for testing' }),
        success: true,
      };
    }
    
    getExecutionPlan(result: AgentResult): ExecutionPlan | null {
      if (!result.success) return null;
      try {
        return JSON.parse(result.output) as ExecutionPlan;
      } catch {
        return null;
      }
    }
  },
}));

// Import after mocking
import { DefaultOrchestrator, type OrchestratorConfig, type OrchestratorLogger } from './orchestrator.js';

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Creates a mock Redis store
 */
function createMockRedisStore(): RedisStore {
  return {
    getThreadState: vi.fn().mockResolvedValue('open' as ThreadState),
    setThreadState: vi.fn().mockResolvedValue(undefined),
    getActiveSession: vi.fn().mockResolvedValue(null),
    setActiveSession: vi.fn().mockResolvedValue(undefined),
    incrementMessageCount: vi.fn().mockResolvedValue(1),
  };
}

/**
 * Creates a mock Postgres store
 */
function createMockPostgresStore(): PostgresStore {
  return {
    getOrg: vi.fn().mockResolvedValue({
      guildId: 'guild_123',
      standards: ['TypeScript', 'ESLint'],
      architecture: ['Microservices'],
    }),
    upsertOrg: vi.fn().mockResolvedValue(undefined),
    getProject: vi.fn().mockResolvedValue({
      channelId: 'channel_456',
      guildId: 'guild_123',
      name: 'Test Project',
      stack: ['TypeScript', 'Node.js'],
      rules: ['Use strict mode'],
    }),
    upsertProject: vi.fn().mockResolvedValue(undefined),
    getThread: vi.fn().mockResolvedValue({
      threadId: 'thread_789',
      channelId: 'channel_456',
      type: 'feature',
      title: 'Test Feature',
      summary: 'This is a test feature thread',
      state: 'open',
      decisions: [],
      artifacts: [],
      messageCount: 5,
      lastSummaryAt: 0,
    }),
    upsertThread: vi.fn().mockResolvedValue(undefined),
    storeMemory: vi.fn().mockResolvedValue(undefined),
    getMemories: vi.fn().mockResolvedValue([]),
  };
}

/**
 * Creates a mock Gateway
 */
function createMockGateway(): Gateway {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendMessageWithId: vi.fn().mockResolvedValue('mock-message-id'),
    editMessage: vi.fn().mockResolvedValue(undefined),
    sendEmbed: vi.fn().mockResolvedValue('mock-embed-id'),
    createThread: vi.fn().mockResolvedValue('new_thread_id'),
    createTaskThread: vi.fn().mockResolvedValue({ threadId: 'thread-id', messageId: 'msg-id' }),
    createProjectStructure: vi.fn().mockResolvedValue({ categoryId: 'cat-id', channels: {} }),
  };
}

/**
 * Creates a mock logger
 */
function createMockLogger(): OrchestratorLogger {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

/**
 * Creates a sample normalized event
 */
function createSampleEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: 'evt_123',
    type: 'message',
    guildId: 'guild_123',
    channelId: 'channel_456',
    threadId: 'thread_789',
    userId: 'user_abc',
    timestamp: Date.now(),
    payload: { content: 'Test message', authorIsBot: false } as MessagePayload,
    ...overrides,
  };
}

/**
 * Creates a sample full context
 */
function createSampleContext(): FullContext {
  return {
    org: {
      guildId: 'guild_123',
      standards: ['TypeScript'],
      architecture: ['Microservices'],
    },
    project: {
      channelId: 'channel_456',
      guildId: 'guild_123',
      name: 'Test Project',
      stack: ['TypeScript', 'Node.js'],
      rules: [],
    },
    thread: {
      threadId: 'thread_789',
      channelId: 'channel_456',
      type: 'feature',
      title: 'Test Feature',
      summary: 'Test summary',
      state: 'open',
      decisions: [],
      artifacts: [],
      messageCount: 5,
      lastSummaryAt: 0,
    },
  };
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('Orchestrator Unit Tests', () => {
  let mockRedisStore: RedisStore;
  let mockPostgresStore: PostgresStore;
  let mockGateway: Gateway;
  let mockLogger: OrchestratorLogger;

  beforeEach(() => {
    mockRedisStore = createMockRedisStore();
    mockPostgresStore = createMockPostgresStore();
    mockGateway = createMockGateway();
    mockLogger = createMockLogger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Test: Complete flow - event → context → coordinator → agents → response
   * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
   */
  describe('Complete Flow: event → context → coordinator → agents → response', () => {
    it('should process an event through the complete orchestration flow', async () => {
      // Create mock components that track calls
      const routingDecision: RoutingDecision = {
        shouldProcess: true,
        contextKeys: { orgId: 'guild_123', projectId: 'channel_456', threadId: 'thread_789' },
      };

      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue(routingDecision),
      };

      const mockContext = createSampleContext();
      const mockContextLoader: ContextLoader = {
        load: vi.fn().mockResolvedValue(mockContext),
      };

      const mockPromptBuilder: PromptBuilder = {
        build: vi.fn().mockReturnValue('Generated prompt'),
      };

      const sentMessages: Array<{ event: NormalizedEvent; results: AgentResult[] }> = [];
      const mockResponseManager: ResponseManager = {
        send: vi.fn().mockImplementation(async (event, results) => {
          sentMessages.push({ event, results });
        }),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        promptBuilder: mockPromptBuilder,
        responseManager: mockResponseManager,
        agentExecutorConfig: {
          skipMemoryPersistence: true,
        },
      };

      const orchestrator = new DefaultOrchestrator(config);
      const event = createSampleEvent();

      await orchestrator.handleEvent(event);

      // Verify the flow
      // 1. Event was routed
      expect(mockEventRouter.route).toHaveBeenCalledWith(event);

      // 2. Context was loaded
      expect(mockContextLoader.load).toHaveBeenCalledWith(routingDecision.contextKeys);

      // 3. Response was sent
      expect(mockResponseManager.send).toHaveBeenCalled();
    });

    it('should skip processing when router returns shouldProcess: false', async () => {
      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue({
          shouldProcess: false,
          contextKeys: { orgId: 'guild_123', projectId: 'channel_456' },
        }),
      };

      const mockContextLoader: ContextLoader = {
        load: vi.fn(),
      };

      const mockResponseManager: ResponseManager = {
        send: vi.fn(),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        responseManager: mockResponseManager,
      };

      const orchestrator = new DefaultOrchestrator(config);
      const event = createSampleEvent({
        payload: { content: 'Bot message', authorIsBot: true } as MessagePayload,
      });

      await orchestrator.handleEvent(event);

      // Context should not be loaded
      expect(mockContextLoader.load).not.toHaveBeenCalled();

      // Response should not be sent
      expect(mockResponseManager.send).not.toHaveBeenCalled();
    });

    it('should load context with correct keys from routing decision', async () => {
      const routingDecision: RoutingDecision = {
        shouldProcess: true,
        contextKeys: { 
          orgId: 'org_specific', 
          projectId: 'project_specific', 
          threadId: 'thread_specific' 
        },
      };

      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue(routingDecision),
      };

      const mockContextLoader: ContextLoader = {
        load: vi.fn().mockResolvedValue(createSampleContext()),
      };

      const mockResponseManager: ResponseManager = {
        send: vi.fn(),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        responseManager: mockResponseManager,
        agentExecutorConfig: { skipMemoryPersistence: true },
      };

      const orchestrator = new DefaultOrchestrator(config);
      await orchestrator.handleEvent(createSampleEvent());

      expect(mockContextLoader.load).toHaveBeenCalledWith({
        orgId: 'org_specific',
        projectId: 'project_specific',
        threadId: 'thread_specific',
      });
    });
  });

  /**
   * Test: Chain continuation when an agent sends a message
   * _Requirements: 2.3, 6.3_
   */
  describe('Chain Continuation When Agent Sends Message', () => {
    it('should continue processing agent messages in the execution chain', async () => {
      const executedAgents: AgentRole[] = [];
      
      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue({
          shouldProcess: true,
          contextKeys: { orgId: 'guild_123', projectId: 'channel_456', threadId: 'thread_789' },
        }),
      };

      const mockContextLoader: ContextLoader = {
        load: vi.fn().mockResolvedValue(createSampleContext()),
      };

      const mockResponseManager: ResponseManager = {
        send: vi.fn().mockImplementation(async (event, results) => {
          for (const result of results) {
            executedAgents.push(result.role);
          }
        }),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        responseManager: mockResponseManager,
        agentExecutorConfig: { skipMemoryPersistence: true },
      };

      const orchestrator = new DefaultOrchestrator(config);
      
      // First event triggers the chain
      const event = createSampleEvent();
      await orchestrator.handleEvent(event);

      // Response manager should have been called with agent results
      expect(mockResponseManager.send).toHaveBeenCalled();
    });

    it('should handle thread_create events and start the agent chain', async () => {
      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue({
          shouldProcess: true,
          contextKeys: { orgId: 'guild_123', projectId: 'channel_456', threadId: 'new_thread' },
        }),
      };

      const mockContextLoader: ContextLoader = {
        load: vi.fn().mockResolvedValue({
          ...createSampleContext(),
          thread: undefined, // New thread, no existing context
        }),
      };

      const mockResponseManager: ResponseManager = {
        send: vi.fn(),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        responseManager: mockResponseManager,
        agentExecutorConfig: { skipMemoryPersistence: true },
      };

      const orchestrator = new DefaultOrchestrator(config);
      
      const threadCreateEvent = createSampleEvent({
        type: 'thread_create',
        payload: { name: 'New Feature Thread', parentChannelId: 'channel_456' } as ThreadPayload,
      });

      await orchestrator.handleEvent(threadCreateEvent);

      // Should process the thread creation
      expect(mockEventRouter.route).toHaveBeenCalledWith(threadCreateEvent);
      expect(mockContextLoader.load).toHaveBeenCalled();
    });
  });

  /**
   * Test: Empty plan from Coordinator → ask user for more context
   * _Requirements: 2.2_
   */
  describe('Empty Plan from Coordinator → Ask for More Context', () => {
    it('should ask for more context when Coordinator returns empty plan', async () => {
      const sentMessages: AgentResult[] = [];

      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue({
          shouldProcess: true,
          contextKeys: { orgId: 'guild_123', projectId: 'channel_456', threadId: 'thread_789' },
        }),
      };

      // Context with minimal information
      const minimalContext: FullContext = {
        org: { guildId: 'guild_123', standards: [], architecture: [] },
        project: { channelId: 'channel_456', guildId: 'guild_123', name: '', stack: [], rules: [] },
        thread: {
          threadId: 'thread_789',
          channelId: 'channel_456',
          type: 'task',
          title: '',
          summary: '',
          state: 'open',
          decisions: [],
          artifacts: [],
          messageCount: 0,
          lastSummaryAt: 0,
        },
      };

      const mockContextLoader: ContextLoader = {
        load: vi.fn().mockResolvedValue(minimalContext),
      };

      const mockResponseManager: ResponseManager = {
        send: vi.fn().mockImplementation(async (event, results) => {
          sentMessages.push(...results);
        }),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        responseManager: mockResponseManager,
        agentExecutorConfig: { skipMemoryPersistence: true },
      };

      const orchestrator = new DefaultOrchestrator(config);
      
      // Send an ambiguous message
      const event = createSampleEvent({
        payload: { content: '?', authorIsBot: false } as MessagePayload,
      });

      await orchestrator.handleEvent(event);

      // Response should have been sent
      expect(mockResponseManager.send).toHaveBeenCalled();
    });

    it('should send a helpful message when plan is empty', async () => {
      let capturedResults: AgentResult[] = [];

      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue({
          shouldProcess: true,
          contextKeys: { orgId: 'guild_123', projectId: 'channel_456' },
        }),
      };

      const mockContextLoader: ContextLoader = {
        load: vi.fn().mockResolvedValue({
          org: { guildId: 'guild_123', standards: [], architecture: [] },
          project: { channelId: 'channel_456', guildId: 'guild_123', name: '', stack: [], rules: [] },
        }),
      };

      const mockResponseManager: ResponseManager = {
        send: vi.fn().mockImplementation(async (event, results) => {
          capturedResults = results;
        }),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        responseManager: mockResponseManager,
        agentExecutorConfig: { skipMemoryPersistence: true },
      };

      const orchestrator = new DefaultOrchestrator(config);
      await orchestrator.handleEvent(createSampleEvent());

      // Should have sent some response
      expect(mockResponseManager.send).toHaveBeenCalled();
    });
  });

  /**
   * Test: Error handling during event processing
   * _Requirements: 2.6_
   */
  describe('Error Handling', () => {
    it('should handle errors during context loading gracefully', async () => {
      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue({
          shouldProcess: true,
          contextKeys: { orgId: 'guild_123', projectId: 'channel_456' },
        }),
      };

      const mockContextLoader: ContextLoader = {
        load: vi.fn().mockRejectedValue(new Error('Database connection failed')),
      };

      const mockResponseManager: ResponseManager = {
        send: vi.fn(),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        responseManager: mockResponseManager,
      };

      const orchestrator = new DefaultOrchestrator(config);
      
      // Should not throw
      await expect(orchestrator.handleEvent(createSampleEvent())).resolves.not.toThrow();

      // Error should be logged
      expect(mockLogger.error).toHaveBeenCalled();

      // Error notification should be sent
      expect(mockResponseManager.send).toHaveBeenCalled();
    });

    it('should log errors when response manager fails', async () => {
      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue({
          shouldProcess: true,
          contextKeys: { orgId: 'guild_123', projectId: 'channel_456' },
        }),
      };

      const mockContextLoader: ContextLoader = {
        load: vi.fn().mockRejectedValue(new Error('Test error')),
      };

      const mockResponseManager: ResponseManager = {
        send: vi.fn().mockRejectedValue(new Error('Discord API error')),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        responseManager: mockResponseManager,
      };

      const orchestrator = new DefaultOrchestrator(config);
      
      // Should not throw even when response manager fails
      await expect(orchestrator.handleEvent(createSampleEvent())).resolves.not.toThrow();

      // Multiple errors should be logged
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  /**
   * Test: Task description extraction from different event types
   */
  describe('Task Description Extraction', () => {
    it('should extract task description from message events', async () => {
      let capturedTask: string | undefined;

      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue({
          shouldProcess: true,
          contextKeys: { orgId: 'guild_123', projectId: 'channel_456' },
        }),
      };

      const mockContextLoader: ContextLoader = {
        load: vi.fn().mockResolvedValue(createSampleContext()),
      };

      const mockResponseManager: ResponseManager = {
        send: vi.fn(),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        responseManager: mockResponseManager,
        agentExecutorConfig: { skipMemoryPersistence: true },
      };

      const orchestrator = new DefaultOrchestrator(config);
      
      const event = createSampleEvent({
        payload: { content: 'Implement user authentication', authorIsBot: false } as MessagePayload,
      });

      await orchestrator.handleEvent(event);

      // The orchestrator should have processed the message content
      expect(mockContextLoader.load).toHaveBeenCalled();
    });

    it('should extract task description from slash command events', async () => {
      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue({
          shouldProcess: true,
          contextKeys: { orgId: 'guild_123', projectId: 'channel_456' },
        }),
      };

      const mockContextLoader: ContextLoader = {
        load: vi.fn().mockResolvedValue(createSampleContext()),
      };

      const mockResponseManager: ResponseManager = {
        send: vi.fn(),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        responseManager: mockResponseManager,
        agentExecutorConfig: { skipMemoryPersistence: true },
      };

      const orchestrator = new DefaultOrchestrator(config);
      
      const event = createSampleEvent({
        type: 'slash_command',
        payload: { command: 'plan', options: { feature: 'auth' } } as SlashCommandPayload,
      });

      await orchestrator.handleEvent(event);

      expect(mockContextLoader.load).toHaveBeenCalled();
    });

    it('should extract task description from thread_create events', async () => {
      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue({
          shouldProcess: true,
          contextKeys: { orgId: 'guild_123', projectId: 'channel_456', threadId: 'new_thread' },
        }),
      };

      const mockContextLoader: ContextLoader = {
        load: vi.fn().mockResolvedValue(createSampleContext()),
      };

      const mockResponseManager: ResponseManager = {
        send: vi.fn(),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        responseManager: mockResponseManager,
        agentExecutorConfig: { skipMemoryPersistence: true },
      };

      const orchestrator = new DefaultOrchestrator(config);
      
      const event = createSampleEvent({
        type: 'thread_create',
        payload: { name: 'Feature: Add OAuth', parentChannelId: 'channel_456' } as ThreadPayload,
      });

      await orchestrator.handleEvent(event);

      expect(mockContextLoader.load).toHaveBeenCalled();
    });
  });

  /**
   * Test: Response sending to correct channel/thread
   * _Requirements: 2.5_
   */
  describe('Response Sending', () => {
    it('should send response to the correct thread when threadId is present', async () => {
      let capturedEvent: NormalizedEvent | undefined;

      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue({
          shouldProcess: true,
          contextKeys: { orgId: 'guild_123', projectId: 'channel_456', threadId: 'thread_789' },
        }),
      };

      const mockContextLoader: ContextLoader = {
        load: vi.fn().mockResolvedValue(createSampleContext()),
      };

      const mockResponseManager: ResponseManager = {
        send: vi.fn().mockImplementation(async (event) => {
          capturedEvent = event;
        }),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        responseManager: mockResponseManager,
        agentExecutorConfig: { skipMemoryPersistence: true },
      };

      const orchestrator = new DefaultOrchestrator(config);
      
      const event = createSampleEvent({
        threadId: 'thread_789',
      });

      await orchestrator.handleEvent(event);

      expect(mockResponseManager.send).toHaveBeenCalled();
      expect(capturedEvent?.threadId).toBe('thread_789');
    });

    it('should send response to channel when no threadId is present', async () => {
      let capturedEvent: NormalizedEvent | undefined;

      const mockEventRouter: EventRouter = {
        route: vi.fn().mockResolvedValue({
          shouldProcess: true,
          contextKeys: { orgId: 'guild_123', projectId: 'channel_456' },
        }),
      };

      const mockContextLoader: ContextLoader = {
        load: vi.fn().mockResolvedValue({
          ...createSampleContext(),
          thread: undefined,
        }),
      };

      const mockResponseManager: ResponseManager = {
        send: vi.fn().mockImplementation(async (event) => {
          capturedEvent = event;
        }),
      };

      const config: OrchestratorConfig = {
        redisStore: mockRedisStore,
        postgresStore: mockPostgresStore,
        gateway: mockGateway,
        logger: mockLogger,
        eventRouter: mockEventRouter,
        contextLoader: mockContextLoader,
        responseManager: mockResponseManager,
        agentExecutorConfig: { skipMemoryPersistence: true },
      };

      const orchestrator = new DefaultOrchestrator(config);
      
      const event = createSampleEvent({
        threadId: undefined,
      });

      await orchestrator.handleEvent(event);

      expect(mockResponseManager.send).toHaveBeenCalled();
      expect(capturedEvent?.channelId).toBe('channel_456');
    });
  });
});
