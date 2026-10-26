/**
 * Slack Chat Adapter
 * 
 * Implements ChatAdapter for Slack using the Slack Web API.
 * Supports: messages, threads, rich blocks, reactions, channels.
 * 
 * Requires: SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET in env.
 * Uses Slack's Block Kit for rich formatting (equivalent to Discord embeds).
 */

import type {
  ChatAdapter,
  ChatPlatform,
  AdapterCapabilities,
  AdapterEmbed,
  AdapterEmbedField,
  AdapterEventHandler,
  AdapterProjectStructure,
  AdapterProjectResult,
  AdapterTaskThreadResult,
} from './chat-adapter.js';
import type { NormalizedEvent } from '../types/events.js';
import { config } from '../config/index.js';

/** Slack Block Kit block types */
interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: Array<{ type: string; text: string }>;
  elements?: Array<{ type: string; text: string }>;
}

/**
 * Slack Chat Adapter
 * 
 * Uses Slack Web API directly via fetch (no heavy SDK dependency).
 * For production, consider using @slack/bolt for Socket Mode.
 */
export class SlackAdapter implements ChatAdapter {
  readonly platform: ChatPlatform = 'slack';
  readonly capabilities: AdapterCapabilities = {
    richEmbeds: true,
    threads: true,
    createChannels: true,
    reactions: true,
    editMessages: true,
    deleteMessages: true,
    projectStructures: true,
    typingIndicator: false, // Slack doesn't have a persistent typing API
  };

  private token: string;
  private eventHandler: AdapterEventHandler | null = null;
  private server: any = null; // HTTP server for Slack Events API

  constructor(token?: string) {
    this.token = token ?? config.SLACK_BOT_TOKEN?.() ?? '';
  }

