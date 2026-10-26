/**
 * Task Handler
 * Manages task lifecycle: creation, status updates, and thread management
 */

import type { Gateway } from '../gateway/discord-bot.js';
import type { NormalizedEvent, ReactionPayload } from '../types/events.js';
import { EmbedBuilder } from 'discord.js';

/** Task status */
export type TaskStatus = 'pending' | 'in_progress' | 'review' | 'done' | 'cancelled';

/** Task info stored in memory */
export interface TaskInfo {
  taskId: number;
  threadId: string;
  messageId: string;
  name: string;
  description: string;
  complexity: string;
  status: TaskStatus;
  assignee?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Task status emoji mapping */
const STATUS_EMOJI: Record<TaskStatus, string> = {
  pending: '🔵',
  in_progress: '🟡',
  review: '🟣',
  done: '🟢',
  cancelled: '⚫',
};

/** Task status display names */
const STATUS_NAMES: Record<TaskStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En Progreso',
  review: 'En Revisión',
  done: 'Completada',
  cancelled: 'Cancelada',
};

/**
 * Task Handler - manages task threads and status
 */
export class TaskHandler {
  private tasks: Map<string, TaskInfo> = new Map(); // threadId -> TaskInfo
  private gateway: Gateway;

  constructor(gateway: Gateway) {
    this.gateway = gateway;
  }

  /**
   * Register a new task
   */
  registerTask(task: TaskInfo): void {
    this.tasks.set(task.threadId, task);
  }

  /**
   * Get task by thread ID
   */
  getTask(threadId: string): TaskInfo | undefined {
    return this.tasks.get(threadId);
  }

  /**
   * Handle reaction on a task thread
   * Returns the new status or null if no change
   */
  async handleReaction(
    event: NormalizedEvent,
    userId: string
  ): Promise<{ task: TaskInfo; newStatus: TaskStatus } | null> {
    if (event.type !== 'reaction_add' || !event.threadId) {
      return null;
    }

    const task = this.tasks.get(event.threadId);
    if (!task) {
      return null;
    }

    const payload = event.payload as ReactionPayload;
    const newStatus = this.getNewStatus(task.status, payload.emoji);
    
    if (!newStatus || newStatus === task.status) {
      return null;
    }

    // Update task
    task.status = newStatus;
    task.updatedAt = new Date();
    
    if (newStatus === 'in_progress' && !task.assignee) {
      task.assignee = userId;
    }

    // Update the embed in Discord
    await this.updateTaskEmbed(task);

    return { task, newStatus };
  }

  /**
   * Determine new status based on current status and reaction
   */
  private getNewStatus(currentStatus: TaskStatus, emoji: string): TaskStatus | null {
    switch (emoji) {
      case '🚀': // Start
        if (currentStatus === 'pending') return 'in_progress';
        break;
      case '✅': // Complete
        if (currentStatus === 'in_progress') return 'review';
        if (currentStatus === 'review') return 'done';
        break;
      case '❌': // Cancel/Reject
        if (currentStatus !== 'done') return 'cancelled';
        break;
      case '🔁': // Retry/Reopen
        if (currentStatus === 'cancelled' || currentStatus === 'done') return 'pending';
        if (currentStatus === 'review') return 'in_progress';
        break;
    }
    return null;
  }

  /**
   * Update the task embed in Discord
   */
  private async updateTaskEmbed(task: TaskInfo): Promise<void> {
    try {
      const complexityEmoji = task.complexity === 'simple' ? '🟢' : 
                              task.complexity === 'media' ? '🟡' : '🔴';
      
      const embedContent = `**${STATUS_EMOJI[task.status]} ${STATUS_NAMES[task.status]}**\n\n${task.description}`;
      
      // We need to edit the original message - for now just send a status update
      await this.gateway.sendMessage(
        task.threadId,
        `📊 **Estado actualizado**: ${STATUS_EMOJI[task.status]} ${STATUS_NAMES[task.status]}${task.assignee ? ` | 👤 <@${task.assignee}>` : ''}`
      );
    } catch (error) {
      console.error('Failed to update task embed:', error);
    }
  }

  /**
   * Get all tasks for a project
   */
  getAllTasks(): TaskInfo[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(status: TaskStatus): TaskInfo[] {
    return Array.from(this.tasks.values()).filter(t => t.status === status);
  }

  /**
   * Generate a summary of all tasks
   */
  generateSummary(): string {
    const tasks = this.getAllTasks();
    if (tasks.length === 0) return 'No hay tareas registradas.';

    const byStatus = {
      pending: tasks.filter(t => t.status === 'pending'),
      in_progress: tasks.filter(t => t.status === 'in_progress'),
      review: tasks.filter(t => t.status === 'review'),
      done: tasks.filter(t => t.status === 'done'),
      cancelled: tasks.filter(t => t.status === 'cancelled'),
    };

    const lines = [
      `📊 **Resumen de Tareas** (${tasks.length} total)`,
      '',
      `${STATUS_EMOJI.pending} Pendientes: ${byStatus.pending.length}`,
      `${STATUS_EMOJI.in_progress} En Progreso: ${byStatus.in_progress.length}`,
      `${STATUS_EMOJI.review} En Revisión: ${byStatus.review.length}`,
      `${STATUS_EMOJI.done} Completadas: ${byStatus.done.length}`,
    ];

    if (byStatus.cancelled.length > 0) {
      lines.push(`${STATUS_EMOJI.cancelled} Canceladas: ${byStatus.cancelled.length}`);
    }

    return lines.join('\n');
  }
}

/**
 * Factory function
 */
export function createTaskHandler(gateway: Gateway): TaskHandler {
  return new TaskHandler(gateway);
}
