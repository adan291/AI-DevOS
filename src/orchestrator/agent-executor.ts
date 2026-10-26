/**
 * Agent Executor
 * 
 * Executes agents sequentially according to the ExecutionPlan from the Coordinator.
 * After each agent execution, invokes the Memory Agent to persist knowledge.
 * Handles failures gracefully: logs error, continues with next agent.
 * 
 * The 60s timeout per agent is handled by BaseAgent.
 * 
 * @validates Requirements 2.3, 2.4, 2.6
 */

import type { AgentExecutor, FullContext } from '../types/orchestrator.js';
import type { AgentRole, AgentResult, ExecutionPlan } from '../types/agents.js';
import type { Agent } from '../types/agents.js';
import type { Gateway, EmbedOptions } from '../gateway/discord-bot.js';
import { AgentFactory } from '../agents/agent-factory.js';
import { MemoryAgent } from '../agents/memory-agent.js';
import type { StreamCallback } from '../agents/base-agent.js';

/** Logger interface for error logging */
export interface Logger {
  error(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

/** Discord notifier interface for error notifications */
export interface DiscordNotifier {
  notifyError(threadId: string, agentRole: AgentRole, error: string): Promise<void>;
}

/** Default console logger */
const defaultLogger: Logger = {
  error: (message, context) => console.error(`[ERROR] ${message}`, context ?? ''),
  info: (message, context) => console.info(`[INFO] ${message}`, context ?? ''),
  warn: (message, context) => console.warn(`[WARN] ${message}`, context ?? ''),
};

/** Default no-op Discord notifier */
const defaultNotifier: DiscordNotifier = {
  notifyError: async () => { /* no-op */ },
};

/** Minimum interval between message edits (ms) to avoid rate limits */
const EDIT_THROTTLE_MS = 800;

/**
 * Configuration for the Agent Executor
 */
export interface AgentExecutorConfig {
  logger?: Logger;
  discordNotifier?: DiscordNotifier;
  agentFactory?: AgentFactory;
  skipMemoryPersistence?: boolean;
  gateway?: Gateway;
  enableStreaming?: boolean;
}

/**
 * Result of executing an execution plan
 */
export interface ExecutionResult {
  results: AgentResult[];
  completedAgents: AgentRole[];
  failedAgents: AgentRole[];
  memoryResults: AgentResult[];
}

/**
 * Default implementation of AgentExecutor
 * 
 * Executes agents in sequence according to the ExecutionPlan.
 * After each agent execution, invokes Memory Agent to persist knowledge.
 * On failure: logs error, notifies Discord, continues with next agent.
 * 
 * @validates Requirements 2.3, 2.4, 2.6
 */
export class DefaultAgentExecutor implements AgentExecutor {
  private readonly logger: Logger;
  private readonly discordNotifier: DiscordNotifier;
  private readonly agentFactory: AgentFactory;
  private readonly skipMemoryPersistence: boolean;
  private readonly gateway: Gateway | null;
  private readonly enableStreaming: boolean;
  private memoryAgent: MemoryAgent | null = null;

  constructor(config: AgentExecutorConfig = {}) {
    this.logger = config.logger ?? defaultLogger;
    this.discordNotifier = config.discordNotifier ?? defaultNotifier;
    this.agentFactory = config.agentFactory ?? AgentFactory.getInstance();
    this.skipMemoryPersistence = config.skipMemoryPersistence ?? false;
    this.gateway = config.gateway ?? null;
    this.enableStreaming = config.enableStreaming ?? true;
  }

  /**
   * Execute a single agent with the given prompt.
   * This is the interface method required by AgentExecutor.
   * 
   * @param prompt - The prompt to execute
   * @param agentRole - The role of the agent to execute
   * @returns AgentResult from the execution
   */
  async execute(prompt: string, agentRole: AgentRole): Promise<AgentResult> {
    try {
      const agent = this.agentFactory.getAgent(agentRole);
      
      // Create a minimal context for single agent execution
      const minimalContext: FullContext = {
        org: { guildId: '', standards: [], architecture: [] },
        project: { channelId: '', guildId: '', name: '', stack: [], rules: [] },
      };
      
      // Execute the agent with the prompt as task description
      return await agent.execute(minimalContext, prompt);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Agent ${agentRole} execution failed`, { error: errorMessage });
      
      return {
        role: agentRole,
        output: '',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a full execution plan with context.
   * Executes agents in sequence, invokes Memory Agent after each, handles failures.
   * 
   * @param plan - The execution plan from the Coordinator
   * @param context - The full context for agent execution
   * @param taskDescription - Description of the task to perform
   * @param channelId - Optional channel ID for streaming updates
   * @param projectChannels - Optional map of channel names to IDs for routing agents
   * @returns ExecutionResult with all results and status
   * 
   * @validates Requirements 2.3, 2.4, 2.6
   */
  async executePlan(
    plan: ExecutionPlan,
    context: FullContext,
    taskDescription: string,
    channelId?: string,
    projectChannels?: Record<string, string>
  ): Promise<ExecutionResult> {
    const results: AgentResult[] = [];
    const memoryResults: AgentResult[] = [];
    const completedAgents: AgentRole[] = [];
    const failedAgents: AgentRole[] = [];

    this.logger.info('Starting execution plan', {
      agents: plan.agents,
      reason: plan.reason,
    });

    // Execute agents in sequence (Requirement 2.3)
    for (const agentRole of plan.agents) {
      // Skip memory agent in the plan - it's invoked automatically after each agent
      if (agentRole === 'memory') {
        continue;
      }

      // Route agent to appropriate channel if project channels exist
      const targetChannel = this.getAgentChannel(agentRole, channelId, projectChannels);
      
      const result = await this.executeAgentWithStreaming(agentRole, context, taskDescription, targetChannel);
      results.push(result);

      if (result.success) {
        completedAgents.push(agentRole);
        
        // Post-process: Create task threads if Planner generated tasks
        if (agentRole === 'planner' && projectChannels) {
          await this.createTaskThreads(result, projectChannels);
        }
        
        // Invoke Memory Agent after each successful execution (Requirement 2.4)
        if (!this.skipMemoryPersistence) {
          const memoryResult = await this.invokeMemoryAgent(context, result);
          memoryResults.push(memoryResult);
        }
      } else {
        failedAgents.push(agentRole);
        
        // Handle failure: log error, notify Discord, continue (Requirement 2.6)
        await this.handleAgentFailure(agentRole, result, context);
        
        // Continue with next agent (fail-forward approach)
      }
    }

    this.logger.info('Execution plan completed', {
      completed: completedAgents,
      failed: failedAgents,
      totalResults: results.length,
    });

    return {
      results,
      completedAgents,
      failedAgents,
      memoryResults,
    };
  }

  /**
   * Create task threads from Planner output
   */
  private async createTaskThreads(
    plannerResult: AgentResult,
    projectChannels: Record<string, string>
  ): Promise<void> {
    if (!this.gateway || !plannerResult.structured) return;

    const tasksChannelId = projectChannels['📋 tareas'];
    if (!tasksChannelId) {
      this.logger.warn('No tasks channel found for creating threads');
      return;
    }

    try {
      const structured = plannerResult.structured as { tasks?: Array<{ id: number; name: string; description: string; complexity: string }> };
      const tasks = structured.tasks;
      
      if (!tasks || !Array.isArray(tasks)) {
        this.logger.warn('No tasks found in planner output');
        return;
      }

      this.logger.info(`Creating ${tasks.length} task threads`);

      for (const task of tasks) {
        try {
          const { threadId } = await this.gateway.createTaskThread(
            tasksChannelId,
            task.id,
            task.name,
            task.description,
            task.complexity
          );
          this.logger.info(`Created thread for task ${task.id}`, { threadId });
        } catch (error) {
          this.logger.error(`Failed to create thread for task ${task.id}`, { 
            error: error instanceof Error ? error.message : 'Unknown' 
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to create task threads', { 
        error: error instanceof Error ? error.message : 'Unknown' 
      });
    }
  }

  /**
   * Execute a single agent with full context.
   * 
   * @param agentRole - The role of the agent to execute
   * @param context - The full context
   * @param taskDescription - Description of the task
   * @returns AgentResult from the execution
   */
  private async executeAgent(
    agentRole: AgentRole,
    context: FullContext,
    taskDescription: string
  ): Promise<AgentResult> {
    this.logger.info(`Executing agent: ${agentRole}`);

    try {
      const agent = this.agentFactory.getAgent(agentRole);
      const result = await agent.execute(context, taskDescription);
      
      if (result.success) {
        this.logger.info(`Agent ${agentRole} completed successfully`);
      } else {
        this.logger.warn(`Agent ${agentRole} returned failure`, { error: result.error });
      }
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Agent ${agentRole} threw exception`, { error: errorMessage });
      
      return {
        role: agentRole,
        output: '',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a single agent with streaming updates to Discord.
   */
  private async executeAgentWithStreaming(
    agentRole: AgentRole,
    context: FullContext,
    taskDescription: string,
    channelId?: string
  ): Promise<AgentResult> {
    this.logger.info(`Executing agent: ${agentRole}`);

    // If no gateway or streaming disabled, use regular execution
    if (!this.gateway || !this.enableStreaming || !channelId) {
      return this.executeAgent(agentRole, context, taskDescription);
    }

    try {
      const agent = this.agentFactory.getAgent(agentRole);
      
      // Send initial "thinking" message
      const roleEmoji = this.getRoleEmoji(agentRole);
      const roleName = this.getRoleDisplayName(agentRole);
      const initialContent = `${roleEmoji} **${roleName}**\n\n⏳ _Pensando..._`;
      
      const messageId = await this.gateway.sendMessageWithId(channelId, initialContent);
      let lastUpdate = 0; // Start at 0 to allow immediate first update
      let currentContent = '';
      let isFirstChunk = true;
      
      // Create streaming callback
      const onStream: StreamCallback = async (chunk: string, fullText: string) => {
        currentContent = fullText;
        const now = Date.now();
        
        // First chunk updates immediately to show "escribiendo", then throttle
        const shouldUpdate = isFirstChunk || (now - lastUpdate >= EDIT_THROTTLE_MS);
        
        if (shouldUpdate) {
          isFirstChunk = false;
          lastUpdate = now;
          
          // Show writing indicator with preview
          const preview = fullText.length > 1800 
            ? fullText.slice(0, 1800) + '\n\n✍️ _...escribiendo..._'
            : fullText + '\n\n✍️ _...escribiendo..._';
          const fullMessage = `${roleEmoji} **${roleName}**\n\n${preview}`;
          
          try {
            await this.gateway!.editMessage(channelId, messageId, fullMessage);
          } catch (error) {
            this.logger.warn('Failed to update streaming message', { error });
          }
        }
      };
      
      // Execute with streaming
      const result = await agent.execute(context, taskDescription, onStream);
      
      // Final update - delete streaming message and send embed
      if (result.success) {
        // Delete the streaming message
        try {
          if (!this.gateway.deleteMessage) {
            throw new Error('Gateway cannot delete messages');
          }
          await this.gateway.deleteMessage(channelId, messageId);
        } catch {
          // If delete fails, just edit the message
          await this.gateway.editMessage(channelId, messageId, `${roleEmoji} **${roleName}** ✅`);
        }
        
        // Send rich embed with the result
        await this.sendAgentResultEmbed(channelId, agentRole, result.output);
        
        this.logger.info(`Agent ${agentRole} completed successfully`);
      } else {
        const errorMessage = `${roleEmoji} **${roleName}**\n\n❌ Error: ${result.error}`;
        await this.gateway.editMessage(channelId, messageId, errorMessage);
        this.logger.warn(`Agent ${agentRole} returned failure`, { error: result.error });
      }
      
      // Mark as already sent so response manager doesn't duplicate
      result.alreadySent = true;
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Agent ${agentRole} threw exception`, { error: errorMessage });
      
      return {
        role: agentRole,
        output: '',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Send a rich embed for agent results
   */
  private async sendAgentResultEmbed(channelId: string, role: AgentRole, output: string): Promise<void> {
    const roleConfig = this.getAgentConfig(role);
    
    // Parse output into sections if possible
    const sections = this.parseOutputSections(output);
    
    if (sections.length > 0) {
      // Send multiple embeds for structured output
      for (const section of sections) {
        const embed: EmbedOptions = {
          title: `${roleConfig.emoji} ${section.title || roleConfig.name}`,
          description: section.content.slice(0, 4000),
          color: roleConfig.color,
          footer: `AI DevOS • ${roleConfig.name}`,
        };
        
        if (section.fields && section.fields.length > 0) {
          embed.fields = section.fields.slice(0, 25); // Discord limit
        }
        
        await this.gateway!.sendEmbed(channelId, embed);
      }
    } else {
      // Send as single embed or chunked messages
      if (output.length <= 4000) {
        const embed: EmbedOptions = {
          title: `${roleConfig.emoji} ${roleConfig.name}`,
          description: output,
          color: roleConfig.color,
          footer: 'AI DevOS',
        };
        await this.gateway!.sendEmbed(channelId, embed);
      } else {
        // Chunk long output
        const chunks = this.chunkMessage(output);
        for (let i = 0; i < chunks.length; i++) {
          const embed: EmbedOptions = {
            title: i === 0 ? `${roleConfig.emoji} ${roleConfig.name}` : `${roleConfig.emoji} ${roleConfig.name} (cont.)`,
            description: chunks[i],
            color: roleConfig.color,
            footer: `Parte ${i + 1}/${chunks.length}`,
          };
          await this.gateway!.sendEmbed(channelId, embed);
        }
      }
    }
  }

  /**
   * Parse output into sections based on markdown headers
   */
  private parseOutputSections(output: string): Array<{ title?: string; content: string; fields?: Array<{ name: string; value: string; inline?: boolean }> }> {
    const sections: Array<{ title?: string; content: string; fields?: Array<{ name: string; value: string; inline?: boolean }> }> = [];
    
    // Split by ## headers
    const headerRegex = /^##\s+(.+)$/gm;
    const parts = output.split(headerRegex);
    
    if (parts.length <= 1) {
      // No headers found, return as single section
      return [];
    }
    
    // First part before any header
    if (parts[0].trim()) {
      sections.push({ content: parts[0].trim() });
    }
    
    // Process header/content pairs
    for (let i = 1; i < parts.length; i += 2) {
      const title = parts[i]?.trim();
      const content = parts[i + 1]?.trim() || '';
      
      if (title && content) {
        // Try to parse tables into fields
        const fields = this.parseTableToFields(content);
        
        sections.push({
          title,
          content: fields.length > 0 ? '' : content.slice(0, 4000),
          fields: fields.length > 0 ? fields : undefined,
        });
      }
    }
    
    return sections;
  }

  /**
   * Parse markdown tables into embed fields
   */
  private parseTableToFields(content: string): Array<{ name: string; value: string; inline?: boolean }> {
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
    
    // Simple table detection
    const lines = content.split('\n');
    const tableLines = lines.filter(l => l.includes('|'));
    
    if (tableLines.length < 2) return [];
    
    // Skip header separator line (|---|---|)
    const dataLines = tableLines.filter(l => !l.match(/^\|[\s-|]+\|$/));
    
    for (const line of dataLines.slice(1)) { // Skip header row
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 2) {
        fields.push({
          name: cells[0].slice(0, 256),
          value: cells.slice(1).join(' • ').slice(0, 1024) || '—',
          inline: true,
        });
      }
    }
    
    return fields.slice(0, 25); // Discord limit
  }

  /**
   * Get agent configuration for embeds
   */
  private getAgentConfig(role: AgentRole): { name: string; emoji: string; color: `#${string}` } {
    const configs: Record<AgentRole, { name: string; emoji: string; color: `#${string}` }> = {
      coordinator: { name: 'Coordinator', emoji: '🎯', color: '#5865F2' },
      architect: { name: 'Arquitectura', emoji: '🏗️', color: '#57F287' },
      planner: { name: 'Planificación', emoji: '📋', color: '#FEE75C' },
      developer: { name: 'Desarrollo', emoji: '💻', color: '#EB459E' },
      reviewer: { name: 'Revisión', emoji: '🔍', color: '#ED4245' },
      qa: { name: 'QA & Testing', emoji: '🧪', color: '#9B59B6' },
      devops: { name: 'DevOps', emoji: '🚀', color: '#E67E22' },
      memory: { name: 'Memoria', emoji: '🧠', color: '#1ABC9C' },
    };
    return configs[role];
  }

  /**
   * Get the appropriate channel for an agent based on project structure
   */
  private getAgentChannel(
    role: AgentRole, 
    defaultChannel?: string,
    projectChannels?: Record<string, string>
  ): string | undefined {
    if (!projectChannels) {
      return defaultChannel;
    }

    // Map agent roles to channel names
    const channelMapping: Record<AgentRole, string> = {
      coordinator: '📢 general',
      architect: '🏗️ arquitectura',
      planner: '📋 tareas',
      developer: '💻 código',
      reviewer: '💻 código',
      qa: '🧪 testing',
      devops: '🚀 devops',
      memory: '📢 general',
    };

    const channelName = channelMapping[role];
    return projectChannels[channelName] ?? defaultChannel;
  }

  /**
   * Chunk a message into parts that fit within Discord's character limit.
   */
  private chunkMessage(message: string): string[] {
    const limit = 4000; // Embed description limit
    if (message.length <= limit) {
      return [message];
    }

    const chunks: string[] = [];
    let remaining = message;

    while (remaining.length > 0) {
      if (remaining.length <= limit) {
        chunks.push(remaining);
        break;
      }

      // Find split point at newline or space
      let splitIndex = remaining.lastIndexOf('\n', limit);
      if (splitIndex < limit * 0.5) {
        splitIndex = remaining.lastIndexOf(' ', limit);
      }
      if (splitIndex < limit * 0.5) {
        splitIndex = limit;
      }

      chunks.push(remaining.slice(0, splitIndex).trimEnd());
      remaining = remaining.slice(splitIndex).trimStart();
    }

    return chunks;
  }

  /**
   * Get the emoji for an agent role.
   */
  private getRoleEmoji(role: AgentRole): string {
    const emojis: Record<AgentRole, string> = {
      coordinator: '🎯',
      architect: '🏗️',
      planner: '📋',
      developer: '💻',
      reviewer: '🔍',
      qa: '🧪',
      devops: '🚀',
      memory: '🧠',
    };
    return emojis[role];
  }

  /**
   * Get the display name for an agent role.
   */
  private getRoleDisplayName(role: AgentRole): string {
    const names: Record<AgentRole, string> = {
      coordinator: 'Coordinator',
      architect: 'Architect',
      planner: 'Planner',
      developer: 'Developer',
      reviewer: 'Reviewer',
      qa: 'QA',
      devops: 'DevOps',
      memory: 'Memory',
    };
    return names[role];
  }

  /**
   * Invoke the Memory Agent to persist knowledge from an agent's execution.
   * 
   * @param context - The full context
   * @param previousResult - The result from the previous agent
   * @returns AgentResult from Memory Agent
   * 
   * @validates Requirement 2.4
   */
  private async invokeMemoryAgent(
    context: FullContext,
    previousResult: AgentResult
  ): Promise<AgentResult> {
    this.logger.info(`Invoking Memory Agent after ${previousResult.role}`);

    try {
      // Get or create Memory Agent instance
      if (!this.memoryAgent) {
        this.memoryAgent = this.agentFactory.getAgent('memory') as MemoryAgent;
      }

      // Build task description for memory extraction
      const memoryTask = this.buildMemoryTask(previousResult);
      
      const result = await this.memoryAgent.execute(context, memoryTask);
      
      if (result.success) {
        this.logger.info('Memory Agent completed successfully');
      } else {
        this.logger.warn('Memory Agent returned failure', { error: result.error });
      }
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Memory Agent threw exception', { error: errorMessage });
      
      return {
        role: 'memory',
        output: '',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Build the task description for Memory Agent based on previous agent's result.
   */
  private buildMemoryTask(previousResult: AgentResult): string {
    return `Extrae y persiste el conocimiento generado por el agente ${previousResult.role}.

## Output del Agente ${previousResult.role}
${previousResult.output}

## Instrucciones
1. Identifica decisiones importantes tomadas
2. Detecta patrones o prácticas establecidas
3. Registra cualquier error o problema encontrado
4. Genera un resumen si es apropiado

Responde con el JSON estructurado de las memorias extraídas.`;
  }

  /**
   * Handle agent failure: log error, notify Discord, prepare for continuation.
   * 
   * @param agentRole - The role of the failed agent
   * @param result - The failure result
   * @param context - The full context
   * 
   * @validates Requirement 2.6
   */
  private async handleAgentFailure(
    agentRole: AgentRole,
    result: AgentResult,
    context: FullContext
  ): Promise<void> {
    const errorMessage = result.error ?? 'Unknown error';
    
    // Log the error
    this.logger.error(`Agent ${agentRole} failed`, {
      role: agentRole,
      error: errorMessage,
      threadId: context.thread?.threadId,
    });

    // Notify in Discord thread
    const threadId = context.thread?.threadId;
    if (threadId) {
      try {
        await this.discordNotifier.notifyError(threadId, agentRole, errorMessage);
      } catch (notifyError) {
        this.logger.error('Failed to notify Discord of agent failure', {
          originalError: errorMessage,
          notifyError: notifyError instanceof Error ? notifyError.message : 'Unknown',
        });
      }
    }
  }
}

/**
 * Creates a new AgentExecutor instance.
 * 
 * @param config - Optional configuration
 * @returns A new DefaultAgentExecutor instance
 */
export function createAgentExecutor(config?: AgentExecutorConfig): DefaultAgentExecutor {
  return new DefaultAgentExecutor(config);
}