  async start(): Promise<void> {
    if (!this.token) {
      throw new Error('SLACK_BOT_TOKEN is required for Slack adapter');
    }
    // In production: start HTTP server for Slack Events API or use Socket Mode
    console.log('[Slack] Adapter started');
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.close();
    }
    console.log('[Slack] Adapter stopped');
  }

  onEvent(handler: AdapterEventHandler): void {
    this.eventHandler = handler;
  }

  /**
   * Process incoming Slack event (called from HTTP webhook or Socket Mode)
   */
  async processSlackEvent(slackEvent: Record<string, any>): Promise<void> {
    if (!this.eventHandler) return;

    const normalized = this.normalizeSlackEvent(slackEvent);
    if (normalized) {
      await this.eventHandler(normalized);
    }
  }

  async sendMessage(channelOrThreadId: string, content: string): Promise<void> {
    await this.slackAPI('chat.postMessage', {
      channel: channelOrThreadId,
      text: content,
    });
  }

  async sendMessageWithId(channelOrThreadId: string, content: string): Promise<string> {
    const result = await this.slackAPI('chat.postMessage', {
      channel: channelOrThreadId,
      text: content,
    });
    return result.ts ?? '';
  }

  async editMessage(channelOrThreadId: string, messageId: string, content: string): Promise<void> {
    await this.slackAPI('chat.update', {
      channel: channelOrThreadId,
      ts: messageId,
      text: content,
    });
  }

  async sendEmbed(channelOrThreadId: string, embed: AdapterEmbed): Promise<string> {
    const blocks = this.embedToBlocks(embed);
    const result = await this.slackAPI('chat.postMessage', {
      channel: channelOrThreadId,
      text: embed.title, // Fallback text
      blocks,
    });
    return result.ts ?? '';
  }

  async createThread(channelId: string, name: string): Promise<string> {
    // Slack threads are created by replying to a message
    const result = await this.slackAPI('chat.postMessage', {
      channel: channelId,
      text: `📌 ${name}`,
    });
    return result.ts ?? '';
  }

  async createTaskThread(
    channelId: string,
    taskNumber: number,
    taskName: string,
    taskDescription: string,
    complexity: string
  ): Promise<AdapterTaskThreadResult> {
    const complexityEmoji = complexity === 'simple' ? '🟢' : complexity === 'media' ? '🟡' : '🔴';
    
    // Create the parent message (thread root)
    const result = await this.slackAPI('chat.postMessage', {
      channel: channelId,
      text: `📌 Tarea #${taskNumber}: ${taskName}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `📌 Tarea #${taskNumber}: ${taskName}`, emoji: true },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: taskDescription },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Complejidad:* ${complexityEmoji} ${complexity}` },
            { type: 'mrkdwn', text: '*Estado:* 🔵 Pendiente' },
          ],
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: 'Reacciona: 🚀 Iniciar | ✅ Completar | ❌ Cancelar' },
          ],
        },
      ],
    });

    const ts = result.ts ?? '';

    // Add reactions
    for (const emoji of ['rocket', 'white_check_mark', 'x']) {
      await this.slackAPI('reactions.add', {
        channel: channelId,
        timestamp: ts,
        name: emoji,
      }).catch(() => {}); // Best-effort
    }

    return { threadId: ts, messageId: ts };
  }

  async createProjectStructure(
    workspaceId: string,
    project: AdapterProjectStructure
  ): Promise<AdapterProjectResult> {
    const channels: Record<string, string> = {};

    for (const ch of project.channels) {
      const channelName = ch.name.replace(/[^a-z0-9-]/g, '').toLowerCase().slice(0, 80);
      const result = await this.slackAPI('conversations.create', {
        name: `${project.name.toLowerCase().replace(/\s+/g, '-')}-${channelName}`,
        is_private: false,
      });

      if (result.channel?.id) {
        channels[ch.name] = result.channel.id;

        // Set topic if provided
        if (ch.topic) {
          await this.slackAPI('conversations.setTopic', {
            channel: result.channel.id,
            topic: ch.topic,
          }).catch(() => {});
        }
      }
    }

    return { categoryId: workspaceId, channels };
  }

  async showTyping(_channelOrThreadId: string): Promise<void> {
    // Slack doesn't have a persistent typing indicator API
  }

  async deleteMessage(channelOrThreadId: string, messageId: string): Promise<void> {
    await this.slackAPI('chat.delete', {
      channel: channelOrThreadId,
      ts: messageId,
    });
  }

  // --- Private helpers ---

  private async slackAPI(method: string, body: Record<string, any>): Promise<any> {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as any;
    if (!data.ok) {
      throw new Error(`Slack API error (${method}): ${data.error}`);
    }
    return data;
  }

  private embedToBlocks(embed: AdapterEmbed): SlackBlock[] {
    const blocks: SlackBlock[] = [];

    // Header
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: embed.title, emoji: true },
    });

    // Description
    if (embed.description) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: embed.description.slice(0, 3000) },
      });
    }

    // Fields (in pairs for Slack's 2-column layout)
    if (embed.fields && embed.fields.length > 0) {
      for (let i = 0; i < embed.fields.length; i += 2) {
        const fields: Array<{ type: string; text: string }> = [];
        fields.push({ type: 'mrkdwn', text: `*${embed.fields[i].name}*\n${embed.fields[i].value}` });
        if (embed.fields[i + 1]) {
          fields.push({ type: 'mrkdwn', text: `*${embed.fields[i + 1].name}*\n${embed.fields[i + 1].value}` });
        }
        blocks.push({ type: 'section', fields });
      }
    }

    // Footer
    if (embed.footer) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: embed.footer }],
      });
    }

    return blocks;
  }

  private normalizeSlackEvent(event: Record<string, any>): NormalizedEvent | null {
    if (event.type === 'message' && !event.bot_id && event.text) {
      return {
        id: `slack_${event.ts}_${Date.now()}`,
        type: 'message',
        guildId: event.team ?? '',
        channelId: event.channel ?? '',
        threadId: event.thread_ts,
        userId: event.user ?? '',
        timestamp: parseFloat(event.ts ?? '0') * 1000,
        payload: {
          content: event.text,
          authorIsBot: false,
        },
      };
    }

    if (event.type === 'reaction_added') {
      return {
        id: `slack_reaction_${Date.now()}`,
        type: 'reaction_add',
        guildId: event.item?.team ?? '',
        channelId: event.item?.channel ?? '',
        threadId: event.item?.ts,
        userId: event.user ?? '',
        timestamp: Date.now(),
        payload: {
          emoji: this.slackEmojiToUnicode(event.reaction ?? '') as any,
          messageId: event.item?.ts ?? '',
        },
      };
    }

    return null;
  }

  private slackEmojiToUnicode(slackEmoji: string): string {
    const map: Record<string, string> = {
      'rocket': '🚀',
      'white_check_mark': '✅',
      'x': '❌',
      'arrows_counterclockwise': '🔁',
    };
    return map[slackEmoji] ?? slackEmoji;
  }
}
