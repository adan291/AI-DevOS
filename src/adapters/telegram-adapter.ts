/**
 * Telegram Chat Adapter
 * 
 * Implements ChatAdapter for Telegram Bot API.
 * Supports: messages, inline keyboards, groups, topics (threads).
 * 
 * Requires: TELEGRAM_BOT_TOKEN in env.
 * Uses Telegram's MarkdownV2 for rich formatting.
 */

import type {
  ChatAdapter,
  ChatPlatform,
  AdapterCapabilities,
  AdapterEmbed,
  AdapterEventHandler,
  AdapterProjectStructure,
  AdapterProjectResult,
  AdapterTaskThreadResult,
} from './chat-adapter.js';
import type { NormalizedEvent } from '../types/events.js';
import { config } from '../config/index.js';

/**
 * Telegram Chat Adapter
 * 
 * Uses Telegram Bot API via fetch (no heavy SDK).
 * Supports long polling or webhook mode.
 */
export class TelegramAdapter implements ChatAdapter {
  readonly platform: ChatPlatform = 'telegram';
  readonly capabilities: AdapterCapabilities = {
    richEmbeds: true, // Via formatted messages with inline keyboards
    threads: true,    // Via forum topics in supergroups
    createChannels: false,
    reactions: false,  // Limited reaction support
    editMessages: true,
    deleteMessages: true,
    projectStructures: false,
    typingIndicator: true,
  };

  private token: string;
  private eventHandler: AdapterEventHandler | null = null;
  private polling = false;
  private pollOffset = 0;

  constructor(token?: string) {
    this.token = token ?? config.TELEGRAM_BOT_TOKEN?.() ?? '';
  }

  async start(): Promise<void> {
    if (!this.token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required for Telegram adapter');
    }
    
    // Start long polling
    this.polling = true;
    this.pollLoop();
    console.log('[Telegram] Adapter started (long polling)');
  }

  async stop(): Promise<void> {
    this.polling = false;
    console.log('[Telegram] Adapter stopped');
  }

  onEvent(handler: AdapterEventHandler): void {
    this.eventHandler = handler;
  }

  async sendMessage(chatId: string, content: string): Promise<void> {
    await this.telegramAPI('sendMessage', {
      chat_id: chatId,
      text: content,
      parse_mode: 'HTML',
    });
  }

  async sendMessageWithId(chatId: string, content: string): Promise<string> {
    const result = await this.telegramAPI('sendMessage', {
      chat_id: chatId,
      text: content,
      parse_mode: 'HTML',
    });
    return String(result.result?.message_id ?? '');
  }

  async editMessage(chatId: string, messageId: string, content: string): Promise<void> {
    await this.telegramAPI('editMessageText', {
      chat_id: chatId,
      message_id: parseInt(messageId, 10),
      text: content,
      parse_mode: 'HTML',
    });
  }

  async sendEmbed(chatId: string, embed: AdapterEmbed): Promise<string> {
    const html = this.embedToHTML(embed);
    const result = await this.telegramAPI('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
    });
    return String(result.result?.message_id ?? '');
  }

  async createThread(chatId: string, name: string): Promise<string> {
    // Create a forum topic (requires supergroup with topics enabled)
    try {
      const result = await this.telegramAPI('createForumTopic', {
        chat_id: chatId,
        name,
      });
      return String(result.result?.message_thread_id ?? '');
    } catch {
      // Fallback: just send a message as thread root
      return this.sendMessageWithId(chatId, `📌 ${name}`);
    }
  }

  async createTaskThread(
    chatId: string,
    taskNumber: number,
    taskName: string,
    taskDescription: string,
    complexity: string
  ): Promise<AdapterTaskThreadResult> {
    const complexityEmoji = complexity === 'simple' ? '🟢' : complexity === 'media' ? '🟡' : '🔴';
    
    const html = [
      `<b>📌 Tarea #${taskNumber}: ${taskName}</b>`,
      '',
      taskDescription,
      '',
      `<b>Complejidad:</b> ${complexityEmoji} ${complexity}`,
      '<b>Estado:</b> 🔵 Pendiente',
      '',
      '<i>Usa /start_task, /complete_task, /cancel_task</i>',
    ].join('\n');

    const messageId = await this.sendMessageWithId(chatId, html);
    
    // Try to create a forum topic for the task
    let threadId = messageId;
    try {
      threadId = await this.createThread(chatId, `Tarea ${taskNumber}: ${taskName}`);
    } catch {
      // Forum topics not available, use message as thread
    }

    return { threadId, messageId };
  }

  async createProjectStructure(
    _workspaceId: string,
    project: AdapterProjectStructure
  ): Promise<AdapterProjectResult> {
    // Telegram doesn't support creating groups programmatically
    // Return virtual channel IDs
    const channels: Record<string, string> = {};
    for (const ch of project.channels) {
      channels[ch.name] = `tg_virtual_${ch.name.replace(/\s+/g, '_')}`;
    }
    return { categoryId: 'telegram', channels };
  }

  async showTyping(chatId: string): Promise<void> {
    await this.telegramAPI('sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    }).catch(() => {});
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    await this.telegramAPI('deleteMessage', {
      chat_id: chatId,
      message_id: parseInt(messageId, 10),
    });
  }

  // --- Private helpers ---

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const result = await this.telegramAPI('getUpdates', {
          offset: this.pollOffset,
          timeout: 30,
        });

        const updates = result.result ?? [];
        for (const update of updates) {
          this.pollOffset = update.update_id + 1;
          await this.processUpdate(update);
        }
      } catch (error) {
        console.error('[Telegram] Poll error:', error);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  private async processUpdate(update: any): Promise<void> {
    if (!this.eventHandler) return;

    const message = update.message;
    if (message && message.text && !message.from?.is_bot) {
      const event: NormalizedEvent = {
        id: `tg_${message.message_id}_${Date.now()}`,
        type: 'message',
        guildId: String(message.chat.id),
        channelId: String(message.chat.id),
        threadId: message.message_thread_id ? String(message.message_thread_id) : undefined,
        userId: String(message.from.id),
        timestamp: message.date * 1000,
        payload: {
          content: message.text,
          authorIsBot: false,
        },
      };

      await this.eventHandler(event).catch(err => {
        console.error('[Telegram] Event processing error:', err);
      });
    }
  }

  private async telegramAPI(method: string, body: Record<string, any>): Promise<any> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.json();
  }

  private embedToHTML(embed: AdapterEmbed): string {
    const lines: string[] = [`<b>${this.escapeHTML(embed.title)}</b>`];
    if (embed.description) lines.push('', this.escapeHTML(embed.description));
    if (embed.fields) {
      lines.push('');
      for (const f of embed.fields) {
        lines.push(`<b>${this.escapeHTML(f.name)}:</b> ${this.escapeHTML(f.value)}`);
      }
    }
    if (embed.footer) lines.push('', `<i>${this.escapeHTML(embed.footer)}</i>`);
    return lines.join('\n');
  }

  private escapeHTML(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
