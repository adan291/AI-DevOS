/**
 * Response Manager
 * 
 * Sends final responses to Discord channels/threads after agent execution.
 * Handles message chunking for long responses (Discord 2000 char limit).
 * Formats error notifications according to the design document format.
 * Supports streaming updates for real-time feedback.
 * 
 * @validates Requirements 2.5
 */

import type { ResponseManager } from '../types/orchestrator.js';
import type { NormalizedEvent } from '../types/events.js';
import type { AgentResult, AgentRole } from '../types/agents.js';
import type { Gateway } from '../gateway/discord-bot.js';

/** Discord message character limit */
const DISCORD_MESSAGE_LIMIT = 2000;

/** Chunk overlap for context continuity */
const CHUNK_OVERLAP = 50;

/** Minimum interval between message edits (ms) to avoid rate limits */
const EDIT_THROTTLE_MS = 1000;

/** Logger interface for response manager */
export interface ResponseManagerLogger {
  error(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

/** Default console logger */
const defaultLogger: ResponseManagerLogger = {
  error: (message, context) => console.error(`[ResponseManager] ${message}`, context ?? ''),
  info: (message, context) => console.info(`[ResponseManager] ${message}`, context ?? ''),
  warn: (message, context) => console.warn(`[ResponseManager] ${message}`, context ?? ''),
};

/**
 * Configuration for the Response Manager
 */
export interface ResponseManagerConfig {
  gateway: Gateway;
  logger?: ResponseManagerLogger;
  messageLimit?: number;
}

/** Streaming message state */
interface StreamingMessage {
  messageId: string;
  channelId: string;
  lastUpdate: number;
  content: string;
}

/**
 * Error notification format as defined in the design document:
 * 
 * ⚠️ Error en {component}
 * Agente: {agent_role}
 * Hilo: {thread_title}
 * Error: {error_message}
 * Acción: {recovery_action}
 */
export interface ErrorNotification {
  component: string;
  agentRole: AgentRole;
  threadTitle?: string;
  errorMessage: string;
  recoveryAction: string;
}

/**
 * Default implementation of ResponseManager
 * 
 * Sends agent execution results to the appropriate Discord channel/thread.
 * Handles message chunking for responses exceeding Discord's 2000 char limit.
 * Formats error notifications according to the design document format.
 * 
 * @validates Requirements 2.5
 */
export class DefaultResponseManager implements ResponseManager {
  private readonly gateway: Gateway;
  private readonly logger: ResponseManagerLogger;
  private readonly messageLimit: number;
  private streamingMessages: Map<string, StreamingMessage> = new Map();

  constructor(config: ResponseManagerConfig) {
    this.gateway = config.gateway;
    this.logger = config.logger ?? defaultLogger;
    this.messageLimit = config.messageLimit ?? DISCORD_MESSAGE_LIMIT;
  }

  /**
   * Start a streaming message for an agent.
   * Returns a callback to update the message content.
   */
  async startStreaming(
    channelId: string,
    agentRole: AgentRole
  ): Promise<{ messageId: string; update: (content: string) => Promise<void>; finish: () => Promise<void> }> {
    const roleEmoji = this.getRoleEmoji(agentRole);
    const roleName = this.getRoleDisplayName(agentRole);
    const initialContent = `${roleEmoji} **${roleName}**\n\n⏳ _Pensando..._`;
    
    const messageId = await this.gateway.sendMessageWithId(channelId, initialContent);
    
    const streamKey = `${channelId}-${messageId}`;
    this.streamingMessages.set(streamKey, {
      messageId,
      channelId,
      lastUpdate: Date.now(),
      content: '',
    });
    
    const update = async (content: string): Promise<void> => {
      const state = this.streamingMessages.get(streamKey);
      if (!state) return;
      
      state.content = content;
      const now = Date.now();
      
      // Throttle updates to avoid rate limits
      if (now - state.lastUpdate >= EDIT_THROTTLE_MS) {
        state.lastUpdate = now;
        const truncatedContent = content.length > 1900 
          ? content.slice(0, 1900) + '\n\n_...escribiendo..._'
          : content;
        const fullMessage = `${roleEmoji} **${roleName}**\n\n${truncatedContent}`;
        
        try {
          await this.gateway.editMessage(channelId, messageId, fullMessage);
        } catch (error) {
          this.logger.warn('Failed to update streaming message', { error });
        }
      }
    };
    
    const finish = async (): Promise<void> => {
      const state = this.streamingMessages.get(streamKey);
      if (!state) return;
      
      this.streamingMessages.delete(streamKey);
      
      // Final update with complete content
      const fullMessage = `${roleEmoji} **${roleName}**\n\n${state.content}`;
      
      // If content is too long, chunk it
      if (fullMessage.length > this.messageLimit) {
        // Edit first message with truncated content
        const firstChunk = fullMessage.slice(0, this.messageLimit - 50) + '\n\n_(continúa...)_';
        await this.gateway.editMessage(channelId, messageId, firstChunk);
        
        // Send remaining chunks as new messages
        const remaining = fullMessage.slice(this.messageLimit - 50);
        const chunks = this.chunkMessage(remaining);
        for (const chunk of chunks) {
          await this.gateway.sendMessage(channelId, chunk);
        }
      } else {
        await this.gateway.editMessage(channelId, messageId, fullMessage);
      }
    };
    
    return { messageId, update, finish };
  }

  /**
   * Send agent results to the appropriate Discord channel/thread.
   * 
   * @param event - The original normalized event that triggered the execution
   * @param results - Array of agent results to send
   * 
   * @validates Requirements 2.5
   */
  async send(event: NormalizedEvent, results: AgentResult[]): Promise<void> {
    const targetId = this.getTargetChannelId(event);
    
    this.logger.info('Sending response to Discord', {
      targetId,
      resultCount: results.length,
      eventType: event.type,
    });

    for (const result of results) {
      try {
        if (result.success) {
          await this.sendSuccessResponse(targetId, result);
        } else {
          await this.sendErrorResponse(targetId, result, event);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error('Failed to send response to Discord', {
          targetId,
          agentRole: result.role,
          error: errorMessage,
        });
      }
    }
  }

  /**
   * Get the target channel/thread ID for sending the response.
   * Prefers threadId if available, otherwise uses channelId.
   * 
   * @param event - The normalized event
   * @returns The target channel or thread ID
   */
  private getTargetChannelId(event: NormalizedEvent): string {
    return event.threadId ?? event.channelId;
  }

  /**
   * Send a successful agent response to Discord.
   * Handles message chunking for long responses.
   * 
   * @param targetId - The target channel/thread ID
   * @param result - The successful agent result
   */
  private async sendSuccessResponse(targetId: string, result: AgentResult): Promise<void> {
    const formattedResponse = this.formatSuccessResponse(result);
    const chunks = this.chunkMessage(formattedResponse);

    this.logger.info(`Sending ${chunks.length} chunk(s) for agent ${result.role}`);

    for (let i = 0; i < chunks.length; i++) {
      await this.gateway.sendMessage(targetId, chunks[i]);
    }
  }

  /**
   * Send an error response to Discord using the design document format.
   * 
   * @param targetId - The target channel/thread ID
   * @param result - The failed agent result
   * @param event - The original event for context
   */
  private async sendErrorResponse(
    targetId: string,
    result: AgentResult,
    event: NormalizedEvent
  ): Promise<void> {
    const errorNotification: ErrorNotification = {
      component: 'Orquestador',
      agentRole: result.role,
      threadTitle: this.extractThreadTitle(event),
      errorMessage: result.error ?? 'Error desconocido',
      recoveryAction: this.determineRecoveryAction(result.role),
    };

    const formattedError = this.formatErrorNotification(errorNotification);
    await this.gateway.sendMessage(targetId, formattedError);
  }

  /**
   * Format a successful agent response for Discord.
   * 
   * @param result - The agent result
   * @returns Formatted response string
   */
  private formatSuccessResponse(result: AgentResult): string {
    const roleEmoji = this.getRoleEmoji(result.role);
    const roleName = this.getRoleDisplayName(result.role);
    
    return `${roleEmoji} **${roleName}**\n\n${result.output}`;
  }

  /**
   * Format an error notification according to the design document format.
   * 
   * Format:
   * ⚠️ Error en {component}
   * Agente: {agent_role}
   * Hilo: {thread_title}
   * Error: {error_message}
   * Acción: {recovery_action}
   * 
   * @param notification - The error notification data
   * @returns Formatted error message
   */
  formatErrorNotification(notification: ErrorNotification): string {
    const lines = [
      `⚠️ Error en ${notification.component}`,
      `Agente: ${this.getRoleDisplayName(notification.agentRole)}`,
    ];

    if (notification.threadTitle) {
      lines.push(`Hilo: ${notification.threadTitle}`);
    }

    lines.push(`Error: ${notification.errorMessage}`);
    lines.push(`Acción: ${notification.recoveryAction}`);

    return lines.join('\n');
  }

  /**
   * Chunk a message into parts that fit within Discord's character limit.
   * Attempts to split at natural boundaries (newlines, spaces).
   * 
   * @param message - The message to chunk
   * @returns Array of message chunks
   */
  chunkMessage(message: string): string[] {
    if (message.length <= this.messageLimit) {
      return [message];
    }

    const chunks: string[] = [];
    let remaining = message;

    while (remaining.length > 0) {
      if (remaining.length <= this.messageLimit) {
        chunks.push(remaining);
        break;
      }

      // Find the best split point within the limit
      const splitIndex = this.findSplitPoint(remaining, this.messageLimit);
      const chunk = remaining.slice(0, splitIndex).trimEnd();
      
      chunks.push(chunk);
      remaining = remaining.slice(splitIndex).trimStart();
    }

    return chunks;
  }

  /**
   * Find the best split point for chunking a message.
   * Prefers splitting at: code block boundaries, double newlines, single newlines, spaces.
   * 
   * @param text - The text to split
   * @param maxLength - Maximum length for the chunk
   * @returns The index to split at
   */
  private findSplitPoint(text: string, maxLength: number): number {
    const searchRange = text.slice(0, maxLength);

    // Try to split at code block boundary (```)
    const codeBlockEnd = searchRange.lastIndexOf('\n```\n');
    if (codeBlockEnd > maxLength * 0.5) {
      return codeBlockEnd + 5; // Include the closing ```\n
    }

    // Try to split at double newline (paragraph boundary)
    const doubleNewline = searchRange.lastIndexOf('\n\n');
    if (doubleNewline > maxLength * 0.5) {
      return doubleNewline + 2;
    }

    // Try to split at single newline
    const singleNewline = searchRange.lastIndexOf('\n');
    if (singleNewline > maxLength * 0.5) {
      return singleNewline + 1;
    }

    // Try to split at space
    const space = searchRange.lastIndexOf(' ');
    if (space > maxLength * 0.5) {
      return space + 1;
    }

    // Fallback: hard split at maxLength
    return maxLength;
  }

  /**
   * Extract thread title from the event payload if available.
   * 
   * @param event - The normalized event
   * @returns Thread title or undefined
   */
  private extractThreadTitle(event: NormalizedEvent): string | undefined {
    if (event.type === 'thread_create' && 'name' in event.payload) {
      return event.payload.name as string;
    }
    return undefined;
  }

  /**
   * Determine the recovery action based on the failed agent role.
   * 
   * @param role - The agent role that failed
   * @returns Suggested recovery action
   */
  private determineRecoveryAction(role: AgentRole): string {
    const recoveryActions: Record<AgentRole, string> = {
      coordinator: 'Reintentando análisis del contexto',
      architect: 'Continuando con el siguiente agente del plan',
      planner: 'Continuando con el siguiente agente del plan',
      developer: 'Continuando con el siguiente agente del plan',
      reviewer: 'Continuando con el siguiente agente del plan',
      qa: 'Continuando con el siguiente agente del plan',
      devops: 'Continuando con el siguiente agente del plan',
      memory: 'Persistencia diferida, continuando ejecución',
    };

    return recoveryActions[role];
  }

  /**
   * Get the emoji for an agent role.
   * 
   * @param role - The agent role
   * @returns Emoji string
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
   * 
   * @param role - The agent role
   * @returns Display name string
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
}

/**
 * Creates a new ResponseManager instance.
 * 
 * @param config - Configuration for the response manager
 * @returns A new DefaultResponseManager instance
 */
export function createResponseManager(config: ResponseManagerConfig): DefaultResponseManager {
  return new DefaultResponseManager(config);
}
