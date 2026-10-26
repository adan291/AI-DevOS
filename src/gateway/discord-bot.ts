/**
 * Discord Bot Gateway
 * 
 * Implements the Gateway interface for Discord.
 * This is a proxy without business logic - it captures events,
 * normalizes them, and forwards to the Orchestrator.
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Event normalization for message, thread_create, reaction_add
 * - Message sending and thread creation
 * - Rich embeds and project structure creation
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  TextChannel,
  ChannelType,
  EmbedBuilder,
  CategoryChannel,
  PermissionFlagsBits,
  type ColorResolvable,
  type APIEmbed,
} from 'discord.js';
import { config, constants } from '../config/index.js';
import type { NormalizedEvent } from '../types/events.js';
import {
  normalizeMessageEvent,
  normalizeThreadCreateEvent,
  normalizeReactionAddEvent,
} from './event-normalizer.js';

/** Embed field for rich messages */
export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

/** Options for creating a rich embed */
export interface EmbedOptions {
  title: string;
  description?: string;
  color?: ColorResolvable;
  fields?: EmbedField[];
  footer?: string;
  thumbnail?: string;
}

/** Project structure configuration */
export interface ProjectStructure {
  name: string;
  channels: { name: string; topic?: string }[];
}

/**
 * Gateway interface as defined in the design document
 */
export interface Gateway {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(channelOrThreadId: string, content: string): Promise<void>;
  sendMessageWithId(channelOrThreadId: string, content: string): Promise<string>;
  editMessage(channelOrThreadId: string, messageId: string, content: string): Promise<void>;
  /** Optional: implementations that cannot delete fall back to editing */
  deleteMessage?(channelOrThreadId: string, messageId: string): Promise<void>;
  sendEmbed(channelOrThreadId: string, embed: EmbedOptions): Promise<string>;
  createThread(channelId: string, name: string): Promise<string>;
  createTaskThread(channelId: string, taskNumber: number, taskName: string, taskDescription: string, complexity: string): Promise<{ threadId: string; messageId: string }>;
  createProjectStructure(guildId: string, project: ProjectStructure): Promise<{ categoryId: string; channels: Record<string, string> }>;
}

/**
 * Callback type for normalized events
 */
export type EventHandler = (event: NormalizedEvent) => Promise<void>;

/**
 * Discord Bot implementation of the Gateway interface
 */
