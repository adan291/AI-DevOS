/**
 * Property-Based Tests for Orchestrator
 * Feature: discord-ai-devos
 * 
 * Property 2: Construcción de prompts incluye todas las capas
 * **Validates: Requirements 3.1, 3.2, 3.4, 3.5**
 *
 * Property 3: Prompt usa resumen en lugar de historial completo
 * **Validates: Requirements 3.3, 8.3**
 *
 * Property 6: Ejecución secuencial del plan con persistencia
 * **Validates: Requirements 2.3, 2.4**
 *
 * Property 7: Continuidad del plan ante fallo de agente
 * **Validates: Requirements 2.6**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { DefaultPromptBuilder, GLOBAL_PROMPT, STEERING_RULES } from './prompt-builder.js';
import { DefaultAgentExecutor, type AgentExecutorConfig, type Logger, type DiscordNotifier } from './agent-executor.js';
import type { FullContext } from '../types/orchestrator.js';
import type { OrgContext, ProjectContext, ThreadContext, ThreadType, ThreadState, Artifact, Decision } from '../types/models.js';
import type { AgentRole, ExecutionPlan, AgentResult } from '../types/agents.js';
import { AgentFactory } from '../agents/agent-factory.js';

// ============================================================================
// Fast-Check Arbitraries (Generators) for FullContext
// ============================================================================

/**
 * Generates a Discord snowflake ID
 */
const snowflakeIdArb = fc.stringMatching(/^[0-9]{17,19}$/);

/**
 * Generates an AgentRole
 */
const agentRoleArb: fc.Arbitrary<AgentRole> = fc.constantFrom(
  'coordinator', 'architect', 'planner', 'developer', 'reviewer', 'qa', 'devops', 'memory'
);

/**
 * Generates an AgentRole excluding coordinator and memory (for execution plans)
 */
const executableAgentRoleArb: fc.Arbitrary<AgentRole> = fc.constantFrom(
  'architect', 'planner', 'developer', 'reviewer', 'qa', 'devops'
);

/**
 * Generates an OrgContext
 */
const orgContextArb: fc.Arbitrary<OrgContext> = fc.record({
  guildId: snowflakeIdArb,
  standards: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 5 }),
  architecture: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 5 }),
});

/**
 * Generates a ProjectContext
 */
const projectContextArb: fc.Arbitrary<ProjectContext> = fc.record({
  channelId: snowflakeIdArb,
  guildId: snowflakeIdArb,
  name: fc.string({ minLength: 1, maxLength: 50 }),
  stack: fc.array(fc.constantFrom('TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Redis'), { maxLength: 5 }),
  rules: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 5 }),
});

/**
 * Generates a valid ThreadType
 */
const threadTypeArb: fc.Arbitrary<ThreadType> = fc.constantFrom('feature', 'bug', 'pr', 'task');

/**
 * Generates a valid ThreadState
 */
const threadStateArb: fc.Arbitrary<ThreadState> = fc.constantFrom('open', 'in_progress', 'review', 'done');

/**
 * Generates a Decision
 */
const decisionArb: fc.Arbitrary<Decision> = fc.record({
  id: fc.string({ minLength: 5, maxLength: 20 }),
  description: fc.string({ minLength: 1, maxLength: 200 }),
  status: fc.constantFrom('pending', 'approved', 'rejected') as fc.Arbitrary<Decision['status']>,
  madeBy: agentRoleArb,
  createdAt: fc.integer({ min: 1609459200000, max: Date.now() }),
});

/**
 * Generates an Artifact
 */
const artifactArb: fc.Arbitrary<Artifact> = fc.record({
  id: fc.string({ minLength: 5, maxLength: 20 }),
  type: fc.constantFrom('code', 'plan', 'review', 'test', 'deployment') as fc.Arbitrary<Artifact['type']>,
  content: fc.string({ minLength: 1, maxLength: 500 }),
  agentRole: agentRoleArb,
  createdAt: fc.integer({ min: 1609459200000, max: Date.now() }),
});

