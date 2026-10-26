/**
 * Agent Unit Tests
 * 
 * Tests for the Memory Agent and Coordinator Agent implementations.
 * Also includes smoke tests for all 8 agent roles.
 * @validates Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.12
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { MemoryAgent } from './memory-agent.js';
import { CoordinatorAgent } from './coordinator-agent.js';
import { isAgentRegistered, getRegisteredRoles, AgentFactory, AGENT_ROLES } from './agent-factory.js';
import type { FullContext } from '../types/orchestrator.js';
import type { AgentResult, ExecutionPlan, AgentRole } from '../types/agents.js';
import type { ThreadContext, Artifact, Decision } from '../types/models.js';

// Import all agents to ensure they register themselves with the factory
import './architect-agent.js';
import './planner-agent.js';
import './developer-agent.js';
import './reviewer-agent.js';
import './qa-agent.js';
import './devops-agent.js';

// Mock environment variables before importing modules that need them
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = 'test-api-key';
  process.env.DISCORD_TOKEN = 'test-discord-token';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
  process.env.GITHUB_TOKEN = 'test-github-token';
});

afterAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DISCORD_TOKEN;
  delete process.env.REDIS_URL;
  delete process.env.DATABASE_URL;
  delete process.env.GITHUB_TOKEN;
});

describe('Memory Agent', () => {
  describe('Agent Registration', () => {
    it('should be registered with the AgentFactory', () => {
      expect(isAgentRegistered('memory')).toBe(true);
    });

    it('should be included in registered roles', () => {
      const roles = getRegisteredRoles();
      expect(roles).toContain('memory');
    });

    it('should be creatable via AgentFactory', () => {
      const factory = AgentFactory.getInstance();
      expect(factory.canCreate('memory')).toBe(true);
      
      const agent = factory.createAgent('memory');
      expect(agent).toBeInstanceOf(MemoryAgent);
      expect(agent.role).toBe('memory');
    });
  });

  describe('MemoryAgent Class', () => {
    let agent: MemoryAgent;

    beforeEach(() => {
      agent = new MemoryAgent();
    });

    it('should have role "memory"', () => {
      expect(agent.role).toBe('memory');
    });

    it('should have getMemoryExtraction method', () => {
      expect(typeof agent.getMemoryExtraction).toBe('function');
    });

    it('should have getPersistenceData method', () => {
      expect(typeof agent.getPersistenceData).toBe('function');
    });

    it('should return null for getMemoryExtraction with failed result', () => {
      const failedResult: AgentResult = {
        role: 'memory',
        output: '',
        success: false,
        error: 'Test error',
      };
      expect(agent.getMemoryExtraction(failedResult)).toBeNull();
    });

    it('should return null for getPersistenceData with failed result', () => {
      const failedResult: AgentResult = {
        role: 'memory',
        output: '',
        success: false,
        error: 'Test error',
      };
      expect(agent.getPersistenceData(failedResult)).toBeNull();
    });

    it('should return null for getMemoryExtraction with no structured data', () => {
      const resultWithoutStructured: AgentResult = {
        role: 'memory',
        output: 'Some output',
        success: true,
      };
      expect(agent.getMemoryExtraction(resultWithoutStructured)).toBeNull();
    });

    it('should return extraction data from successful result', () => {
      const mockExtraction = {
        memories: [
          {
            type: 'decision' as const,
            content: { title: 'Test decision' },
            tags: ['test'],
            importance: 'high' as const,
          },
        ],
        metadata: {
          extractedAt: new Date().toISOString(),
          sourceMessages: 5,
          confidence: 0.8,
        },
      };

      const successResult: AgentResult = {
        role: 'memory',
        output: 'JSON output',
        success: true,
        structured: {
          extraction: mockExtraction,
          persistence: { entries: [], vectorMetadata: [] },
        },
      };

      const extraction = agent.getMemoryExtraction(successResult);
      expect(extraction).toEqual(mockExtraction);
    });

    it('should return persistence data from successful result', () => {
      const mockPersistence = {
        entries: [
          {
            id: 'mem_test_decision_123_abc',
            threadId: 'thread-1',
            type: 'decision' as const,
            content: { title: 'Test' },
            timestamp: Date.now(),
          },
        ],
        vectorMetadata: [
          {
            threadId: 'thread-1',
            type: 'decision' as const,
            content: '[DECISION] Test',
            timestamp: Date.now(),
          },
        ],
      };

      const successResult: AgentResult = {
        role: 'memory',
        output: 'JSON output',
        success: true,
        structured: {
          extraction: { memories: [], metadata: {} },
          persistence: mockPersistence,
        },
      };

      const persistence = agent.getPersistenceData(successResult);
      expect(persistence).toEqual(mockPersistence);
    });
  });

  describe('Memory Extraction Parsing', () => {
    let agent: MemoryAgent;

    beforeEach(() => {
      agent = new MemoryAgent();
    });

    it('should parse valid JSON memory extraction', () => {
      // Access private method via prototype for testing
      const parseMethod = (agent as unknown as { parseMemoryExtraction: (output: string) => unknown }).parseMemoryExtraction.bind(agent);
      
      const validJson = JSON.stringify({
        memories: [
          {
            type: 'decision',
            content: { title: 'Test Decision', description: 'A test' },
            tags: ['test'],
            importance: 'high',
          },
        ],
        metadata: {
          extractedAt: '2024-01-01T00:00:00Z',
          sourceMessages: 10,
          confidence: 0.9,
        },
      });

      const result = parseMethod(validJson);
      expect(result).toBeDefined();
      expect((result as { memories: unknown[] }).memories).toHaveLength(1);
      expect((result as { memories: Array<{ type: string }> }).memories[0].type).toBe('decision');
    });

    it('should create fallback extraction for invalid JSON', () => {
      const parseMethod = (agent as unknown as { parseMemoryExtraction: (output: string) => unknown }).parseMemoryExtraction.bind(agent);
      
      const invalidOutput = 'This is not valid JSON but mentions a decisión importante';
      const result = parseMethod(invalidOutput);
      
      expect(result).toBeDefined();
      expect((result as { memories: unknown[] }).memories.length).toBeGreaterThan(0);
      expect((result as { metadata: { confidence: number } }).metadata.confidence).toBeLessThan(0.5);
    });

    it('should detect decision keywords in fallback extraction', () => {
      const parseMethod = (agent as unknown as { parseMemoryExtraction: (output: string) => unknown }).parseMemoryExtraction.bind(agent);
      
      const decisionOutput = 'Se decidió usar TypeScript para el proyecto';
      const result = parseMethod(decisionOutput);
      
      const memories = (result as { memories: Array<{ type: string }> }).memories;
      expect(memories.some(m => m.type === 'decision')).toBe(true);
    });

    it('should detect error keywords in fallback extraction', () => {
      const parseMethod = (agent as unknown as { parseMemoryExtraction: (output: string) => unknown }).parseMemoryExtraction.bind(agent);
      
      const errorOutput = 'Se encontró un error crítico en el sistema';
      const result = parseMethod(errorOutput);
      
      const memories = (result as { memories: Array<{ type: string }> }).memories;
      expect(memories.some(m => m.type === 'error')).toBe(true);
    });

    it('should detect pattern keywords in fallback extraction', () => {
      const parseMethod = (agent as unknown as { parseMemoryExtraction: (output: string) => unknown }).parseMemoryExtraction.bind(agent);
      
      const patternOutput = 'Se identificó un patrón de diseño útil';
      const result = parseMethod(patternOutput);
      
      const memories = (result as { memories: Array<{ type: string }> }).memories;
      expect(memories.some(m => m.type === 'pattern')).toBe(true);
    });

    it('should create summary fallback when no keywords detected', () => {
      const parseMethod = (agent as unknown as { parseMemoryExtraction: (output: string) => unknown }).parseMemoryExtraction.bind(agent);
      
      const genericOutput = 'Some generic text without specific keywords';
      const result = parseMethod(genericOutput);
      
      const memories = (result as { memories: Array<{ type: string }> }).memories;
      expect(memories.some(m => m.type === 'summary')).toBe(true);
    });
  });

  describe('Persistence Data Preparation', () => {
    let agent: MemoryAgent;

    beforeEach(() => {
      agent = new MemoryAgent();
    });

    it('should prepare MemoryEntry for PostgresStore', () => {
      const prepareMethod = (agent as unknown as { 
        preparePersistenceData: (
          extraction: { memories: Array<{ type: string; content: Record<string, unknown>; tags: string[]; importance: string }>; metadata: unknown },
          context: FullContext
        ) => { entries: Array<{ id: string; threadId: string; type: string; content: Record<string, unknown>; timestamp: number }> }
      }).preparePersistenceData.bind(agent);

      const extraction = {
        memories: [
          {
            type: 'decision' as const,
            content: { title: 'Test' },
            tags: ['test'],
            importance: 'high' as const,
          },
        ],
        metadata: {},
      };

      const context: FullContext = {
        org: { guildId: 'guild-1', standards: [], architecture: [] },
        project: { channelId: 'channel-1', guildId: 'guild-1', name: 'Test', stack: [], rules: [] },
        thread: {
          threadId: 'thread-1',
          channelId: 'channel-1',
          type: 'feature',
          title: 'Test Thread',
          summary: '',
          state: 'open',
          decisions: [],
          artifacts: [],
          messageCount: 0,
          lastSummaryAt: 0,
        },
      };

      const result = prepareMethod(extraction, context);
      
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].threadId).toBe('thread-1');
      expect(result.entries[0].type).toBe('decision');
      expect(result.entries[0].id).toMatch(/^mem_thread-1_decision_\d+_[a-z0-9]+$/);
    });

    it('should prepare VectorMetadata for VectorStore', () => {
      const prepareMethod = (agent as unknown as { 
        preparePersistenceData: (
          extraction: { memories: Array<{ type: string; content: Record<string, unknown>; tags: string[]; importance: string }>; metadata: unknown },
          context: FullContext
        ) => { vectorMetadata: Array<{ threadId: string; type: string; content: string; timestamp: number }> }
      }).preparePersistenceData.bind(agent);

      const extraction = {
        memories: [
          {
            type: 'error' as const,
            content: { description: 'Test error', cause: 'Unknown' },
            tags: ['bug'],
            importance: 'high' as const,
          },
        ],
        metadata: {},
      };

      const context: FullContext = {
        org: { guildId: 'guild-1', standards: [], architecture: [] },
        project: { channelId: 'channel-1', guildId: 'guild-1', name: 'Test', stack: [], rules: [] },
        thread: {
          threadId: 'thread-2',
          channelId: 'channel-1',
          type: 'bug',
          title: 'Bug Thread',
          summary: '',
          state: 'open',
          decisions: [],
          artifacts: [],
          messageCount: 0,
          lastSummaryAt: 0,
        },
      };

      const result = prepareMethod(extraction, context);
      
      expect(result.vectorMetadata).toHaveLength(1);
      expect(result.vectorMetadata[0].threadId).toBe('thread-2');
      expect(result.vectorMetadata[0].type).toBe('error');
      expect(result.vectorMetadata[0].content).toContain('[ERROR]');
      expect(result.vectorMetadata[0].content).toContain('Test error');
    });

    it('should handle context without thread', () => {
      const prepareMethod = (agent as unknown as { 
        preparePersistenceData: (
          extraction: { memories: Array<{ type: string; content: Record<string, unknown>; tags: string[]; importance: string }>; metadata: unknown },
          context: FullContext
        ) => { entries: Array<{ threadId: string }> }
      }).preparePersistenceData.bind(agent);

      const extraction = {
        memories: [
          {
            type: 'summary' as const,
            content: { currentState: 'Test' },
            tags: [],
            importance: 'low' as const,
          },
        ],
        metadata: {},
      };

      const context: FullContext = {
        org: { guildId: 'guild-1', standards: [], architecture: [] },
        project: { channelId: 'channel-1', guildId: 'guild-1', name: 'Test', stack: [], rules: [] },
      };

      const result = prepareMethod(extraction, context);
      
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].threadId).toBe('unknown');
    });
  });

  describe('Smoke Tests', () => {
    it('should have memory agent registered', () => {
      const roles = getRegisteredRoles();
      expect(roles).toContain('memory');
    });
  });
});

/**
 * Coordinator Agent Tests
 * 
 * Tests for Coordinator routing logic based on thread state.
 * @validates Requirements 4.2, 4.3, 4.4, 4.5
 */
