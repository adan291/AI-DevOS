/**
 * BaseAgent Integration Tests with ModelRouter
 * 
 * Tests the integration between BaseAgent and ModelRouter for intelligent model selection.
 * 
 * @validates Requirements 5.1, 5.2, 5.4, 5.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseAgent, AgentTimeoutError, InvalidResponseError } from './base-agent.js';
import type { IModelRouter, ModelSelection, ExecutionMetrics, ComplexityLevel, Provider } from '../model-router/model-router.js';
import type { AgentRole, AgentResult } from '../types/agents.js';
import type { FullContext } from '../types/orchestrator.js';

// Store original env vars
const originalEnv = { ...process.env };

// Mock environment variables
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  process.env.GROQ_API_KEY = 'test-groq-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.LLM_PROVIDER = 'groq';
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

/**
 * Concrete test agent that extends BaseAgent for testing purposes.
 */
class TestAgent extends BaseAgent {
  readonly role: AgentRole = 'developer';

  constructor(modelRouter?: IModelRouter) {
    super(modelRouter);
  }

  protected buildPrompt(context: FullContext, taskDescription: string): string {
    return `Task: ${taskDescription}\nContext: ${JSON.stringify(context)}`;
  }

  protected getSystemPrompt(): string {
    return 'You are a test agent for integration testing.';
  }

  // Expose protected methods for testing
  public async testCallLLMAPI(prompt: string): Promise<string> {
    return this.callLLMAPI(prompt);
  }
}

/**
 * Creates a mock ModelRouter for testing.
 */
function createMockModelRouter(options: {
  isAvailable?: boolean;
  selectModelResult?: ModelSelection;
  selectModelError?: Error;
  recordExecutionFn?: (metrics: ExecutionMetrics) => void;
} = {}): IModelRouter {
  const {
    isAvailable = true,
    selectModelResult = {
      provider: 'groq' as Provider,
      model: 'llama-3.3-70b-versatile',
      estimatedCostPer1KTokens: 0.00138,
      complexity: 'medium' as ComplexityLevel,
    },
    selectModelError,
    recordExecutionFn,
  } = options;

  return {
    isAvailable: vi.fn().mockReturnValue(isAvailable),
    selectModel: vi.fn().mockImplementation(async () => {
      if (selectModelError) {
        throw selectModelError;
      }
      return selectModelResult;
    }),
    handleFailure: vi.fn().mockResolvedValue(null),
    recordExecution: vi.fn().mockImplementation(async (metrics: ExecutionMetrics) => {
      if (recordExecutionFn) {
        recordExecutionFn(metrics);
      }
    }),
  };
}

/**
 * Creates a minimal FullContext for testing.
 */
function createTestContext(): FullContext {
  return {
    org: { guildId: 'test-guild', standards: [], architecture: [] },
    project: { channelId: 'test-channel', guildId: 'test-guild', name: 'Test Project', stack: [], rules: [] },
  };
}

