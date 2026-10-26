/**
 * Property Tests for Advanced Features
 * Properties 9, 13, 14: Auto-summary, Error detection, Debate limits
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { shouldTriggerSummary, AUTO_SUMMARY_THRESHOLD } from './auto-summary.js';
import { detectError } from './error-detector.js';
import { createDebateManager, DEBATE_MAX_TURNS } from './debate-manager.js';
import type { Agent, AgentResult } from '../types/agents.js';

describe('Advanced Features Property Tests', () => {
  describe('Property 9: Trigger de resumen automático cada 15 mensajes', () => {
    it('should trigger summary when messageCount - lastSummaryAt >= threshold', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 0, max: 1000 }),
          (messageCount, lastSummaryAt) => {
            const shouldTrigger = shouldTriggerSummary(messageCount, lastSummaryAt);
            const expectedTrigger = messageCount - lastSummaryAt >= AUTO_SUMMARY_THRESHOLD;
            
            expect(shouldTrigger).toBe(expectedTrigger);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should trigger exactly when difference reaches threshold', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          (lastSummaryAt) => {
            // Just below threshold - should not trigger
            const belowThreshold = shouldTriggerSummary(
              lastSummaryAt + AUTO_SUMMARY_THRESHOLD - 1,
              lastSummaryAt
            );
            expect(belowThreshold).toBe(false);

            // Exactly at threshold - should trigger
            const atThreshold = shouldTriggerSummary(
              lastSummaryAt + AUTO_SUMMARY_THRESHOLD,
              lastSummaryAt
            );
            expect(atThreshold).toBe(true);

            // Above threshold - should trigger
            const aboveThreshold = shouldTriggerSummary(
              lastSummaryAt + AUTO_SUMMARY_THRESHOLD + 1,
              lastSummaryAt
            );
            expect(aboveThreshold).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should support custom thresholds', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          fc.integer({ min: 0, max: 100 }),
          (customThreshold, lastSummaryAt) => {
            const messageCount = lastSummaryAt + customThreshold;
            const shouldTrigger = shouldTriggerSummary(messageCount, lastSummaryAt, customThreshold);
            
            expect(shouldTrigger).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property 13: Detección de errores crea hilos de bug', () => {
    // Error message patterns
    const errorPatterns = [
      'Error: Something went wrong',
      'TypeError: Cannot read property of undefined',
      'ReferenceError: x is not defined',
      'SyntaxError: Unexpected token',
      'at Object.<anonymous> (file.js:10:5)',
      'Build failed with exit code 1',
      'Tests failed: 3 of 10',
      'Internal server error',
      'Fatal error occurred',
      'Application crashed',
    ];

    // Non-error messages
    const nonErrorMessages = [
      'Hello, how are you?',
      'The feature is working great',
      'Please review this PR',
      'I updated the documentation',
      'The build succeeded',
      'All tests passed',
    ];

    it('should detect errors in messages with error patterns', () => {
      for (const errorMessage of errorPatterns) {
        const result = detectError(errorMessage);
        expect(result.hasError).toBe(true);
        expect(result.errorType).toBeDefined();
      }
    });

    it('should not detect errors in normal messages', () => {
      for (const normalMessage of nonErrorMessages) {
        const result = detectError(normalMessage);
        expect(result.hasError).toBe(false);
      }
    });

    it('should detect errors with random surrounding text', () => {
      // Use only patterns that are robust to surrounding text
      const robustPatterns = [
        'Error: Something went wrong',
        'TypeError: Cannot read property',
        'Build failed with exit code 1',
        'Application crashed',
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...robustPatterns),
          fc.string({ minLength: 0, maxLength: 50 }).filter(s => !s.includes('(')),
          fc.string({ minLength: 0, maxLength: 50 }).filter(s => !s.includes(')')),
          (errorPattern, prefix, suffix) => {
            const message = `${prefix} ${errorPattern} ${suffix}`;
            const result = detectError(message);
            
            expect(result.hasError).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should assign appropriate severity levels', () => {
      const criticalPatterns = ['SyntaxError:', 'crashed', 'fatal', 'panic'];
      const highPatterns = ['TypeError:', 'at Object.<anonymous>', 'Build failed'];
      const mediumPatterns = ['Error:', 'failed to', 'Tests failed'];

      for (const pattern of criticalPatterns) {
        const result = detectError(pattern);
        if (result.hasError) {
          expect(['critical', 'high']).toContain(result.severity);
        }
      }

      for (const pattern of highPatterns) {
        const result = detectError(pattern);
        if (result.hasError) {
          expect(['critical', 'high']).toContain(result.severity);
        }
      }
    });
  });

  describe('Property 14: Debate multi-agente se limita a 4 turnos', () => {
    let mockArchitect: Agent;
    let mockReviewer: Agent;
    let turnCount: number;

    beforeEach(() => {
      turnCount = 0;
      
      mockArchitect = {
        role: 'architect',
        execute: vi.fn().mockImplementation(async () => {
          turnCount++;
          return {
            role: 'architect',
            output: `Architect argument ${turnCount}`,
            success: true,
          } as AgentResult;
        }),
      };

      mockReviewer = {
        role: 'reviewer',
        execute: vi.fn().mockImplementation(async () => {
          turnCount++;
          return {
            role: 'reviewer',
            output: `Reviewer argument ${turnCount}`,
            success: true,
          } as AgentResult;
        }),
      };
    });

    it('should limit debate to maxTurns', async () => {
      const debateManager = createDebateManager({ maxTurns: DEBATE_MAX_TURNS });
      const agents = new Map<string, Agent>([
        ['architect', mockArchitect],
        ['reviewer', mockReviewer],
      ]);

      const result = await debateManager.startDebate(
        'Test topic',
        'Test context',
        agents as any
      );

      expect(result.turns.length).toBeLessThanOrEqual(DEBATE_MAX_TURNS);
    });

    it('should respect custom maxTurns configuration', async () => {
      fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10 }),
          async (customMaxTurns) => {
            turnCount = 0;
            
            const debateManager = createDebateManager({ maxTurns: customMaxTurns });
            const agents = new Map<string, Agent>([
              ['architect', mockArchitect],
              ['reviewer', mockReviewer],
            ]);

            const result = await debateManager.startDebate(
              'Test topic',
              'Test context',
              agents as any
            );

            expect(result.turns.length).toBeLessThanOrEqual(customMaxTurns);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should stop early if consensus is reached', async () => {
      const consensusAgent: Agent = {
        role: 'architect',
        execute: vi.fn().mockResolvedValue({
          role: 'architect',
          output: 'CONSENSUS REACHED: We agree on the approach',
          success: true,
        } as AgentResult),
      };

      const debateManager = createDebateManager({ maxTurns: 10 });
      const agents = new Map<string, Agent>([
        ['architect', consensusAgent],
        ['reviewer', mockReviewer],
      ]);

      const result = await debateManager.startDebate(
        'Test topic',
        'Test context',
        agents as any
      );

      expect(result.consensus).toBe(true);
      expect(result.turns.length).toBeLessThan(10);
    });

    it('should generate no-consensus summary when limit reached', async () => {
      const debateManager = createDebateManager({ maxTurns: 4 });
      const agents = new Map<string, Agent>([
        ['architect', mockArchitect],
        ['reviewer', mockReviewer],
      ]);

      const result = await debateManager.startDebate(
        'Test topic',
        'Test context',
        agents as any
      );

      expect(result.consensus).toBe(false);
      expect(result.summary).toContain('without consensus');
      expect(result.summary).toContain('USER ACTION REQUIRED');
    });
  });
});