/**
 * Generates a ThreadContext with a non-empty summary
 */
const threadContextWithSummaryArb: fc.Arbitrary<ThreadContext> = fc.record({
  threadId: snowflakeIdArb,
  channelId: snowflakeIdArb,
  type: threadTypeArb,
  title: fc.string({ minLength: 1, maxLength: 100 }),
  summary: fc.string({ minLength: 10, maxLength: 500 }), // Non-empty summary
  state: threadStateArb,
  decisions: fc.array(decisionArb, { maxLength: 3 }),
  artifacts: fc.array(artifactArb, { maxLength: 3 }),
  messageCount: fc.integer({ min: 15, max: 100 }), // Has messages
  lastSummaryAt: fc.integer({ min: 0, max: 50 }),
});

/**
 * Generates a ThreadContext with empty summary
 */
const threadContextWithoutSummaryArb: fc.Arbitrary<ThreadContext> = fc.record({
  threadId: snowflakeIdArb,
  channelId: snowflakeIdArb,
  type: threadTypeArb,
  title: fc.string({ minLength: 1, maxLength: 100 }),
  summary: fc.constant(''), // Empty summary
  state: threadStateArb,
  decisions: fc.array(decisionArb, { maxLength: 3 }),
  artifacts: fc.array(artifactArb, { maxLength: 3 }),
  messageCount: fc.integer({ min: 0, max: 14 }),
  lastSummaryAt: fc.integer({ min: 0, max: 10 }),
});

/**
 * Generates a basic ThreadContext
 */
const threadContextArb: fc.Arbitrary<ThreadContext> = fc.oneof(
  threadContextWithSummaryArb,
  threadContextWithoutSummaryArb
);

/**
 * Generates a FullContext without thread
 */
const fullContextNoThreadArb: fc.Arbitrary<FullContext> = fc.record({
  org: orgContextArb,
  project: projectContextArb,
});

/**
 * Generates a FullContext with thread
 */
const fullContextWithThreadArb: fc.Arbitrary<FullContext> = fc.record({
  org: orgContextArb,
  project: projectContextArb,
  thread: threadContextArb,
});

/**
 * Generates a FullContext with thread that has a summary
 */
const fullContextWithSummaryArb: fc.Arbitrary<FullContext> = fc.record({
  org: orgContextArb,
  project: projectContextArb,
  thread: threadContextWithSummaryArb,
});

/**
 * Generates any FullContext
 */
const anyFullContextArb: fc.Arbitrary<FullContext> = fc.oneof(
  fullContextNoThreadArb,
  fullContextWithThreadArb
);

/**
 * Generates a task description
 */
const taskDescriptionArb = fc.string({ minLength: 5, maxLength: 200 });

/**
 * Generates an ExecutionPlan with N agents
 */
const executionPlanArb: fc.Arbitrary<ExecutionPlan> = fc.record({
  agents: fc.array(executableAgentRoleArb, { minLength: 1, maxLength: 5 }),
  reason: fc.string({ minLength: 10, maxLength: 200 }),
});

// ============================================================================
// Property 2: Construcción de prompts incluye todas las capas
// **Validates: Requirements 3.1, 3.2, 3.4, 3.5**
// ============================================================================

