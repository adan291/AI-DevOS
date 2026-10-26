/**
 * Chat Adapter Interface
 * 
 * Abstract interface for any chat platform (Discord, Slack, Telegram, CLI, webhooks).
 * Each platform implements this interface, and the Orchestrator works with it
 * without knowing the underlying platform.
 */

import type { NormalizedEvent } from '../types/events.js';

/** Supported chat platforms */
export type ChatPlatform = 'discord' | 'slack' | 'telegram' | 'cli' | 'webhook' | 'matrix';

/** Embed field for rich messages */
export interface AdapterEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

/** Platform-agnostic embed/rich message */
export interface AdapterEmbed {
  title: string;
  description?: string;
  color?: string;
  fields?: AdapterEmbedField[];
  footer?: string;
  thumbnail?: string;
}

/** Channel/conversation info */
export interface AdapterChannel {
  id: string;
  name: string;
  topic?: string;
  parentId?: string;
}

/** Thread info */
export interface AdapterThread {
  id: string;
  name: string;
  parentChannelId: string;
}

/** Project structure to create */
export interface AdapterProjectStructure {
  name: string;
  channels: { name: string; topic?: string }[];
}

/** Result of creating a project structure */
export interface AdapterProjectResult {
  categoryId: string;
  channels: Record<string, string>;
}

/** Task thread creation result */
export interface AdapterTaskThreadResult {
  threadId: string;
  messageId: string;
}

/** Capabilities that a chat adapter may or may not support */
export interface AdapterCapabilities {
  /** Can send rich embeds/cards */
  richEmbeds: boolean;
  /** Can create threads */
  threads: boolean;
  /** Can create channels/conversations */
  createChannels: boolean;
  /** Can add reactions */
  reactions: boolean;
  /** Can edit sent messages */
  editMessages: boolean;
  /** Can delete messages */
  deleteMessages: boolean;
  /** Can create project structures (categories + channels) */
  projectStructures: boolean;
  /** Supports streaming/typing indicators */
  typingIndicator: boolean;
}

/** Event handler callback */
export type AdapterEventHandler = (event: NormalizedEvent) => Promise<void>;

/**
 * Chat Adapter Interface
 * 
 * Any chat platform must implement this interface.
 * Methods that aren't supported should gracefully degrade
 * (e.g., sendEmbed falls back to sendMessage with formatted text).
 */
export interface ChatAdapter {
  /** Platform identifier */
  readonly platform: ChatPlatform;
  
  /** What this adapter can do */
  readonly capabilities: AdapterCapabilities;

  /** Start the adapter (connect, login, etc.) */
  start(): Promise<void>;
  
  /** Stop the adapter (disconnect, cleanup) */
  stop(): Promise<void>;
  
  /** Register event handler for normalized events */
  onEvent(handler: AdapterEventHandler): void;

  // --- Messaging ---
  
  /** Send a plain text message */
  sendMessage(channelOrThreadId: string, content: string): Promise<void>;
  
  /** Send a message and return its ID for later editing */
  sendMessageWithId(channelOrThreadId: string, content: string): Promise<string>;
  
  /** Edit an existing message */
  editMessage(channelOrThreadId: string, messageId: string, content: string): Promise<void>;
  
  /** Send a rich embed/card (falls back to formatted text if not supported) */
  sendEmbed(channelOrThreadId: string, embed: AdapterEmbed): Promise<string>;

  // --- Threads & Channels ---
  
  /** Create a thread in a channel */
  createThread(channelId: string, name: string): Promise<string>;
  
  /** Create a task thread with embed and reactions */
  createTaskThread(
    channelId: string,
    taskNumber: number,
    taskName: string,
    taskDescription: string,
    complexity: string
  ): Promise<AdapterTaskThreadResult>;
  
  /** Create a full project structure (category + channels) */
  createProjectStructure(
    workspaceId: string,
    project: AdapterProjectStructure
  ): Promise<AdapterProjectResult>;

  // --- Utilities ---
  
  /** Show typing/working indicator */
  showTyping(channelOrThreadId: string): Promise<void>;
  
  /** Delete a message */
  deleteMessage(channelOrThreadId: string, messageId: string): Promise<void>;
}