describe('Coordinator Agent', () => {
  describe('Agent Registration', () => {
    it('should be registered with the AgentFactory', () => {
      expect(isAgentRegistered('coordinator')).toBe(true);
    });

    it('should be creatable via AgentFactory', () => {
      const factory = AgentFactory.getInstance();
      expect(factory.canCreate('coordinator')).toBe(true);
      
      const agent = factory.createAgent('coordinator');
      expect(agent).toBeInstanceOf(CoordinatorAgent);
      expect(agent.role).toBe('coordinator');
    });
  });

  describe('CoordinatorAgent Class', () => {
    let agent: CoordinatorAgent;

    beforeEach(() => {
      agent = new CoordinatorAgent();
    });

    it('should have role "coordinator"', () => {
      expect(agent.role).toBe('coordinator');
    });

    it('should have getExecutionPlan method', () => {
      expect(typeof agent.getExecutionPlan).toBe('function');
    });

    it('should return null for getExecutionPlan with failed result', () => {
      const failedResult: AgentResult = {
        role: 'coordinator',
        output: '',
        success: false,
        error: 'Test error',
      };
      expect(agent.getExecutionPlan(failedResult)).toBeNull();
    });

    it('should return null for getExecutionPlan with no structured data', () => {
      const resultWithoutStructured: AgentResult = {
        role: 'coordinator',
        output: 'Some output',
        success: true,
      };
      expect(agent.getExecutionPlan(resultWithoutStructured)).toBeNull();
    });

    it('should return null for getExecutionPlan with invalid structured data', () => {
      const resultWithInvalidStructured: AgentResult = {
        role: 'coordinator',
        output: 'Some output',
        success: true,
        structured: { invalid: 'data' },
      };
      expect(agent.getExecutionPlan(resultWithInvalidStructured)).toBeNull();
    });

    it('should return execution plan from successful result', () => {
      const mockPlan: ExecutionPlan = {
        agents: ['architect', 'planner'],
        reason: 'New thread requires architecture and planning',
      };

      const successResult: AgentResult = {
        role: 'coordinator',
        output: JSON.stringify(mockPlan),
        success: true,
        structured: mockPlan as unknown as Record<string, unknown>,
      };

      const plan = agent.getExecutionPlan(successResult);
      expect(plan).toEqual(mockPlan);
    });
  });

  describe('Routing Logic - Execution Plan Parsing', () => {
    let agent: CoordinatorAgent;

    beforeEach(() => {
      agent = new CoordinatorAgent();
    });

    it('should parse valid JSON execution plan', () => {
      // Access private method via prototype for testing
      const parseMethod = (agent as unknown as { parseExecutionPlan: (output: string) => ExecutionPlan }).parseExecutionPlan.bind(agent);
      
      const validJson = JSON.stringify({
        agents: ['architect', 'planner'],
        reason: 'New thread needs architecture',
      });

      const result = parseMethod(validJson);
      expect(result.agents).toEqual(['architect', 'planner']);
      expect(result.reason).toBe('New thread needs architecture');
    });

    it('should filter invalid agent roles from parsed plan', () => {
      const parseMethod = (agent as unknown as { parseExecutionPlan: (output: string) => ExecutionPlan }).parseExecutionPlan.bind(agent);
      
      const jsonWithInvalidRoles = JSON.stringify({
        agents: ['architect', 'invalid_role', 'planner', 'unknown'],
        reason: 'Test',
      });

      const result = parseMethod(jsonWithInvalidRoles);
      expect(result.agents).toEqual(['architect', 'planner']);
    });

    it('should create fallback plan when JSON parsing fails', () => {
      const parseMethod = (agent as unknown as { parseExecutionPlan: (output: string) => ExecutionPlan }).parseExecutionPlan.bind(agent);
      
      const invalidOutput = 'This is not valid JSON';
      const result = parseMethod(invalidOutput);
      
      expect(result.agents.length).toBeGreaterThan(0);
      expect(result.reason).toContain('Fallback');
    });

    it('should detect architect keyword in fallback plan', () => {
      const parseMethod = (agent as unknown as { parseExecutionPlan: (output: string) => ExecutionPlan }).parseExecutionPlan.bind(agent);
      
      const output = 'We need the architect to design the solution';
      const result = parseMethod(output);
      
      expect(result.agents).toContain('architect');
    });

    it('should detect developer keyword in fallback plan', () => {
      const parseMethod = (agent as unknown as { parseExecutionPlan: (output: string) => ExecutionPlan }).parseExecutionPlan.bind(agent);
      
      const output = 'The developer should implement the código';
      const result = parseMethod(output);
      
      expect(result.agents).toContain('developer');
    });

    it('should detect reviewer keyword in fallback plan', () => {
      const parseMethod = (agent as unknown as { parseExecutionPlan: (output: string) => ExecutionPlan }).parseExecutionPlan.bind(agent);
      
      const output = 'We need to review the code';
      const result = parseMethod(output);
      
      expect(result.agents).toContain('reviewer');
    });

    it('should detect qa keyword in fallback plan', () => {
      const parseMethod = (agent as unknown as { parseExecutionPlan: (output: string) => ExecutionPlan }).parseExecutionPlan.bind(agent);
      
      const output = 'We need to test the implementation';
      const result = parseMethod(output);
      
      expect(result.agents).toContain('qa');
    });

    it('should detect devops keyword in fallback plan', () => {
      const parseMethod = (agent as unknown as { parseExecutionPlan: (output: string) => ExecutionPlan }).parseExecutionPlan.bind(agent);
      
      const output = 'Ready to deploy the application';
      const result = parseMethod(output);
      
      expect(result.agents).toContain('devops');
    });

    it('should default to architect + planner when no keywords detected', () => {
      const parseMethod = (agent as unknown as { parseExecutionPlan: (output: string) => ExecutionPlan }).parseExecutionPlan.bind(agent);
      
      const genericOutput = 'Some generic text without specific keywords';
      const result = parseMethod(genericOutput);
      
      expect(result.agents).toContain('architect');
      expect(result.agents).toContain('planner');
    });
  });

  describe('Thread State Detection', () => {
    let agent: CoordinatorAgent;

    beforeEach(() => {
      agent = new CoordinatorAgent();
    });

    it('should detect thread has code when code artifact exists', () => {
      const threadHasCodeMethod = (agent as unknown as { 
        threadHasCode: (thread: ThreadContext) => boolean 
      }).threadHasCode.bind(agent);

      const threadWithCode: ThreadContext = {
        threadId: 'thread-1',
        channelId: 'channel-1',
        type: 'feature',
        title: 'Test',
        summary: '',
        state: 'in_progress',
        decisions: [],
        artifacts: [
          { id: 'art-1', type: 'code', content: 'const x = 1;', agentRole: 'developer', createdAt: Date.now() },
        ],
        messageCount: 5,
        lastSummaryAt: 0,
      };

      expect(threadHasCodeMethod(threadWithCode)).toBe(true);
    });

    it('should detect thread has no code when no code artifact exists', () => {
      const threadHasCodeMethod = (agent as unknown as { 
        threadHasCode: (thread: ThreadContext) => boolean 
      }).threadHasCode.bind(agent);

      const threadWithoutCode: ThreadContext = {
        threadId: 'thread-1',
        channelId: 'channel-1',
        type: 'feature',
        title: 'Test',
        summary: '',
        state: 'open',
        decisions: [],
        artifacts: [
          { id: 'art-1', type: 'plan', content: 'Task list', agentRole: 'planner', createdAt: Date.now() },
        ],
        messageCount: 3,
        lastSummaryAt: 0,
      };

      expect(threadHasCodeMethod(threadWithoutCode)).toBe(false);
    });

    it('should detect thread is approved when review artifact contains approve', () => {
      const threadIsApprovedMethod = (agent as unknown as { 
        threadIsApproved: (thread: ThreadContext) => boolean 
      }).threadIsApproved.bind(agent);

      const approvedThread: ThreadContext = {
        threadId: 'thread-1',
        channelId: 'channel-1',
        type: 'feature',
        title: 'Test',
        summary: '',
        state: 'review',
        decisions: [],
        artifacts: [
          { id: 'art-1', type: 'code', content: 'const x = 1;', agentRole: 'developer', createdAt: Date.now() },
          { id: 'art-2', type: 'review', content: 'LGTM! Approved for merge.', agentRole: 'reviewer', createdAt: Date.now() },
        ],
        messageCount: 10,
        lastSummaryAt: 0,
      };

      expect(threadIsApprovedMethod(approvedThread)).toBe(true);
    });

    it('should detect thread is approved when decision contains aprobado', () => {
      const threadIsApprovedMethod = (agent as unknown as { 
        threadIsApproved: (thread: ThreadContext) => boolean 
      }).threadIsApproved.bind(agent);

      const approvedThread: ThreadContext = {
        threadId: 'thread-1',
        channelId: 'channel-1',
        type: 'feature',
        title: 'Test',
        summary: '',
        state: 'review',
        decisions: [
          { id: 'dec-1', description: 'Código aprobado para producción', status: 'approved', madeBy: 'reviewer', createdAt: Date.now() },
        ],
        artifacts: [],
        messageCount: 8,
        lastSummaryAt: 0,
      };

      expect(threadIsApprovedMethod(approvedThread)).toBe(true);
    });

    it('should detect thread is not approved when no approval indicators', () => {
      const threadIsApprovedMethod = (agent as unknown as { 
        threadIsApproved: (thread: ThreadContext) => boolean 
      }).threadIsApproved.bind(agent);

      const notApprovedThread: ThreadContext = {
        threadId: 'thread-1',
        channelId: 'channel-1',
        type: 'feature',
        title: 'Test',
        summary: '',
        state: 'in_progress',
        decisions: [],
        artifacts: [
          { id: 'art-1', type: 'code', content: 'const x = 1;', agentRole: 'developer', createdAt: Date.now() },
        ],
        messageCount: 5,
        lastSummaryAt: 0,
      };

      expect(threadIsApprovedMethod(notApprovedThread)).toBe(false);
    });
  });

  describe('Context Summary Building', () => {
    let agent: CoordinatorAgent;

    beforeEach(() => {
      agent = new CoordinatorAgent();
    });

    it('should build context summary with organization info', () => {
      const buildContextSummaryMethod = (agent as unknown as { 
        buildContextSummary: (context: FullContext) => string 
      }).buildContextSummary.bind(agent);

      const context: FullContext = {
        org: { guildId: 'guild-123', standards: ['TypeScript', 'ESLint'], architecture: ['Microservices'] },
        project: { channelId: 'channel-1', guildId: 'guild-123', name: 'Test Project', stack: ['Node.js'], rules: [] },
      };

      const summary = buildContextSummaryMethod(context);
      
      expect(summary).toContain('guild-123');
      expect(summary).toContain('TypeScript');
      expect(summary).toContain('Microservices');
    });

    it('should build context summary with project info', () => {
      const buildContextSummaryMethod = (agent as unknown as { 
        buildContextSummary: (context: FullContext) => string 
      }).buildContextSummary.bind(agent);

      const context: FullContext = {
        org: { guildId: 'guild-1', standards: [], architecture: [] },
        project: { channelId: 'channel-456', guildId: 'guild-1', name: 'My Project', stack: ['React', 'TypeScript'], rules: ['No any types'] },
      };

      const summary = buildContextSummaryMethod(context);
      
      expect(summary).toContain('channel-456');
      expect(summary).toContain('My Project');
      expect(summary).toContain('React');
    });

    it('should indicate new thread when no thread context', () => {
      const buildContextSummaryMethod = (agent as unknown as { 
        buildContextSummary: (context: FullContext) => string 
      }).buildContextSummary.bind(agent);

      const context: FullContext = {
        org: { guildId: 'guild-1', standards: [], architecture: [] },
        project: { channelId: 'channel-1', guildId: 'guild-1', name: 'Test', stack: [], rules: [] },
      };

      const summary = buildContextSummaryMethod(context);
      
      expect(summary).toContain('hilo nuevo');
    });

    it('should include thread details when thread context exists', () => {
      const buildContextSummaryMethod = (agent as unknown as { 
        buildContextSummary: (context: FullContext) => string 
      }).buildContextSummary.bind(agent);

      const context: FullContext = {
        org: { guildId: 'guild-1', standards: [], architecture: [] },
        project: { channelId: 'channel-1', guildId: 'guild-1', name: 'Test', stack: [], rules: [] },
        thread: {
          threadId: 'thread-789',
          channelId: 'channel-1',
          type: 'feature',
          title: 'Add login feature',
          summary: 'Working on authentication',
          state: 'in_progress',
          decisions: [],
          artifacts: [],
          messageCount: 5,
          lastSummaryAt: 0,
        },
      };

      const summary = buildContextSummaryMethod(context);
      
      expect(summary).toContain('thread-789');
      expect(summary).toContain('feature');
      expect(summary).toContain('Add login feature');
      expect(summary).toContain('in_progress');
    });
  });
});

