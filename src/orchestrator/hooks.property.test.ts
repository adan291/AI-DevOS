/**
 * Property Tests for Discord Hooks
 * Properties 8 and 15: Reactions and Thread Classification
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { mapReactionToAgent, type ReactionContext } from './reaction-handler.js';
import { classifyThread } from './thread-handler.js';
import { mapCommandToAgents, createPlanFromCommand } from './slash-command-handler.js';
import type { ReactionPayload } from '../types/events.js';
import type { ThreadState, ThreadType } from '../types/models.js';
import type { AgentRole } from '../types/agents.js';

describe('Discord Hooks Property Tests', () => {
  describe('Property 8: Reactions invoke the correct agent based on context', () => {
    const emojiArb = fc.constantFrom('✅', '❌', '🔁', '🚀') as fc.Arbitrary<ReactionPayload['emoji']>;
    const threadStateArb = fc.constantFrom('open', 'in_progress', 'review', 'done') as fc.Arbitrary<ThreadState>;
    const agentRoleArb = fc.constantFrom(
      'coordinator', 'architect', 'planner', 'developer', 
      'reviewer', 'qa', 'devops', 'memory'
    ) as fc.Arbitrary<AgentRole>;

    it('should always return a valid agent role for supported emojis', () => {
      fc.assert(
        fc.property(
          emojiArb,
          threadStateArb,
          fc.option(agentRoleArb),
          (emoji, state, lastAgent) => {
            const context: ReactionContext = {
              thread: {
                threadId: 'test-thread',
                channelId: 'test-channel',
                type: 'feature',
                state,
                summary: '',
                decisions: [],
                artifacts: [],
                messageCount: 0,
                lastSummaryAt: 0,
              },
              lastAgentRole: lastAgent ?? undefined,
            };

            const result = mapReactionToAgent(emoji, context);
            
            expect(result).not.toBeNull();
            expect(result!.agentRole).toBeDefined();
            expect(result!.reason).toBeDefined();
            expect(result!.reason.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('✅ reaction should map to reviewer or devops based on state', () => {
      fc.assert(
        fc.property(threadStateArb, (state) => {
          const context: ReactionContext = {
            thread: {
              threadId: 'test-thread',
              channelId: 'test-channel',
              type: 'feature',
              state,
              summary: '',
              decisions: [],
              artifacts: [],
              messageCount: 0,
              lastSummaryAt: 0,
            },
          };

          const result = mapReactionToAgent('✅', context);
          
          expect(result).not.toBeNull();
          
          if (state === 'done') {
            expect(result!.agentRole).toBe('devops');
          } else if (state === 'review' || state === 'in_progress') {
            expect(result!.agentRole).toBe('reviewer');
          } else {
            expect(result!.agentRole).toBe('coordinator');
          }
        }),
        { numRuns: 50 }
      );
    });

    it('❌ reaction should always map to developer', () => {
      fc.assert(
        fc.property(threadStateArb, (state) => {
          const context: ReactionContext = {
            thread: {
              threadId: 'test-thread',
              channelId: 'test-channel',
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
          
          expect(result).not.toBeNull();
          expect(result!.agentRole).toBe('developer');
        }),
        { numRuns: 50 }
      );
    });

    it('🔁 reaction should map to last agent or coordinator', () => {
      fc.assert(
        fc.property(fc.option(agentRoleArb), (lastAgent) => {
          const context: ReactionContext = {
            lastAgentRole: lastAgent ?? undefined,
          };

          const result = mapReactionToAgent('🔁', context);
          
          expect(result).not.toBeNull();
          
          if (lastAgent) {
            expect(result!.agentRole).toBe(lastAgent);
          } else {
            expect(result!.agentRole).toBe('coordinator');
          }
        }),
        { numRuns: 50 }
      );
    });

    it('🚀 reaction should always map to devops', () => {
      fc.assert(
        fc.property(threadStateArb, (state) => {
          const context: ReactionContext = {
            thread: {
              threadId: 'test-thread',
              channelId: 'test-channel',
              type: 'feature',
              state,
              summary: '',
              decisions: [],
              artifacts: [],
              messageCount: 0,
              lastSummaryAt: 0,
            },
          };

          const result = mapReactionToAgent('🚀', context);
          
          expect(result).not.toBeNull();
          expect(result!.agentRole).toBe('devops');
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('Property 15: Thread classification assigns valid types', () => {
    const threadTypeArb = fc.constantFrom('feature', 'bug', 'pr', 'task') as fc.Arbitrary<ThreadType>;

    it('should always return a valid thread type', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 100 }), (threadName) => {
          const result = classifyThread(threadName);
          
          expect(result.type).toBeDefined();
          expect(['feature', 'bug', 'pr', 'task']).toContain(result.type);
          expect(result.confidence).toBeGreaterThanOrEqual(0);
          expect(result.confidence).toBeLessThanOrEqual(1);
          expect(result.reason).toBeDefined();
        }),
        { numRuns: 100 }
      );
    });

    it('should classify threads with "feature" keyword as feature type', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 20 }),
          fc.string({ minLength: 0, maxLength: 20 }),
          (prefix, suffix) => {
            const threadName = `${prefix}feature${suffix}`;
            const result = classifyThread(threadName);
            
            expect(result.type).toBe('feature');
            expect(result.confidence).toBeGreaterThan(0.3);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should classify threads with "bug" keyword as bug type', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 20 }),
          fc.string({ minLength: 0, maxLength: 20 }),
          (prefix, suffix) => {
            const threadName = `${prefix}bug${suffix}`;
            const result = classifyThread(threadName);
            
            expect(result.type).toBe('bug');
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should classify threads with "pr" keyword as pr type', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 20 }),
          fc.string({ minLength: 0, maxLength: 20 }),
          (prefix, suffix) => {
            const threadName = `${prefix}pull request${suffix}`;
            const result = classifyThread(threadName);
            
            expect(result.type).toBe('pr');
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should default to task type when no keywords match', () => {
      const noKeywordNames = ['xyz123', 'random', 'something', 'abc'];
      
      for (const name of noKeywordNames) {
        const result = classifyThread(name);
        expect(result.type).toBe('task');
        expect(result.confidence).toBe(0.3);
      }
    });
  });

  describe('Slash Command Mapping Properties', () => {
    const commandArb = fc.constantFrom(
      'start', 'plan', 'code', 'review', 'test', 'deploy', 'summary'
    ) as fc.Arbitrary<'start' | 'plan' | 'code' | 'review' | 'test' | 'deploy' | 'summary'>;

    it('should always return a valid mapping for all commands', () => {
      fc.assert(
        fc.property(commandArb, (command) => {
          const mapping = mapCommandToAgents(command);
          
          expect(mapping.agents).toBeDefined();
          expect(mapping.agents.length).toBeGreaterThan(0);
          expect(mapping.reason).toBeDefined();
        }),
        { numRuns: 50 }
      );
    });

    it('should create valid execution plans for all commands', () => {
      fc.assert(
        fc.property(commandArb, (command) => {
          const plan = createPlanFromCommand(command);
          
          expect(plan.agents).toBeDefined();
          expect(plan.agents.length).toBeGreaterThan(0);
          expect(plan.reason).toBeDefined();
        }),
        { numRuns: 50 }
      );
    });

    it('start command should create plan with architect and planner', () => {
      const plan = createPlanFromCommand('start');
      
      expect(plan.agents).toContain('architect');
      expect(plan.agents).toContain('planner');
    });

    it('direct commands should map to their respective agents', () => {
      const directMappings: Record<string, AgentRole> = {
        plan: 'planner',
        code: 'developer',
        review: 'reviewer',
        test: 'qa',
        deploy: 'devops',
        summary: 'memory',
      };

      for (const [command, expectedAgent] of Object.entries(directMappings)) {
        const plan = createPlanFromCommand(command as any);
        expect(plan.agents).toContain(expectedAgent);
      }
    });
  });
});
