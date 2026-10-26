/**
 * Main Orchestrator
 * 
 * Central event-driven component that processes normalized events through
 * the complete flow: event → context → coordinator plan → agent execution → response.
 * 
 * Wires together: EventRouter → ContextLoader → Coordinator → PromptBuilder → AgentExecutor → ResponseManager
 * 
 * @validates Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import type { Orchestrator, EventRouter, ContextLoader, PromptBuilder, ResponseManager, FullContext } from '../types/orchestrator.js';
import type { NormalizedEvent } from '../types/events.js';
import type { AgentResult, ExecutionPlan } from '../types/agents.js';
import type { RedisStore, PostgresStore } from '../types/persistence.js';
import type { Gateway } from '../gateway/discord-bot.js';
import { DefaultEventRouter } from './event-router.js';
import { DefaultContextLoader } from './context-loader.js';
import { DefaultPromptBuilder } from './prompt-builder.js';
import { DefaultAgentExecutor, type AgentExecutorConfig, type ExecutionResult } from './agent-executor.js';
import { DefaultResponseManager } from './response-manager.js';
import { CoordinatorAgent } from '../agents/coordinator-agent.js';
import { TaskHandler, createTaskHandler } from './task-handler.js';

/** Logger interface for the orchestrator */
export interface OrchestratorLogger {
  error(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

/** Default console logger */
const defaultLogger: OrchestratorLogger = {
  error: (message, context) => console.error(`[Orchestrator] ${message}`, context ?? ''),
  info: (message, context) => console.info(`[Orchestrator] ${message}`, context ?? ''),
  warn: (message, context) => console.warn(`[Orchestrator] ${message}`, context ?? ''),
  debug: (message, context) => console.debug(`[Orchestrator] ${message}`, context ?? ''),
};

/**
 * Configuration for creating the Orchestrator
 */
export interface OrchestratorConfig {
  /** Redis store for live state */
  redisStore: RedisStore;
  /** Postgres store for structured data */
  postgresStore: PostgresStore;
  /** Discord gateway for sending responses */
  gateway: Gateway;
  /** Optional logger */
  logger?: OrchestratorLogger;
  /** Optional custom event router */
  eventRouter?: EventRouter;
  /** Optional custom context loader */
  contextLoader?: ContextLoader;
  /** Optional custom prompt builder */
  promptBuilder?: PromptBuilder;
  /** Optional agent executor config */
  agentExecutorConfig?: AgentExecutorConfig;
  /** Optional custom response manager */
  responseManager?: ResponseManager;
}

/**
 * Default implementation of the main Orchestrator
 * 
 * Processes events through the complete flow:
 * 1. EventRouter determines if event should be processed and extracts context keys
 * 2. ContextLoader loads org, project, and thread context from persistence
 * 3. Coordinator Agent decides which agents should act and in what order
 * 4. AgentExecutor executes agents sequentially, invoking Memory Agent after each
 * 5. ResponseManager sends the final response to Discord
 * 
 * @validates Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */
export class DefaultOrchestrator implements Orchestrator {
  private readonly logger: OrchestratorLogger;
  private readonly eventRouter: EventRouter;
  private readonly contextLoader: ContextLoader;
  private readonly promptBuilder: PromptBuilder;
  private readonly agentExecutor: DefaultAgentExecutor;
  private readonly responseManager: ResponseManager;
  private readonly coordinatorAgent: CoordinatorAgent;
  private readonly gateway: Gateway;
  private readonly taskHandler: TaskHandler;

  constructor(config: OrchestratorConfig) {
    this.logger = config.logger ?? defaultLogger;
    this.gateway = config.gateway;
    
    // Initialize components with provided or default implementations
    this.eventRouter = config.eventRouter ?? new DefaultEventRouter();
    this.contextLoader = config.contextLoader ?? new DefaultContextLoader(
      config.redisStore,
      config.postgresStore
    );
    this.promptBuilder = config.promptBuilder ?? new DefaultPromptBuilder();
    this.agentExecutor = new DefaultAgentExecutor({
      ...config.agentExecutorConfig,
      gateway: config.gateway,
      enableStreaming: true,
    });
    this.responseManager = config.responseManager ?? new DefaultResponseManager({
      gateway: config.gateway,
    });
    
    // Initialize the Coordinator Agent
    this.coordinatorAgent = new CoordinatorAgent();
    
    // Initialize the Task Handler for managing task lifecycle
    this.taskHandler = createTaskHandler(config.gateway);
  }

  /**
   * Handle an incoming normalized event through the complete orchestration flow.
   * 
   * Flow:
   * 1. Route event → determine if should process and extract context keys
   * 2. Load context → fetch org, project, thread from persistence
   * 3. Invoke Coordinator → get execution plan (which agents, in what order)
   * 4. Execute plan → run agents sequentially with Memory Agent after each
   * 5. Send response → deliver results to Discord
   * 
   * @param event - The normalized event to process
   * 
   * @validates Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
   */
  async handleEvent(event: NormalizedEvent): Promise<void> {
    this.logger.info('Processing event', {
      eventId: event.id,
      type: event.type,
      guildId: event.guildId,
      channelId: event.channelId,
      threadId: event.threadId,
    });

    try {
      // Step 1: Route the event (Requirement 2.1)
      const routingDecision = await this.eventRouter.route(event);
      
      if (!routingDecision.shouldProcess) {
        this.logger.debug('Event skipped by router', { eventId: event.id });
        return;
      }

      // Handle reaction events for task management
      if (event.type === 'reaction_add') {
        const reactionResult = await this.handleTaskReaction(event);
        if (reactionResult) {
          // Reaction was handled by task handler, no further processing needed
          this.logger.info('Task reaction handled', {
            taskId: reactionResult.task.taskId,
            newStatus: reactionResult.newStatus,
          });
          return;
        }
      }

      // Step 2: Load context (Requirement 2.1)
      const context = await this.contextLoader.load(routingDecision.contextKeys);
      this.logger.debug('Context loaded', {
        orgId: context.org.guildId,
        projectId: context.project.channelId,
        hasThread: !!context.thread,
      });

      // Step 3: Get execution plan from Coordinator (Requirement 2.2)
      const taskDescription = this.extractTaskDescription(event);
      const plan = await this.getExecutionPlan(context, taskDescription);
      
      if (!plan || plan.agents.length === 0) {
        this.logger.warn('Coordinator returned empty plan', { eventId: event.id });
        await this.handleEmptyPlan(event);
        return;
      }

      this.logger.info('Execution plan received', {
        agents: plan.agents,
        reason: plan.reason,
        createProject: plan.createProject,
        projectName: plan.projectName,
      });

      // Get target channel for streaming
      let targetChannelId = event.threadId ?? event.channelId;
      let projectChannels: Record<string, string> | undefined;

      // Step 3.5: Create project structure if requested
      if (plan.createProject && plan.projectName) {
        const projectStructure = await this.createProjectStructure(event.guildId, plan.projectName);
        if (projectStructure) {
          // Store all channel IDs for routing agents to specific channels
          projectChannels = projectStructure.channels;
          
          // Use the general channel of the new project for default responses
          targetChannelId = projectStructure.channels['📢 general'] ?? targetChannelId;
          
          // Update context with new project info
          context.project = {
            ...context.project,
            channelId: targetChannelId,
            name: plan.projectName,
          };
        }
      }

      // Step 4: Execute the plan (Requirements 2.3, 2.4, 2.6)
      const executionResult = await this.agentExecutor.executePlan(
        plan,
        context,
        taskDescription,
        targetChannelId,
        projectChannels
      );

      // Step 5: Send response to Discord (Requirement 2.5)
      // Only send results that weren't already streamed
      await this.sendResponse(event, executionResult);

      this.logger.info('Event processing completed', {
        eventId: event.id,
        completedAgents: executionResult.completedAgents,
        failedAgents: executionResult.failedAgents,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Event processing failed', {
        eventId: event.id,
        error: errorMessage,
      });
      
      // Attempt to notify the user of the failure
      await this.handleProcessingError(event, errorMessage);
    }
  }

  /**
   * Get the execution plan from the Coordinator Agent.
   * 
   * @param context - The full context for the coordinator
   * @param taskDescription - Description of the task to perform
   * @returns ExecutionPlan or null if coordinator fails
   * 
   * @validates Requirement 2.2
   */
  private async getExecutionPlan(
    context: FullContext,
    taskDescription: string
  ): Promise<ExecutionPlan | null> {
    try {
      const result = await this.coordinatorAgent.execute(context, taskDescription);
      
      if (!result.success) {
        this.logger.warn('Coordinator execution failed', { error: result.error });
        return null;
      }

      return this.coordinatorAgent.getExecutionPlan(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to get execution plan', { error: errorMessage });
      return null;
    }
  }

  /**
   * Extract the task description from the event payload.
   * 
   * @param event - The normalized event
   * @returns Task description string
   */
  private extractTaskDescription(event: NormalizedEvent): string {
    switch (event.type) {
      case 'message': {
        const payload = event.payload as { content: string };
        return payload.content;
      }
      case 'thread_create': {
        const payload = event.payload as { name: string };
        return `Nuevo hilo creado: ${payload.name}`;
      }
      case 'reaction_add': {
        const payload = event.payload as { emoji: string; messageId: string };
        return `Reacción ${payload.emoji} en mensaje ${payload.messageId}`;
      }
      case 'slash_command': {
        const payload = event.payload as { command: string; options?: Record<string, string> };
        const optionsStr = payload.options 
          ? ` con opciones: ${JSON.stringify(payload.options)}`
          : '';
        return `Comando /ai ${payload.command}${optionsStr}`;
      }
      case 'github_webhook': {
        const payload = event.payload as { 
          action: string; 
          prNumber: number; 
          prTitle: string;
          repository: string;
        };
        return `GitHub ${payload.action}: PR #${payload.prNumber} "${payload.prTitle}" en ${payload.repository}`;
      }
      default:
        return 'Evento desconocido';
    }
  }

  /**
   * Send the execution results to Discord.
   * 
   * @param event - The original event
   * @param executionResult - Results from agent execution
   * 
   * @validates Requirement 2.5
   */
  private async sendResponse(
    event: NormalizedEvent,
    executionResult: ExecutionResult
  ): Promise<void> {
    // Filter to only results that weren't already sent via streaming
    const successfulResults = executionResult.results.filter(r => r.success && !r.alreadySent);
    
    if (successfulResults.length > 0) {
      await this.responseManager.send(event, successfulResults);
    }

    // If there were failures that weren't already sent, send error notifications
    const failedResults = executionResult.results.filter(r => !r.success && !r.alreadySent);
    if (failedResults.length > 0) {
      await this.responseManager.send(event, failedResults);
    }
  }

  /**
   * Handle the case when the Coordinator returns an empty plan.
   * Sends a message asking for more context.
   * 
   * @param event - The original event
   */
  private async handleEmptyPlan(event: NormalizedEvent): Promise<void> {
    const emptyPlanResult: AgentResult = {
      role: 'coordinator',
      output: '🤔 No tengo suficiente contexto para determinar qué hacer. ¿Podrías proporcionar más detalles sobre lo que necesitas?',
      success: true,
    };

    await this.responseManager.send(event, [emptyPlanResult]);
  }

  /**
   * Handle a processing error by notifying the user.
   * 
   * @param event - The original event
   * @param errorMessage - The error message
   */
  private async handleProcessingError(
    event: NormalizedEvent,
    errorMessage: string
  ): Promise<void> {
    try {
      const errorResult: AgentResult = {
        role: 'coordinator',
        output: '',
        success: false,
        error: `Error procesando el evento: ${errorMessage}`,
      };

      await this.responseManager.send(event, [errorResult]);
    } catch (sendError) {
      // If we can't even send the error notification, just log it
      this.logger.error('Failed to send error notification', {
        originalError: errorMessage,
        sendError: sendError instanceof Error ? sendError.message : 'Unknown',
      });
    }
  }

  /**
   * Create a complete project structure in Discord.
   * Creates a category with organized channels for the project.
   */
  private async createProjectStructure(
    guildId: string,
    projectName: string
  ): Promise<{ categoryId: string; channels: Record<string, string> } | null> {
    try {
      this.logger.info('Creating project structure', { guildId, projectName });

      const structure = await this.gateway.createProjectStructure(guildId, {
        name: projectName,
        channels: [
          { name: '📢 general', topic: `Canal general del proyecto ${projectName}` },
          { name: '🏗️ arquitectura', topic: 'Discusión de arquitectura y diseño' },
          { name: '📋 tareas', topic: 'Lista de tareas y seguimiento' },
          { name: '💻 código', topic: 'Discusión de código e implementación' },
          { name: '🐛 bugs', topic: 'Reporte y seguimiento de bugs' },
          { name: '🧪 testing', topic: 'Tests y QA' },
        ],
      });

      this.logger.info('Project structure created', {
        categoryId: structure.categoryId,
        channels: Object.keys(structure.channels),
      });

      // Send welcome message to general channel
      const generalChannelId = structure.channels['📢 general'];
      if (generalChannelId) {
        await this.gateway.sendEmbed(generalChannelId, {
          title: `🚀 Proyecto: ${projectName}`,
          description: `¡Bienvenido al proyecto **${projectName}**!\n\nEste espacio ha sido creado automáticamente por AI DevOS para organizar el desarrollo.`,
          color: '#57F287',
          fields: [
            { name: '📢 general', value: 'Discusión general del proyecto', inline: true },
            { name: '🏗️ arquitectura', value: 'Diseño y arquitectura', inline: true },
            { name: '📋 tareas', value: 'Gestión de tareas', inline: true },
            { name: '💻 código', value: 'Implementación', inline: true },
            { name: '🐛 bugs', value: 'Seguimiento de bugs', inline: true },
            { name: '🧪 testing', value: 'Tests y QA', inline: true },
          ],
          footer: 'AI DevOS • Proyecto creado automáticamente',
        });
      }

      return structure;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to create project structure', { error: errorMessage });
      return null;
    }
  }

  /**
   * Get the task handler for external access (e.g., registering tasks from agent executor)
   */
  getTaskHandler(): TaskHandler {
    return this.taskHandler;
  }

  /**
   * Handle a reaction event for task management.
   * Returns the result if the reaction was on a task thread, null otherwise.
   */
  private async handleTaskReaction(
    event: NormalizedEvent
  ): Promise<{ task: import('./task-handler.js').TaskInfo; newStatus: import('./task-handler.js').TaskStatus } | null> {
    return this.taskHandler.handleReaction(event, event.userId);
  }
}

/**
 * Creates a new Orchestrator instance with all dependencies wired together.
 * 
 * @param config - Configuration containing all required dependencies
 * @returns A new DefaultOrchestrator instance
 */
export function createOrchestrator(config: OrchestratorConfig): Orchestrator {
  return new DefaultOrchestrator(config);
}