describe('Property 2: Construcción de prompts incluye todas las capas', () => {
  let promptBuilder: DefaultPromptBuilder;

  beforeEach(() => {
    promptBuilder = new DefaultPromptBuilder();
  });

  /**
   * **Validates: Requirements 3.1**
   * 
   * Property: Every prompt must include the Global Prompt (Prompt_Global)
   */
  describe('Layer 1: Global Prompt (Requirement 3.1)', () => {
    it('should include the global prompt in every generated prompt', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyFullContextArb,
          agentRoleArb,
          taskDescriptionArb,
          async (context, role, task) => {
            const prompt = promptBuilder.build(context, role, task);
            
            // The prompt must contain the global prompt
            expect(prompt).toContain(GLOBAL_PROMPT);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.2**
   * 
   * Property: Every prompt must include context data (org, project, thread)
   */
  describe('Layer 2: Context Prompt (Requirement 3.2)', () => {
    it('should include organization context in the prompt', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyFullContextArb,
          agentRoleArb,
          taskDescriptionArb,
          async (context, role, task) => {
            const prompt = promptBuilder.build(context, role, task);
            
            // Must contain org guildId
            expect(prompt).toContain(context.org.guildId);
            
            // If org has standards, they should be included
            if (context.org.standards.length > 0) {
              expect(prompt).toContain('Estándares');
            }
            
            // If org has architecture, it should be included
            if (context.org.architecture.length > 0) {
              expect(prompt).toContain('Arquitectura');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include project context in the prompt', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyFullContextArb,
          agentRoleArb,
          taskDescriptionArb,
          async (context, role, task) => {
            const prompt = promptBuilder.build(context, role, task);
            
            // Must contain project channelId
            expect(prompt).toContain(context.project.channelId);
            
            // If project has name, it should be included
            if (context.project.name) {
              expect(prompt).toContain(context.project.name);
            }
            
            // If project has stack, it should be included
            if (context.project.stack.length > 0) {
              expect(prompt).toContain('Stack');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include thread context when present', async () => {
      await fc.assert(
        fc.asyncProperty(
          fullContextWithThreadArb,
          agentRoleArb,
          taskDescriptionArb,
          async (context, role, task) => {
            const prompt = promptBuilder.build(context, role, task);
            
            // Must contain thread section
            expect(prompt).toContain('Hilo');
            expect(prompt).toContain(context.thread!.threadId);
            expect(prompt).toContain(context.thread!.type);
            expect(prompt).toContain(context.thread!.state);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.4**
   * 
   * Property: Every prompt must include the role-specific prompt
   */
  describe('Layer 3: Role Prompt (Requirement 3.4)', () => {
    it('should include the role-specific prompt section', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyFullContextArb,
          agentRoleArb,
          taskDescriptionArb,
          async (context, role, task) => {
            const prompt = promptBuilder.build(context, role, task);
            
            // Must contain role section header
            const roleCapitalized = role.charAt(0).toUpperCase() + role.slice(1);
            expect(prompt).toContain(`Tu Rol: ${roleCapitalized}`);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.5**
   * 
   * Property: Every prompt must include steering rules
   */
  describe('Layer 4: Steering Rules (Requirement 3.5)', () => {
    it('should include steering rules in every prompt', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyFullContextArb,
          agentRoleArb,
          taskDescriptionArb,
          async (context, role, task) => {
            const prompt = promptBuilder.build(context, role, task);
            
            // Must contain steering rules
            expect(prompt).toContain(STEERING_RULES);
            expect(prompt).toContain('Reglas de Interpretación');
            expect(prompt).toContain('Inferencia de Intención');
            expect(prompt).toContain('Comportamiento Proactivo');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.4, 3.5**
   * 
   * Property: All 4 layers must be present in every prompt
   */
  describe('All 4 Layers Combined', () => {
    it('should contain all 4 layers in every generated prompt', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyFullContextArb,
          agentRoleArb,
          taskDescriptionArb,
          async (context, role, task) => {
            const prompt = promptBuilder.build(context, role, task);
            
            // Layer 1: Global prompt
            expect(prompt).toContain(GLOBAL_PROMPT);
            
            // Layer 2: Context (at minimum org and project)
            expect(prompt).toContain('Contexto Actual');
            expect(prompt).toContain('Organización');
            expect(prompt).toContain('Proyecto');
            
            // Layer 3: Role prompt
            expect(prompt).toContain('Tu Rol:');
            
            // Layer 4: Steering rules
            expect(prompt).toContain(STEERING_RULES);
            
            // Task description
            expect(prompt).toContain('Tarea Actual');
            expect(prompt).toContain(task);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should separate layers with delimiters', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyFullContextArb,
          agentRoleArb,
          taskDescriptionArb,
          async (context, role, task) => {
            const prompt = promptBuilder.build(context, role, task);
            
            // Layers should be separated by delimiter
            const delimiter = '---';
            const sections = prompt.split(delimiter);
            
            // Should have at least 5 sections (4 layers + task)
            expect(sections.length).toBeGreaterThanOrEqual(5);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});

// ============================================================================
// Property 3: Prompt usa resumen en lugar de historial completo
// **Validates: Requirements 3.3, 8.3**
// ============================================================================

describe('Property 3: Prompt usa resumen en lugar de historial completo', () => {
  let promptBuilder: DefaultPromptBuilder;

  beforeEach(() => {
    promptBuilder = new DefaultPromptBuilder();
  });

  /**
   * **Validates: Requirements 3.3, 8.3**
   * 
   * Property: When ThreadContext has a non-empty summary, the prompt must include
   * the summary and NOT include individual messages before the summary point.
   */
  describe('Summary Inclusion', () => {
    it('should include thread summary when present', async () => {
      await fc.assert(
        fc.asyncProperty(
          fullContextWithSummaryArb,
          agentRoleArb,
          taskDescriptionArb,
          async (context, role, task) => {
            const prompt = promptBuilder.build(context, role, task);
            
            // Must contain the summary
            expect(prompt).toContain(context.thread!.summary);
            
            // Must contain the summary section header
            expect(prompt).toContain('Resumen del Hilo');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should NOT include individual message markers when summary exists', async () => {
      await fc.assert(
        fc.asyncProperty(
          fullContextWithSummaryArb,
          agentRoleArb,
          taskDescriptionArb,
          async (context, role, task) => {
            const prompt = promptBuilder.build(context, role, task);
            
            // Should NOT contain markers for individual messages
            // The prompt builder uses summary instead of message history
            expect(prompt).not.toContain('Mensaje #');
            expect(prompt).not.toContain('Historial de Mensajes');
            expect(prompt).not.toContain('mensajes anteriores:');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.3**
   * 
   * Property: When summary is empty, the prompt should not include a summary section
   */
  describe('Empty Summary Handling', () => {
    it('should NOT include summary section when summary is empty', async () => {
      const contextWithEmptySummary: fc.Arbitrary<FullContext> = fc.record({
        org: orgContextArb,
        project: projectContextArb,
        thread: threadContextWithoutSummaryArb,
      });

      await fc.assert(
        fc.asyncProperty(
          contextWithEmptySummary,
          agentRoleArb,
          taskDescriptionArb,
          async (context, role, task) => {
            const prompt = promptBuilder.build(context, role, task);
            
            // Should NOT contain summary section when summary is empty
            expect(prompt).not.toContain('Resumen del Hilo');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.3, 8.3**
   * 
   * Property: Summary should be the primary source of thread history context
   */
  describe('Summary as Primary History Source', () => {
    it('should use summary as the primary representation of thread history', async () => {
      await fc.assert(
        fc.asyncProperty(
          fullContextWithSummaryArb,
          agentRoleArb,
          taskDescriptionArb,
          async (context, role, task) => {
            const prompt = promptBuilder.build(context, role, task);
            
            // The summary should appear in the thread section
            const threadSectionStart = prompt.indexOf('### Hilo');
            const summaryPosition = prompt.indexOf(context.thread!.summary);
            
            // Summary should be within the thread section
            expect(summaryPosition).toBeGreaterThan(threadSectionStart);
            
            // Summary should be the history representation, not raw messages
            expect(prompt).toContain(context.thread!.summary);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// ============================================================================
// Property 6: Ejecución secuencial del plan con persistencia
// **Validates: Requirements 2.3, 2.4**
// ============================================================================

describe('Property 6: Ejecución secuencial del plan con persistencia', () => {
  let mockLogger: Logger;
  let mockNotifier: DiscordNotifier;
  let executionOrder: AgentRole[];
  let memoryInvocations: AgentRole[];

  beforeEach(() => {
    executionOrder = [];
    memoryInvocations = [];
    
    mockLogger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    
    mockNotifier = {
      notifyError: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Creates a mock agent factory that tracks execution order
   */
  function createMockAgentFactory(shouldFail: Set<AgentRole> = new Set()): AgentFactory {
    const mockFactory = {
      getAgent: vi.fn().mockImplementation((role: AgentRole) => ({
        role,
        execute: vi.fn().mockImplementation(async () => {
          executionOrder.push(role);
          
          if (role === 'memory') {
            // Track which agent triggered memory
            const lastNonMemory = executionOrder.filter(r => r !== 'memory').pop();
            if (lastNonMemory) {
              memoryInvocations.push(lastNonMemory);
            }
          }
          
          if (shouldFail.has(role)) {
            return {
              role,
              output: '',
              success: false,
              error: `Agent ${role} failed`,
            };
          }
          
          return {
            role,
            output: `Output from ${role}`,
            success: true,
          };
        }),
      })),
    } as unknown as AgentFactory;
    
    return mockFactory;
  }

  /**
   * **Validates: Requirements 2.3**
   * 
   * Property: Agents must be executed in the exact order specified in the plan
   */
  describe('Sequential Execution Order (Requirement 2.3)', () => {
    it('should execute agents in the exact order specified in the plan', async () => {
      await fc.assert(
        fc.asyncProperty(
          executionPlanArb,
          fullContextWithThreadArb,
          taskDescriptionArb,
          async (plan, context, task) => {
            // Reset tracking
            executionOrder = [];
            memoryInvocations = [];
            
            const mockFactory = createMockAgentFactory();
            const executor = new DefaultAgentExecutor({
              logger: mockLogger,
              discordNotifier: mockNotifier,
              agentFactory: mockFactory,
              skipMemoryPersistence: true, // Skip memory for order test
            });

            await executor.executePlan(plan, context, task);

            // Verify execution order matches plan order exactly
            expect(executionOrder).toEqual(plan.agents);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not skip any agent in the plan', async () => {
      await fc.assert(
        fc.asyncProperty(
          executionPlanArb,
          fullContextWithThreadArb,
          taskDescriptionArb,
          async (plan, context, task) => {
            executionOrder = [];
            
            const mockFactory = createMockAgentFactory();
            const executor = new DefaultAgentExecutor({
              logger: mockLogger,
              discordNotifier: mockNotifier,
              agentFactory: mockFactory,
              skipMemoryPersistence: true,
            });

            await executor.executePlan(plan, context, task);

            // All agents in the plan should have been executed
            expect(executionOrder.length).toBe(plan.agents.length);
            
            // Each agent should appear exactly once
            for (const agent of plan.agents) {
              expect(executionOrder.filter(a => a === agent).length).toBe(
                plan.agents.filter(a => a === agent).length
              );
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 2.4**
   * 
   * Property: Memory Agent must be invoked after each successful agent execution
   */
  describe('Memory Persistence After Each Agent (Requirement 2.4)', () => {
    it('should invoke Memory Agent after each successful agent execution', async () => {
      await fc.assert(
        fc.asyncProperty(
          executionPlanArb,
          fullContextWithThreadArb,
          taskDescriptionArb,
          async (plan, context, task) => {
            executionOrder = [];
            memoryInvocations = [];
            
            const mockFactory = createMockAgentFactory();
            const executor = new DefaultAgentExecutor({
              logger: mockLogger,
              discordNotifier: mockNotifier,
              agentFactory: mockFactory,
              skipMemoryPersistence: false, // Enable memory persistence
            });

            const result = await executor.executePlan(plan, context, task);

            // Memory should be invoked for each successful agent
            const successfulAgents = result.completedAgents;
            expect(result.memoryResults.length).toBe(successfulAgents.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should invoke Memory Agent in order after each agent completes', async () => {
      // Use a plan with unique agents to verify order
      const uniqueAgentPlanArb = fc.record({
        agents: fc.shuffledSubarray(
          ['architect', 'planner', 'developer', 'reviewer', 'qa', 'devops'] as AgentRole[],
          { minLength: 2, maxLength: 4 }
        ),
        reason: fc.string({ minLength: 10, maxLength: 200 }),
      });

      await fc.assert(
        fc.asyncProperty(
          uniqueAgentPlanArb,
          fullContextWithThreadArb,
          taskDescriptionArb,
          async (plan, context, task) => {
            executionOrder = [];
            memoryInvocations = [];
            
            const mockFactory = createMockAgentFactory();
            const executor = new DefaultAgentExecutor({
              logger: mockLogger,
              discordNotifier: mockNotifier,
              agentFactory: mockFactory,
              skipMemoryPersistence: false,
            });

            await executor.executePlan(plan, context, task);

            // The execution order should interleave agents with memory calls
            // Pattern: agent1, memory, agent2, memory, ...
            let agentIndex = 0;
            for (let i = 0; i < executionOrder.length; i++) {
              const role = executionOrder[i];
              if (role === 'memory') {
                // Memory should follow the previous agent
                if (agentIndex > 0) {
                  expect(executionOrder[i - 1]).not.toBe('memory');
                }
              } else {
                agentIndex++;
              }
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 2.3, 2.4**
   * 
   * Property: The result should track completed agents correctly
   */
  describe('Execution Result Tracking', () => {
    it('should correctly track completed agents in the result', async () => {
      await fc.assert(
        fc.asyncProperty(
          executionPlanArb,
          fullContextWithThreadArb,
          taskDescriptionArb,
          async (plan, context, task) => {
            executionOrder = [];
            
            const mockFactory = createMockAgentFactory();
            const executor = new DefaultAgentExecutor({
              logger: mockLogger,
              discordNotifier: mockNotifier,
              agentFactory: mockFactory,
              skipMemoryPersistence: true,
            });

            const result = await executor.executePlan(plan, context, task);

            // All agents should be completed (no failures in this test)
            expect(result.completedAgents).toEqual(plan.agents);
            expect(result.failedAgents).toEqual([]);
            expect(result.results.length).toBe(plan.agents.length);
            
            // All results should be successful
            for (const agentResult of result.results) {
              expect(agentResult.success).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// ============================================================================
// Property 7: Continuidad del plan ante fallo de agente
// **Validates: Requirements 2.6**
// ============================================================================

describe('Property 7: Continuidad del plan ante fallo de agente', () => {
  let mockLogger: Logger;
  let mockNotifier: DiscordNotifier;
  let executionOrder: AgentRole[];
  let errorNotifications: Array<{ threadId: string; role: AgentRole; error: string }>;

  beforeEach(() => {
    executionOrder = [];
    errorNotifications = [];
    
    mockLogger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    
    mockNotifier = {
      notifyError: vi.fn().mockImplementation(async (threadId, role, error) => {
        errorNotifications.push({ threadId, role, error });
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Creates a mock agent factory with configurable failures
   */
  function createMockAgentFactoryWithFailures(failingAgents: Set<AgentRole>): AgentFactory {
    return {
      getAgent: vi.fn().mockImplementation((role: AgentRole) => ({
        role,
        execute: vi.fn().mockImplementation(async () => {
          executionOrder.push(role);
          
          if (failingAgents.has(role)) {
            return {
              role,
              output: '',
              success: false,
              error: `Agent ${role} encountered an error`,
            };
          }
          
          return {
            role,
            output: `Output from ${role}`,
            success: true,
          };
        }),
      })),
    } as unknown as AgentFactory;
  }

  /**
   * Generates a plan with unique agents and random failures
   * Using unique agents avoids counting issues when the same agent appears multiple times
   */
  const planWithFailuresArb = fc.shuffledSubarray(
    ['architect', 'planner', 'developer', 'reviewer', 'qa', 'devops'] as AgentRole[],
    { minLength: 2, maxLength: 5 }
  ).chain(agents => 
    fc.record({
      plan: fc.record({
        agents: fc.constant(agents),
        reason: fc.string({ minLength: 10, maxLength: 200 }),
      }),
      failingIndices: fc.subarray(
        Array.from({ length: agents.length }, (_, i) => i),
        { minLength: 1, maxLength: Math.max(1, agents.length - 1) }
      ),
    })
  );

  /**
   * **Validates: Requirements 2.6**
   * 
   * Property: When an agent fails, the error must be logged
   */
  describe('Error Logging (Requirement 2.6)', () => {
    it('should log errors when agents fail', async () => {
      await fc.assert(
        fc.asyncProperty(
          planWithFailuresArb,
          fullContextWithThreadArb,
          taskDescriptionArb,
          async ({ plan, failingIndices }, context, task) => {
            executionOrder = [];
            
            const failingAgents = new Set(failingIndices.map(i => plan.agents[i]));
            const mockFactory = createMockAgentFactoryWithFailures(failingAgents);
            
            const executor = new DefaultAgentExecutor({
              logger: mockLogger,
              discordNotifier: mockNotifier,
              agentFactory: mockFactory,
              skipMemoryPersistence: true,
            });

            await executor.executePlan(plan, context, task);

            // Error should be logged for each failing agent
            expect(mockLogger.error).toHaveBeenCalled();
            
            // Check that errors were logged for failing agents
            const errorCalls = (mockLogger.error as ReturnType<typeof vi.fn>).mock.calls;
            for (const failingAgent of failingAgents) {
              const hasErrorLog = errorCalls.some(call => 
                call[0].includes(failingAgent) || 
                (call[1] && call[1].role === failingAgent)
              );
              expect(hasErrorLog).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 2.6**
   * 
   * Property: When an agent fails, Discord must be notified
   */
  describe('Discord Notification (Requirement 2.6)', () => {
    it('should notify Discord when agents fail', async () => {
      await fc.assert(
        fc.asyncProperty(
          planWithFailuresArb,
          fullContextWithThreadArb,
          taskDescriptionArb,
          async ({ plan, failingIndices }, context, task) => {
            executionOrder = [];
            errorNotifications = [];
            
            const failingAgents = new Set(failingIndices.map(i => plan.agents[i]));
            const mockFactory = createMockAgentFactoryWithFailures(failingAgents);
            
            const executor = new DefaultAgentExecutor({
              logger: mockLogger,
              discordNotifier: mockNotifier,
              agentFactory: mockFactory,
              skipMemoryPersistence: true,
            });

            await executor.executePlan(plan, context, task);

            // Discord should be notified for each failing agent
            expect(errorNotifications.length).toBe(failingAgents.size);
            
            // Each failing agent should have a notification
            for (const failingAgent of failingAgents) {
              const hasNotification = errorNotifications.some(n => n.role === failingAgent);
              expect(hasNotification).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include thread ID in error notifications', async () => {
      await fc.assert(
        fc.asyncProperty(
          planWithFailuresArb,
          fullContextWithThreadArb,
          taskDescriptionArb,
          async ({ plan, failingIndices }, context, task) => {
            executionOrder = [];
            errorNotifications = [];
            
            const failingAgents = new Set(failingIndices.map(i => plan.agents[i]));
            const mockFactory = createMockAgentFactoryWithFailures(failingAgents);
            
            const executor = new DefaultAgentExecutor({
              logger: mockLogger,
              discordNotifier: mockNotifier,
              agentFactory: mockFactory,
              skipMemoryPersistence: true,
            });

            await executor.executePlan(plan, context, task);

            // All notifications should have the correct thread ID
            for (const notification of errorNotifications) {
              expect(notification.threadId).toBe(context.thread!.threadId);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 2.6**
   * 
   * Property: When an agent fails, execution must continue with remaining agents
   */
  describe('Continuation After Failure (Requirement 2.6)', () => {
    it('should continue executing remaining agents after a failure', async () => {
      await fc.assert(
        fc.asyncProperty(
          planWithFailuresArb,
          fullContextWithThreadArb,
          taskDescriptionArb,
          async ({ plan, failingIndices }, context, task) => {
            executionOrder = [];
            
            const failingAgents = new Set(failingIndices.map(i => plan.agents[i]));
            const mockFactory = createMockAgentFactoryWithFailures(failingAgents);
            
            const executor = new DefaultAgentExecutor({
              logger: mockLogger,
              discordNotifier: mockNotifier,
              agentFactory: mockFactory,
              skipMemoryPersistence: true,
            });

            await executor.executePlan(plan, context, task);

            // All agents should have been executed, regardless of failures
            expect(executionOrder).toEqual(plan.agents);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly track failed and completed agents', async () => {
      await fc.assert(
        fc.asyncProperty(
          planWithFailuresArb,
          fullContextWithThreadArb,
          taskDescriptionArb,
          async ({ plan, failingIndices }, context, task) => {
            executionOrder = [];
            
            const failingAgents = new Set(failingIndices.map(i => plan.agents[i]));
            const mockFactory = createMockAgentFactoryWithFailures(failingAgents);
            
            const executor = new DefaultAgentExecutor({
              logger: mockLogger,
              discordNotifier: mockNotifier,
              agentFactory: mockFactory,
              skipMemoryPersistence: true,
            });

            const result = await executor.executePlan(plan, context, task);

            // Failed agents should be tracked
            expect(result.failedAgents.length).toBe(failingAgents.size);
            for (const failingAgent of failingAgents) {
              expect(result.failedAgents).toContain(failingAgent);
            }

            // Completed agents should be the non-failing ones
            const expectedCompleted = plan.agents.filter(a => !failingAgents.has(a));
            expect(result.completedAgents.length).toBe(expectedCompleted.length);
            for (const completedAgent of expectedCompleted) {
              expect(result.completedAgents).toContain(completedAgent);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not invoke Memory Agent for failed agents', async () => {
      await fc.assert(
        fc.asyncProperty(
          planWithFailuresArb,
          fullContextWithThreadArb,
          taskDescriptionArb,
          async ({ plan, failingIndices }, context, task) => {
            executionOrder = [];
            
            const failingAgents = new Set(failingIndices.map(i => plan.agents[i]));
            const mockFactory = createMockAgentFactoryWithFailures(failingAgents);
            
            const executor = new DefaultAgentExecutor({
              logger: mockLogger,
              discordNotifier: mockNotifier,
              agentFactory: mockFactory,
              skipMemoryPersistence: false,
            });

            const result = await executor.executePlan(plan, context, task);

            // Memory results should only be for successful agents
            const successfulCount = plan.agents.filter(a => !failingAgents.has(a)).length;
            expect(result.memoryResults.length).toBe(successfulCount);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 2.6**
   * 
   * Property: Results should contain error information for failed agents
   */
  describe('Error Information in Results', () => {
    it('should include error messages in results for failed agents', async () => {
      await fc.assert(
        fc.asyncProperty(
          planWithFailuresArb,
          fullContextWithThreadArb,
          taskDescriptionArb,
          async ({ plan, failingIndices }, context, task) => {
            executionOrder = [];
            
            const failingAgents = new Set(failingIndices.map(i => plan.agents[i]));
            const mockFactory = createMockAgentFactoryWithFailures(failingAgents);
            
            const executor = new DefaultAgentExecutor({
              logger: mockLogger,
              discordNotifier: mockNotifier,
              agentFactory: mockFactory,
              skipMemoryPersistence: true,
            });

            const result = await executor.executePlan(plan, context, task);

            // Check that failed results have error information
            for (const agentResult of result.results) {
              if (failingAgents.has(agentResult.role)) {
                expect(agentResult.success).toBe(false);
                expect(agentResult.error).toBeDefined();
                expect(agentResult.error!.length).toBeGreaterThan(0);
              } else {
                expect(agentResult.success).toBe(true);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
