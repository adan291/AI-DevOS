/**
 * Discord Chat Adapter
 * 
 * Wraps the existing DiscordBot to implement the ChatAdapter interface.
 * Full-featured adapter with support for embeds, threads, channels, reactions.
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
import { DiscordBot, type EmbedOptions } from '../gateway/discord-bot.js';

export class DiscordAdapter implements ChatAdapter {
  readonly platform: ChatPlatform = 'discord';
  readonly capabilities: AdapterCapabilities = {
    richEmbeds: true,
    threads: true,
    createChannels: true,
    reactions: true,
    editMessages: true,
    deleteMessages: true,
    projectStructures: true,
    typingIndicator: true,
  };

  private bot: DiscordBot;

  constructor(bot?: DiscordBot) {
    this.bot = bot ?? new DiscordBot();
  }

  async start(): Promise<void> {
    await this.bot.start();
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  onEvent(handler: AdapterEventHandler): void {
    this.bot.onEvent(handler);
  }

  async sendMessage(channelOrThreadId: string, content: string): Promise<void> {
    await this.bot.sendMessage(channelOrThreadId, content);
  }

  async sendMessageWithId(channelOrThreadId: string, content: string): Promise<string> {
    return this.bot.sendMessageWithId(channelOrThreadId, content);
  }

  async editMessage(channelOrThreadId: string, messageId: string, content: string): Promise<void> {
    await this.bot.editMessage(channelOrThreadId, messageId, content);
  }

  async sendEmbed(channelOrThreadId: string, embed: AdapterEmbed): Promise<string> {
    const options: EmbedOptions = {
      title: embed.title,
      description: embed.description,
      color: (embed.color as any) ?? '#5865F2',
      fields: embed.fields,
      footer: embed.footer,
      thumbnail: embed.thumbnail,
    };
    return this.bot.sendEmbed(channelOrThreadId, options);
  }

  async createThread(channelId: string, name: string): Promise<string> {
    return this.bot.createThread(channelId, name);
  }

  async createTaskThread(
    channelId: string,
    taskNumber: number,
    taskName: string,
    taskDescription: string,
    complexity: string
  ): Promise<AdapterTaskThreadResult> {
    return this.bot.createTaskThread(channelId, taskNumber, taskName, taskDescription, complexity);
  }

  async createProjectStructure(
    workspaceId: string,
    project: AdapterProjectStructure
  ): Promise<AdapterProjectResult> {
    return this.bot.createProjectStructure(workspaceId, project);
  }

  async showTyping(channelOrThreadId: string): Promise<void> {
    try {
      const channel = await this.bot.getClient().channels.fetch(channelOrThreadId);
      if (channel && 'sendTyping' in channel && typeof channel.sendTyping === 'function') {
        await channel.sendTyping();
      }
    } catch {
      // Typing indicator is best-effort
    }
  }

  async deleteMessage(channelOrThreadId: string, messageId: string): Promise<void> {
    try {
      const channel = await this.bot.getClient().channels.fetch(channelOrThreadId);
      if (channel && 'messages' in channel) {
        const msg = await (channel as any).messages.fetch(messageId);
        await msg.delete();
      }
    } catch {
      // Delete is best-effort
    }
  }

  /** Access the underlying DiscordBot for advanced operations */
  getBot(): DiscordBot {
    return this.bot;
  }
}