export class DiscordBot implements Gateway {
  private client: Client;
  private eventHandler: EventHandler | null = null;
  private isRunning = false;
  private readonly allowedChannelIds = new Set(
    config.DISCORD_ALLOWED_CHANNEL_IDS().split(',').map(id => id.trim()).filter(Boolean)
  );
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
      ],
      partials: [
        Partials.Message,
        Partials.Reaction,
        Partials.User,
        Partials.Channel,
      ],
    });

    this.setupEventListeners();
  }

  /**
   * Sets the event handler callback for normalized events
   */
  onEvent(handler: EventHandler): void {
    this.eventHandler = handler;
  }

  /**
   * True when the event comes from a channel in DISCORD_ALLOWED_CHANNEL_IDS.
   * An empty list allows every channel. Threads match by their parent channel
   * (normalized as channelId) or by their own ID.
   */
  private isAllowedChannel(event: NormalizedEvent): boolean {
    if (this.allowedChannelIds.size === 0) return true;
    return this.allowedChannelIds.has(event.channelId) ||
      (!!event.threadId && this.allowedChannelIds.has(event.threadId));
  }


  /**
   * Sets up Discord.js event listeners
   */
  private setupEventListeners(): void {
    // Ready event
    this.client.on(Events.ClientReady, () => {
      console.log(`[Gateway] Discord bot logged in as ${this.client.user?.tag}`);
      this.reconnectAttempts = 0; // Reset on successful connection
    });

    // Message event (on_message)
    this.client.on(Events.MessageCreate, async (message) => {
      if (!this.eventHandler) return;
      
      const normalized = normalizeMessageEvent(message);
      if (normalized && this.isAllowedChannel(normalized)) {
        try {
          await this.eventHandler(normalized);
        } catch (error) {
          console.error('[Gateway] Error handling message event:', error);
        }
      }
    });

    // Thread create event (on_thread_create)
    this.client.on(Events.ThreadCreate, async (thread) => {
      if (!this.eventHandler) return;
      
      const normalized = normalizeThreadCreateEvent(thread);
      if (normalized && this.isAllowedChannel(normalized)) {
        try {
          await this.eventHandler(normalized);
        } catch (error) {
          console.error('[Gateway] Error handling thread create event:', error);
        }
      }
    });

    // Reaction add event (on_reaction_add)
    this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
      if (!this.eventHandler) return;
      
      // Fetch partial reaction if needed
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          console.error('[Gateway] Error fetching partial reaction:', error);
          return;
        }
      }

      const normalized = normalizeReactionAddEvent(reaction, user);
      if (normalized && this.isAllowedChannel(normalized)) {
        try {
          await this.eventHandler(normalized);
        } catch (error) {
          console.error('[Gateway] Error handling reaction event:', error);
        }
      }
    });

    // Error handling
    this.client.on(Events.Error, (error) => {
      console.error('[Gateway] Discord client error:', error);
    });

    // Disconnect handling with automatic reconnection
    this.client.on(Events.ShardDisconnect, () => {
      console.warn('[Gateway] Discord connection lost, attempting reconnection...');
      this.scheduleReconnect();
    });

    this.client.on(Events.ShardReconnecting, () => {
      console.log('[Gateway] Reconnecting to Discord...');
    });
  }

  /**
   * Calculates reconnection delay with exponential backoff
   * Pattern: 1s, 2s, 4s, 8s, ... max 30s
   */
  private calculateReconnectDelay(): number {
    const baseDelay = constants.RECONNECT_INITIAL_DELAY;
    const maxDelay = constants.RECONNECT_MAX_DELAY;
    const multiplier = constants.RECONNECT_BACKOFF_MULTIPLIER;
    
    const delay = baseDelay * Math.pow(multiplier, this.reconnectAttempts);
    return Math.min(delay, maxDelay);
  }

  /**
   * Schedules a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (!this.isRunning) return;
    
    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    const delay = this.calculateReconnectDelay();
    console.log(`[Gateway] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.client.login(config.DISCORD_TOKEN());
        console.log('[Gateway] Reconnection successful');
      } catch (error) {
        console.error('[Gateway] Reconnection failed:', error);
        this.scheduleReconnect();
      }
    }, delay);
  }


  /**
   * Starts the Discord bot and connects to Discord
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[Gateway] Bot is already running');
      return;
    }

    this.isRunning = true;
    
    try {
      await this.client.login(config.DISCORD_TOKEN());
    } catch (error) {
      console.error('[Gateway] Failed to start Discord bot:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Stops the Discord bot and disconnects from Discord
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    
    // Clear any pending reconnect
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Destroy the client connection
    this.client.destroy();
    console.log('[Gateway] Discord bot stopped');
  }

  /**
   * Sends a message to a channel or thread
   */
  async sendMessage(channelOrThreadId: string, content: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelOrThreadId);
    
    if (!channel) {
      throw new Error(`Channel not found: ${channelOrThreadId}`);
    }

    if (!channel.isTextBased()) {
      throw new Error(`Channel is not text-based: ${channelOrThreadId}`);
    }

    // TextChannel, ThreadChannel, etc. all have send() method
    if ('send' in channel && typeof channel.send === 'function') {
      await channel.send(content);
    } else {
      throw new Error(`Cannot send messages to channel: ${channelOrThreadId}`);
    }
  }

  /**
   * Sends a message and returns the message ID for later editing
   */
  async sendMessageWithId(channelOrThreadId: string, content: string): Promise<string> {
    const channel = await this.client.channels.fetch(channelOrThreadId);
    
    if (!channel) {
      throw new Error(`Channel not found: ${channelOrThreadId}`);
    }

    if (!channel.isTextBased()) {
      throw new Error(`Channel is not text-based: ${channelOrThreadId}`);
    }

    if ('send' in channel && typeof channel.send === 'function') {
      const message = await channel.send(content);
      return message.id;
    } else {
      throw new Error(`Cannot send messages to channel: ${channelOrThreadId}`);
    }
  }

  /**
   * Edits an existing message
   */
  async editMessage(channelOrThreadId: string, messageId: string, content: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelOrThreadId);
    
    if (!channel) {
      throw new Error(`Channel not found: ${channelOrThreadId}`);
    }

    if (!channel.isTextBased()) {
      throw new Error(`Channel is not text-based: ${channelOrThreadId}`);
    }

    if ('messages' in channel) {
      const message = await channel.messages.fetch(messageId);
      await message.edit(content);
    } else {
      throw new Error(`Cannot edit messages in channel: ${channelOrThreadId}`);
    }
  }

  /**
   * Creates a new thread in a channel
   * Returns the thread ID
   */
  async createThread(channelId: string, name: string): Promise<string> {
    const channel = await this.client.channels.fetch(channelId);
    
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if (!(channel instanceof TextChannel)) {
      throw new Error(`Channel is not a text channel: ${channelId}`);
    }

    const thread = await channel.threads.create({
      name,
      type: ChannelType.PublicThread,
    });

    return thread.id;
  }

  /**
   * Creates a thread with an initial embed message
   */
  async createTaskThread(
    channelId: string, 
    taskNumber: number,
    taskName: string,
    taskDescription: string,
    complexity: string
  ): Promise<{ threadId: string; messageId: string }> {
    const channel = await this.client.channels.fetch(channelId);
    
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if (!(channel instanceof TextChannel)) {
      throw new Error(`Channel is not a text channel: ${channelId}`);
    }

    // Create thread
    const thread = await channel.threads.create({
      name: `📌 Tarea ${taskNumber}: ${taskName.slice(0, 80)}`,
      type: ChannelType.PublicThread,
    });

    // Send initial embed
    const complexityEmoji = complexity === 'simple' ? '🟢' : complexity === 'media' ? '🟡' : '🔴';
    const embed = new EmbedBuilder()
      .setTitle(`📌 Tarea #${taskNumber}`)
      .setDescription(taskDescription)
      .setColor('#FEE75C')
      .addFields(
        { name: '📊 Complejidad', value: `${complexityEmoji} ${complexity}`, inline: true },
        { name: '📍 Estado', value: '🔵 Pendiente', inline: true },
        { name: '👤 Asignado', value: 'Sin asignar', inline: true },
      )
      .setFooter({ text: 'Reacciona: 🚀 Iniciar | ✅ Completar | ❌ Cancelar' })
      .setTimestamp();

    const message = await thread.send({ embeds: [embed] });
    
    // Add reaction buttons
    await message.react('🚀');
    await message.react('✅');
    await message.react('❌');

    return { threadId: thread.id, messageId: message.id };
  }

  /**
   * Sends a rich embed message
   */
  async sendEmbed(channelOrThreadId: string, options: EmbedOptions): Promise<string> {
    const channel = await this.client.channels.fetch(channelOrThreadId);
    
    if (!channel) {
      throw new Error(`Channel not found: ${channelOrThreadId}`);
    }

    if (!channel.isTextBased()) {
      throw new Error(`Channel is not text-based: ${channelOrThreadId}`);
    }

    const embed = new EmbedBuilder()
      .setTitle(options.title)
      .setColor(options.color ?? '#5865F2');

    if (options.description) {
      embed.setDescription(options.description);
    }

    if (options.fields) {
      embed.addFields(options.fields.map(f => ({
        name: f.name,
        value: f.value,
        inline: f.inline ?? false,
      })));
    }

    if (options.footer) {
      embed.setFooter({ text: options.footer });
    }

    if (options.thumbnail) {
      embed.setThumbnail(options.thumbnail);
    }

    embed.setTimestamp();

    if ('send' in channel && typeof channel.send === 'function') {
      const message = await channel.send({ embeds: [embed] });
      return message.id;
    } else {
      throw new Error(`Cannot send messages to channel: ${channelOrThreadId}`);
    }
  }

  /**
   * Creates a complete project structure with category and channels
   */
  async createProjectStructure(
    guildId: string, 
    project: ProjectStructure
  ): Promise<{ categoryId: string; channels: Record<string, string> }> {
    const guild = await this.client.guilds.fetch(guildId);
    
    if (!guild) {
      throw new Error(`Guild not found: ${guildId}`);
    }

    // Create category
    const category = await guild.channels.create({
      name: `📁 ${project.name}`,
      type: ChannelType.GuildCategory,
    });

    const channels: Record<string, string> = {};

    // Create channels under the category
    for (const channelConfig of project.channels) {
      const channelName = channelConfig.name.toLowerCase().replace(/\s+/g, '-');
      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: channelConfig.topic,
      });
      channels[channelConfig.name] = channel.id;
    }

    return {
      categoryId: category.id,
      channels,
    };
  }

  /**
   * Gets the underlying Discord.js client (for testing/advanced usage)
   */
  getClient(): Client {
    return this.client;
  }
}
