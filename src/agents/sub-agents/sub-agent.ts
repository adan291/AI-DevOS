/**
 * Sub-Agent System
 * 
 * Sub-agents are specialized versions of main agents.
 * Example: architect.api, architect.database, architect.security
 * 
 * Each sub-agent has:
 * - A parent agent role
 * - A specialization
 * - Specific tools
 * - A focused system prompt
 */

import type { AgentRole, AgentResult } from '../../types/agents.js';
import type { FullContext } from '../../types/orchestrator.js';
import type { Tool, ToolResult } from '../tools/base-tool.js';
import { ToolRegistry } from '../tools/base-tool.js';
import { BaseAgent, type StreamCallback } from '../base-agent.js';

/** Sub-agent specialization */
export interface SubAgentSpec {
  /** Parent agent role */
  parent: AgentRole;
  /** Specialization name (e.g., 'api', 'database', 'security') */
  specialization: string;
  /** Description of what this sub-agent does */
  description: string;
  /** Specific system prompt additions */
  systemPromptAddition: string;
  /** Tools this sub-agent can use */
  tools: Tool[];
}

/** Sub-agent registry */
export class SubAgentRegistry {
  private subAgents: Map<string, SubAgentSpec> = new Map();

  /** Register a sub-agent */
  register(spec: SubAgentSpec): void {
    const key = `${spec.parent}.${spec.specialization}`;
    this.subAgents.set(key, spec);
  }

  /** Get a sub-agent by key (e.g., 'architect.api') */
  get(key: string): SubAgentSpec | undefined {
    return this.subAgents.get(key);
  }

  /** Get all sub-agents for a parent role */
  getForParent(parent: AgentRole): SubAgentSpec[] {
    return Array.from(this.subAgents.values()).filter(s => s.parent === parent);
  }

  /** List all sub-agent keys */
  list(): string[] {
    return Array.from(this.subAgents.keys());
  }
}

/** Global sub-agent registry */
export const subAgentRegistry = new SubAgentRegistry();

/**
 * Specialized Sub-Agent
 * 
 * Extends BaseAgent with:
 * - Tool execution capability
 * - Specialized prompts
 * - Multi-turn reasoning (can call tools and continue)
 */
export class SpecializedSubAgent extends BaseAgent {
  readonly role: AgentRole;
  private spec: SubAgentSpec;
  private toolRegistry: ToolRegistry;
  private maxToolCalls = 5;

  constructor(spec: SubAgentSpec) {
    super();
    this.role = spec.parent;
    this.spec = spec;
    this.toolRegistry = new ToolRegistry();
    
    // Register tools for this sub-agent
    for (const tool of spec.tools) {
      this.toolRegistry.register(tool);
    }
  }

  protected getSystemPrompt(): string {
    const basePrompt = this.getBaseSystemPrompt();
    const toolsSection = this.toolRegistry.getAll().length > 0
      ? `\n\n## Available Tools\n${this.toolRegistry.getToolDescriptions()}\n\nTo use a tool, respond with JSON: {"tool": "tool_name", "args": {...}}`
      : '';
    
    return `${basePrompt}\n\n## Specialization: ${this.spec.specialization}\n${this.spec.systemPromptAddition}${toolsSection}`;
  }

  private getBaseSystemPrompt(): string {
    // Base prompts by parent role
    const basePrompts: Record<AgentRole, string> = {
      architect: 'You are a Software Architect specializing in system design, patterns, and technical decisions.',
      planner: 'You are a Project Planner specializing in task breakdown, estimation, and dependency management.',
      developer: 'You are a Software Developer specializing in writing clean, efficient, and maintainable code.',
      reviewer: 'You are a Code Reviewer specializing in identifying issues, suggesting improvements, and ensuring quality.',
      qa: 'You are a QA Engineer specializing in testing strategies, test cases, and quality assurance.',
      devops: 'You are a DevOps Engineer specializing in CI/CD, infrastructure, and deployment.',
      coordinator: 'You are a Coordinator that routes tasks to the appropriate specialists.',
      memory: 'You are a Memory Agent that extracts and persists knowledge.',
    };
    return basePrompts[this.spec.parent] ?? 'You are an AI assistant.';
  }

  protected buildPrompt(context: FullContext, taskDescription: string): string {
    const contextInfo = [
      `Organization: ${context.org.guildId}`,
      `Project: ${context.project.name || context.project.channelId}`,
      context.thread ? `Thread: ${context.thread.threadId}` : null,
    ].filter(Boolean).join('\n');

    return `## Context\n${contextInfo}\n\n## Task\n${taskDescription}`;
  }

  /**
   * Execute with tool support
   * The agent can call tools and continue reasoning
   */
  async execute(context: FullContext, taskDescription: string, onStream?: StreamCallback): Promise<AgentResult> {
    let currentPrompt = this.buildPrompt(context, taskDescription);
    let toolCallCount = 0;
    let conversationHistory: string[] = [];

    while (toolCallCount < this.maxToolCalls) {
      try {
        // Build full prompt with conversation history
        const fullPrompt = conversationHistory.length > 0
          ? `${currentPrompt}\n\n## Previous Steps\n${conversationHistory.join('\n\n')}\n\n## Continue`
          : currentPrompt;

        const output = await this.executeWithRetry(fullPrompt, onStream);

        // Check if the agent wants to use a tool
        const toolCall = this.toolRegistry.parseToolCall(output);
        
        if (toolCall) {
          const tool = this.toolRegistry.get(toolCall.toolName);
          if (!tool) {
            conversationHistory.push(`Tool "${toolCall.toolName}" not found. Available: ${this.toolRegistry.getAll().map(t => t.name).join(', ')}`);
            toolCallCount++;
            continue;
          }

          // Execute the tool
          const result = await tool.execute(toolCall.args);
          conversationHistory.push(`Tool: ${toolCall.toolName}\nArgs: ${JSON.stringify(toolCall.args)}\nResult: ${JSON.stringify(result.data ?? result.error)}`);
          toolCallCount++;
          continue;
        }

        // No tool call, this is the final response
        return this.parseOutput(output);
      } catch (error) {
        return this.handleError(error);
      }
    }

    // Max tool calls reached, return what we have
    return {
      role: this.role,
      output: `Reached maximum tool calls (${this.maxToolCalls}). Last conversation:\n${conversationHistory.join('\n\n')}`,
      success: true,
    };
  }
}

/**
 * Create a sub-agent instance from a spec
 */
export function createSubAgent(spec: SubAgentSpec): SpecializedSubAgent {
  return new SpecializedSubAgent(spec);
}

/**
 * Get or create a sub-agent by key
 */
export function getSubAgent(key: string): SpecializedSubAgent | null {
  const spec = subAgentRegistry.get(key);
  if (!spec) return null;
  return createSubAgent(spec);
}