/**
 * Smoke Tests - All 8 Agent Roles
 * 
 * Verifies that all 8 agent roles are properly registered in the AgentFactory.
 * @validates Requirements 4.1
 */
describe('Agent Factory Smoke Tests', () => {
  describe('8 Roles Registration', () => {
    const expectedRoles: AgentRole[] = [
      'coordinator',
      'architect',
      'planner',
      'developer',
      'reviewer',
      'qa',
      'devops',
      'memory',
    ];

    it('should have exactly 8 agent roles defined in AGENT_ROLES constant', () => {
      expect(AGENT_ROLES).toHaveLength(8);
      expect(AGENT_ROLES).toEqual(expectedRoles);
    });

    it('should have all 8 roles registered in the factory', () => {
      const registeredRoles = getRegisteredRoles();
      
      expect(registeredRoles).toHaveLength(8);
      
      for (const role of expectedRoles) {
        expect(registeredRoles).toContain(role);
        expect(isAgentRegistered(role)).toBe(true);
      }
    });

    it('should be able to create agents for all 8 roles', () => {
      const factory = AgentFactory.getInstance();
      
      for (const role of expectedRoles) {
        expect(factory.canCreate(role)).toBe(true);
        
        const agent = factory.createAgent(role);
        expect(agent).toBeDefined();
        expect(agent.role).toBe(role);
      }
    });

    it('should cache agents when using getAgent', () => {
      const factory = AgentFactory.getInstance();
      factory.clearCache();
      
      const agent1 = factory.getAgent('coordinator');
      const agent2 = factory.getAgent('coordinator');
      
      expect(agent1).toBe(agent2); // Same instance
    });

    it('should create new instances when using createAgent', () => {
      const factory = AgentFactory.getInstance();
      
      const agent1 = factory.createAgent('memory');
      const agent2 = factory.createAgent('memory');
      
      expect(agent1).not.toBe(agent2); // Different instances
    });

    it('should throw error for unregistered role', () => {
      const factory = AgentFactory.getInstance();
      
      expect(() => factory.createAgent('invalid_role' as AgentRole)).toThrow('No agent registered for role: invalid_role');
    });

    it('should return false for canCreate with unregistered role', () => {
      const factory = AgentFactory.getInstance();
      
      expect(factory.canCreate('invalid_role' as AgentRole)).toBe(false);
    });

    it('should return all available roles via getAvailableRoles', () => {
      const factory = AgentFactory.getInstance();
      const availableRoles = factory.getAvailableRoles();
      
      expect(availableRoles).toHaveLength(8);
      for (const role of expectedRoles) {
        expect(availableRoles).toContain(role);
      }
    });
  });

  describe('Agent Role Verification', () => {
    it('coordinator agent should have correct role', () => {
      const factory = AgentFactory.getInstance();
      const agent = factory.createAgent('coordinator');
      expect(agent.role).toBe('coordinator');
    });

    it('architect agent should have correct role', () => {
      const factory = AgentFactory.getInstance();
      const agent = factory.createAgent('architect');
      expect(agent.role).toBe('architect');
    });

    it('planner agent should have correct role', () => {
      const factory = AgentFactory.getInstance();
      const agent = factory.createAgent('planner');
      expect(agent.role).toBe('planner');
    });

    it('developer agent should have correct role', () => {
      const factory = AgentFactory.getInstance();
      const agent = factory.createAgent('developer');
      expect(agent.role).toBe('developer');
    });

    it('reviewer agent should have correct role', () => {
      const factory = AgentFactory.getInstance();
      const agent = factory.createAgent('reviewer');
      expect(agent.role).toBe('reviewer');
    });

    it('qa agent should have correct role', () => {
      const factory = AgentFactory.getInstance();
      const agent = factory.createAgent('qa');
      expect(agent.role).toBe('qa');
    });

    it('devops agent should have correct role', () => {
      const factory = AgentFactory.getInstance();
      const agent = factory.createAgent('devops');
      expect(agent.role).toBe('devops');
    });

    it('memory agent should have correct role', () => {
      const factory = AgentFactory.getInstance();
      const agent = factory.createAgent('memory');
      expect(agent.role).toBe('memory');
    });
  });
});