describe('BaseAgent Integration with ModelRouter', () => {
  describe('ModelRouter.selectModel() is called', () => {
    /**
     * @validates Requirement 5.1: THE Model_Router SHALL expose a method that BaseAgent can call to get the optimal model for a given task
     * @validates Requirement 5.2: WHEN BaseAgent executes a task, THE BaseAgent SHALL request model selection from Model_Router before calling the LLM API
     */
    it('should call selectModel with task description and agent role', async () => {
      const mockRouter = createMockModelRouter();
      const agent = new TestAgent(mockRouter);
      
      // Mock the Groq API call to return a valid response
      vi.spyOn(agent as unknown as { callGroqAPI: (prompt: string) => Promise<string> }, 'callGroqAPI')
        .mockResolvedValue('Test response from LLM');

      const context = createTestContext();
      const taskDescription = 'Implement a new feature for user authentication';

      await agent.execute(context, taskDescription);

      expect(mockRouter.selectModel).toHaveBeenCalledTimes(1);
      expect(mockRouter.selectModel).toHaveBeenCalledWith(
        expect.stringContaining(taskDescription),
        'developer'
      );
    });

    it('should check ModelRouter availability before calling selectModel', async () => {
      const mockRouter = createMockModelRouter({ isAvailable: true });
      const agent = new TestAgent(mockRouter);
      
      vi.spyOn(agent as unknown as { callGroqAPI: (prompt: string) => Promise<string> }, 'callGroqAPI')
        .mockResolvedValue('Test response');

      await agent.execute(createTestContext(), 'Test task');

      expect(mockRouter.isAvailable).toHaveBeenCalled();
    });
  });

  describe('BaseAgent uses returned model/provider', () => {
    /**
     * @validates Requirement 5.4: THE BaseAgent SHALL use the selected model and provider for the LLM API call
     */
    it('should use Anthropic provider when ModelRouter selects it', async () => {
      const mockRouter = createMockModelRouter({
        selectModelResult: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          estimatedCostPer1KTokens: 0.018,
          complexity: 'medium',
        },
      });
      const agent = new TestAgent(mockRouter);
      
      // Spy on the Anthropic API call method
      const anthropicSpy = vi.spyOn(
        agent as unknown as { callAnthropicAPIWithModel: (prompt: string, model: string) => Promise<string> },
        'callAnthropicAPIWithModel'
      ).mockResolvedValue('Anthropic response');

      await agent.execute(createTestContext(), 'Test task');

      expect(anthropicSpy).toHaveBeenCalledWith(
        expect.any(String),
        'claude-sonnet-4-20250514'
      );
    });

    it('should use Groq provider when ModelRouter selects it', async () => {
      const mockRouter = createMockModelRouter({
        selectModelResult: {
          provider: 'groq',
          model: 'llama-3.3-70b-versatile',
          estimatedCostPer1KTokens: 0.00138,
          complexity: 'simple',
        },
      });
      const agent = new TestAgent(mockRouter);
      
      const groqSpy = vi.spyOn(
        agent as unknown as { callGroqAPIWithModel: (prompt: string, model: string) => Promise<string> },
        'callGroqAPIWithModel'
      ).mockResolvedValue('Groq response');

      await agent.execute(createTestContext(), 'Test task');

      expect(groqSpy).toHaveBeenCalledWith(
        expect.any(String),
        'llama-3.3-70b-versatile',
        undefined // onStream callback
      );
    });

    it('should use OpenAI provider when ModelRouter selects it', async () => {
      const mockRouter = createMockModelRouter({
        selectModelResult: {
          provider: 'openai',
          model: 'gpt-4o',
          estimatedCostPer1KTokens: 0.0125,
          complexity: 'complex',
        },
      });
      const agent = new TestAgent(mockRouter);
      
      const openaiSpy = vi.spyOn(
        agent as unknown as { callOpenAIAPIWithModel: (prompt: string, model: string) => Promise<string> },
        'callOpenAIAPIWithModel'
      ).mockResolvedValue('OpenAI response');

      await agent.execute(createTestContext(), 'Test task');

      expect(openaiSpy).toHaveBeenCalledWith(
        expect.any(String),
        'gpt-4o',
        undefined // onStream callback
      );
    });
  });

  describe('Fallback to default when ModelRouter unavailable', () => {
    /**
     * @validates Requirement 5.5: IF Model_Router is unavailable, THEN THE BaseAgent SHALL fall back to the default model configured in LLM_PROVIDER
     */
    it('should fall back to default provider when ModelRouter is unavailable', async () => {
      const mockRouter = createMockModelRouter({ isAvailable: false });
      const agent = new TestAgent(mockRouter);
      
      // Default provider is groq based on env var
      const groqSpy = vi.spyOn(
        agent as unknown as { callGroqAPI: (prompt: string) => Promise<string> },
        'callGroqAPI'
      ).mockResolvedValue('Default Groq response');

      await agent.execute(createTestContext(), 'Test task');

      // selectModel should not be called when unavailable
      expect(mockRouter.selectModel).not.toHaveBeenCalled();
      expect(groqSpy).toHaveBeenCalled();
    });

    it('should fall back to default provider when ModelRouter.selectModel() throws', async () => {
      const mockRouter = createMockModelRouter({
        selectModelError: new Error('ModelRouter selection failed'),
      });
      const agent = new TestAgent(mockRouter);
      
      const groqSpy = vi.spyOn(
        agent as unknown as { callGroqAPI: (prompt: string) => Promise<string> },
        'callGroqAPI'
      ).mockResolvedValue('Fallback response');

      const result = await agent.execute(createTestContext(), 'Test task');

      expect(result.success).toBe(true);
      expect(groqSpy).toHaveBeenCalled();
    });

    it('should not throw when ModelRouter is null', async () => {
      const agent = new TestAgent(); // No ModelRouter provided
      
      const groqSpy = vi.spyOn(
        agent as unknown as { callGroqAPI: (prompt: string) => Promise<string> },
        'callGroqAPI'
      ).mockResolvedValue('Response without ModelRouter');

      const result = await agent.execute(createTestContext(), 'Test task');

      expect(result.success).toBe(true);
      expect(result.output).toBe('Response without ModelRouter');
    });

    it('should continue execution normally when ModelRouter selection fails', async () => {
      const mockRouter = createMockModelRouter({
        selectModelError: new Error('No available providers'),
      });
      const agent = new TestAgent(mockRouter);
      
      vi.spyOn(
        agent as unknown as { callGroqAPI: (prompt: string) => Promise<string> },
        'callGroqAPI'
      ).mockResolvedValue('Successful fallback response');

      const result = await agent.execute(createTestContext(), 'Test task');

      expect(result.success).toBe(true);
      expect(result.output).toBe('Successful fallback response');
    });
  });

  describe('Metrics recorded after successful execution', () => {
    /**
     * @validates Requirement 5.1: THE Model_Router SHALL expose a method that BaseAgent can call
     * Tests that recordExecution is called after successful LLM execution
     */
    it('should call recordExecution after successful API call', async () => {
      let recordedMetrics: ExecutionMetrics | null = null;
      const mockRouter = createMockModelRouter({
        recordExecutionFn: (metrics) => {
          recordedMetrics = metrics;
        },
      });
      const agent = new TestAgent(mockRouter);
      
      vi.spyOn(
        agent as unknown as { callGroqAPIWithModel: (prompt: string, model: string) => Promise<string> },
        'callGroqAPIWithModel'
      ).mockResolvedValue('Success response');

      await agent.execute(createTestContext(), 'Test task');

      // Wait for async recordExecution to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockRouter.recordExecution).toHaveBeenCalled();
      expect(recordedMetrics).not.toBeNull();
      expect(recordedMetrics!.success).toBe(true);
      expect(recordedMetrics!.agentRole).toBe('developer');
    });

    it('should record correct provider and model in metrics', async () => {
      let recordedMetrics: ExecutionMetrics | null = null;
      const mockRouter = createMockModelRouter({
        selectModelResult: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          estimatedCostPer1KTokens: 0.018,
          complexity: 'medium',
        },
        recordExecutionFn: (metrics) => {
          recordedMetrics = metrics;
        },
      });
      const agent = new TestAgent(mockRouter);
      
      vi.spyOn(
        agent as unknown as { callAnthropicAPIWithModel: (prompt: string, model: string) => Promise<string> },
        'callAnthropicAPIWithModel'
      ).mockResolvedValue('Anthropic response');

      await agent.execute(createTestContext(), 'Test task');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(recordedMetrics).not.toBeNull();
      expect(recordedMetrics!.provider).toBe('anthropic');
      expect(recordedMetrics!.model).toBe('claude-sonnet-4-20250514');
      expect(recordedMetrics!.complexity).toBe('medium');
    });

    it('should record token counts in metrics', async () => {
      let recordedMetrics: ExecutionMetrics | null = null;
      const mockRouter = createMockModelRouter({
        recordExecutionFn: (metrics) => {
          recordedMetrics = metrics;
        },
      });
      const agent = new TestAgent(mockRouter);
      
      vi.spyOn(
        agent as unknown as { callGroqAPIWithModel: (prompt: string, model: string) => Promise<string> },
        'callGroqAPIWithModel'
      ).mockResolvedValue('A response with some content');

      await agent.execute(createTestContext(), 'Test task description');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(recordedMetrics).not.toBeNull();
      expect(recordedMetrics!.inputTokens).toBeGreaterThan(0);
      expect(recordedMetrics!.outputTokens).toBeGreaterThan(0);
    });

    it('should record latency in metrics', async () => {
      let recordedMetrics: ExecutionMetrics | null = null;
      const mockRouter = createMockModelRouter({
        recordExecutionFn: (metrics) => {
          recordedMetrics = metrics;
        },
      });
      const agent = new TestAgent(mockRouter);
      
      vi.spyOn(
        agent as unknown as { callGroqAPIWithModel: (prompt: string, model: string) => Promise<string> },
        'callGroqAPIWithModel'
      ).mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'Response';
      });

      await agent.execute(createTestContext(), 'Test task');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(recordedMetrics).not.toBeNull();
      expect(recordedMetrics!.latencyMs).toBeGreaterThanOrEqual(50);
    });

    it('should record failure in metrics when API call fails', async () => {
      let recordedMetrics: ExecutionMetrics | null = null;
      const mockRouter = createMockModelRouter({
        recordExecutionFn: (metrics) => {
          recordedMetrics = metrics;
        },
      });
      const agent = new TestAgent(mockRouter);
      
      vi.spyOn(
        agent as unknown as { callGroqAPIWithModel: (prompt: string, model: string) => Promise<string> },
        'callGroqAPIWithModel'
      ).mockRejectedValue(new Error('API call failed'));

      const result = await agent.execute(createTestContext(), 'Test task');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(result.success).toBe(false);
      expect(recordedMetrics).not.toBeNull();
      expect(recordedMetrics!.success).toBe(false);
      expect(recordedMetrics!.error).toBe('API call failed');
    });

    it('should not record metrics when ModelRouter is unavailable', async () => {
      const mockRouter = createMockModelRouter({ isAvailable: false });
      const agent = new TestAgent(mockRouter);
      
      vi.spyOn(
        agent as unknown as { callGroqAPI: (prompt: string) => Promise<string> },
        'callGroqAPI'
      ).mockResolvedValue('Response');

      await agent.execute(createTestContext(), 'Test task');
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockRouter.recordExecution).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty task description', async () => {
      const mockRouter = createMockModelRouter();
      const agent = new TestAgent(mockRouter);
      
      vi.spyOn(
        agent as unknown as { callGroqAPIWithModel: (prompt: string, model: string) => Promise<string> },
        'callGroqAPIWithModel'
      ).mockResolvedValue('Response');

      const result = await agent.execute(createTestContext(), '');

      expect(result.success).toBe(true);
      expect(mockRouter.selectModel).toHaveBeenCalled();
    });

    it('should handle very long task descriptions', async () => {
      const mockRouter = createMockModelRouter();
      const agent = new TestAgent(mockRouter);
      
      vi.spyOn(
        agent as unknown as { callGroqAPIWithModel: (prompt: string, model: string) => Promise<string> },
        'callGroqAPIWithModel'
      ).mockResolvedValue('Response');

      const longTask = 'A'.repeat(10000);
      const result = await agent.execute(createTestContext(), longTask);

      expect(result.success).toBe(true);
      // selectModel should be called with truncated task or full task
      expect(mockRouter.selectModel).toHaveBeenCalled();
    });

    it('should handle recordExecution failure gracefully', async () => {
      const mockRouter = createMockModelRouter();
      (mockRouter.recordExecution as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Database unavailable')
      );
      const agent = new TestAgent(mockRouter);
      
      vi.spyOn(
        agent as unknown as { callGroqAPIWithModel: (prompt: string, model: string) => Promise<string> },
        'callGroqAPIWithModel'
      ).mockResolvedValue('Response');

      // Should not throw even if recordExecution fails
      const result = await agent.execute(createTestContext(), 'Test task');

      expect(result.success).toBe(true);
    });
  });
});
