/**
 * Adapter Manager
 * 
 * Manages multiple chat adapters simultaneously.
 * Routes events from any platform to the Orchestrator.
 * Implements the Gateway interface so the Orchestrator doesn't need to change.
 */

import type { Gateway, EmbedOptions, ProjectStructure } from '../gateway/discord-bot.js';
import type { ChatAdapter, ChatPlatform, AdapterEmbed, AdapterEventHandler } from './chat-adapter.js';

/**
 * Multi-platform adapter manager.
 * Wraps multiple ChatAdapters and exposes a unified Gateway interface.
 * 
 * The Orchestrator talks to this as if it were a single Gateway,
 * and the manager routes to the correct platform adapter.
 */
export class AdapterManager implements Gateway {
  private adapters: Map<ChatPlatform, ChatAdapter> = new Map();
  private channelPlatformMap: Map<string, ChatPlatform> = new Map();
  private primaryPlatform: ChatPlatform = 'discord';

  /**
   * Register a chat adapter
   */
  registerAdapter(adapter: ChatAdapter, isPrimary = false): void {
    this.adapters.set(adapter.platform, adapter);
    if (isPrimary) {
      this.primaryPlatform = adapter.platform;
    }
  }

  /**
   * Get a specific adapter by platform
   */
  getAdapter(platform: ChatPlatform): ChatAdapter | undefined {
    return this.adapters.get(platform);
  }

  /**
   * Map a channel/thread ID to a specific platform
   * (called when we know which platform a channel belongs to)
   */
  mapChannel(channelId: string, platform: ChatPlatform): void {
    this.channelPlatformMap.set(channelId, platform);
  }

  /**
   * Get the adapter for a given channel ID
   */
  private getAdapterForChannel(channelId: string): ChatAdapter {
    const platform = this.channelPlatformMap.get(channelId) ?? this.primaryPlatform;
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(`No adapter registered for platform: ${platform}`);
    }
    return adapter;
  }

  /**
   * Set event handler on all adapters.
   * Wraps the handler to track which platform each channel belongs to.
   */
  onEvent(handler: AdapterEventHandler): void {
    for (const [platform, adapter] of this.adapters) {
      adapter.onEvent(async (event) => {
        // Track channel → platform mapping
        this.channelPlatformMap.set(event.channelId, platform);
        if (event.threadId) {
          this.channelPlatformMap.set(event.threadId, platform);
        }
        // Forward to orchestrator
        await handler(event);
      });
    }
  }

  // --- Gateway interface implementation ---

  async start(): Promise<void> {
    const startPromises = Array.from(this.adapters.values()).map(a => a.start());
    await Promise.all(startPromises);
  }

  async stop(): Promise<void> {
    const stopPromises = Array.from(this.adapters.values()).map(a => a.stop());
    await Promise.all(stopPromises);
  }

  async sendMessage(channelOrThreadId: string, content: string): Promise<void> {
    const adapter = this.getAdapterForChannel(channelOrThreadId);
    await adapter.sendMessage(channelOrThreadId, content);
  }

  async sendMessageWithId(channelOrThreadId: string, content: string): Promise<string> {
    const adapter = this.getAdapterForChannel(channelOrThreadId);
    return adapter.sendMessageWithId(channelOrThreadId, content);
  }

  async editMessage(channelOrThreadId: string, messageId: string, content: string): Promise<void> {
    const adapter = this.getAdapterForChannel(channelOrThreadId);
    await adapter.editMessage(channelOrThreadId, messageId, content);
  }

  async deleteMessage(channelOrThreadId: string, messageId: string): Promise<void> {
    const adapter = this.getAdapterForChannel(channelOrThreadId);
    await adapter.deleteMessage(channelOrThreadId, messageId);
  }

  async sendEmbed(channelOrThreadId: string, embed: EmbedOptions): Promise<string> {
    const adapter = this.getAdapterForChannel(channelOrThreadId);
    const adapterEmbed: AdapterEmbed = {
      title: embed.title,
      description: embed.description,
      color: typeof embed.color === 'string' ? embed.color : undefined,
      fields: embed.fields,
      footer: embed.footer,
      thumbnail: embed.thumbnail,
    };
    return adapter.sendEmbed(channelOrThreadId, adapterEmbed);
  }

  async createThread(channelId: string, name: string): Promise<string> {
    const adapter = this.getAdapterForChannel(channelId);
    const threadId = await adapter.createThread(channelId, name);
    // Map the new thread to the same platform
    this.channelPlatformMap.set(threadId, this.channelPlatformMap.get(channelId) ?? this.primaryPlatform);
    return threadId;
  }

  async createTaskThread(
    channelId: string,
    taskNumber: number,
    taskName: string,
    taskDescription: string,
    complexity: string
  ): Promise<{ threadId: string; messageId: string }> {
    const adapter = this.getAdapterForChannel(channelId);
    const result = await adapter.createTaskThread(channelId, taskNumber, taskName, taskDescription, complexity);
    this.channelPlatformMap.set(result.threadId, this.channelPlatformMap.get(channelId) ?? this.primaryPlatform);
    return result;
  }

  async createProjectStructure(
    guildId: string,
    project: ProjectStructure
  ): Promise<{ categoryId: string; channels: Record<string, string> }> {
    const adapter = this.getAdapterForChannel(guildId);
    const result = await adapter.createProjectStructure(guildId, project);
    // Map all new channels to the same platform
    const platform = this.channelPlatformMap.get(guildId) ?? this.primaryPlatform;
    for (const channelId of Object.values(result.channels)) {
      this.channelPlatformMap.set(channelId, platform);
    }
    return result;
  }

  /**
   * Broadcast a message to all platforms (useful for announcements)
   */
  async broadcastMessage(content: string, channelIds?: Record<ChatPlatform, string>): Promise<void> {
    for (const [platform, adapter] of this.adapters) {
      const channelId = channelIds?.[platform];
      if (channelId) {
        await adapter.sendMessage(channelId, content).catch(err => {
          console.error(`[AdapterManager] Broadcast failed on ${platform}:`, err);
        });
      }
    }
  }

  /**
   * Get all registered platforms
   */
  getPlatforms(): ChatPlatform[] {
    return Array.from(this.adapters.keys());
  }
}

/**
 * Factory function
 */
export function createAdapterManager(): AdapterManager {
  return new AdapterManager();
}
