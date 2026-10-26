/**
 * Event Normalizer
 * 
 * Transforms discord.js events into NormalizedEvent format.
 * The Gateway is a proxy without business logic - this normalizer
 * only transforms structure, not content.
 */

import type {
  Message,
  ThreadChannel,
  MessageReaction,
  User,
  PartialMessage,
  PartialMessageReaction,
  PartialUser,
} from 'discord.js';
import type {
  NormalizedEvent,
  MessagePayload,
  ThreadPayload,
  ReactionPayload,
} from '../types/events.js';

/**
 * Generates a unique event ID
 */
function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Normalizes a discord.js Message event to NormalizedEvent
 * Supports: on_message
 */
export function normalizeMessageEvent(message: Message | PartialMessage): NormalizedEvent | null {
  // Skip if message is partial and we can't get required data
  if (!message.guildId || !message.channelId || !message.author) {
    return null;
  }

  const payload: MessagePayload = {
    content: message.content ?? '',
    authorIsBot: message.author.bot,
  };

  return {
    id: generateEventId(),
    type: 'message',
    guildId: message.guildId,
    channelId: message.channel.isThread() 
      ? message.channel.parentId ?? message.channelId 
      : message.channelId,
    threadId: message.channel.isThread() ? message.channelId : undefined,
    userId: message.author.id,
    timestamp: message.createdTimestamp,
    payload,
  };
}

/**
 * Normalizes a discord.js ThreadChannel event to NormalizedEvent
 * Supports: on_thread_create
 */
export function normalizeThreadCreateEvent(thread: ThreadChannel): NormalizedEvent | null {
  if (!thread.guildId || !thread.parentId) {
    return null;
  }

  const payload: ThreadPayload = {
    name: thread.name,
    parentChannelId: thread.parentId,
  };

  return {
    id: generateEventId(),
    type: 'thread_create',
    guildId: thread.guildId,
    channelId: thread.parentId,
    threadId: thread.id,
    userId: thread.ownerId ?? 'unknown',
    timestamp: thread.createdTimestamp ?? Date.now(),
    payload,
  };
}

/**
 * Maps emoji to valid ReactionPayload emoji type
 * Returns null if emoji is not a supported reaction
 */
function mapReactionEmoji(emoji: string): ReactionPayload['emoji'] | null {
  const supportedEmojis: Record<string, ReactionPayload['emoji']> = {
    '✅': '✅',
    '❌': '❌',
    '🔁': '🔁',
    '🚀': '🚀',
  };
  return supportedEmojis[emoji] ?? null;
}

/**
 * Normalizes a discord.js MessageReaction event to NormalizedEvent
 * Supports: on_reaction_add
 */
export function normalizeReactionAddEvent(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
): NormalizedEvent | null {
  const message = reaction.message;
  
  if (!message.guildId || !message.channelId || !user.id) {
    return null;
  }

  const emojiName = reaction.emoji.name;
  if (!emojiName) {
    return null;
  }

  const mappedEmoji = mapReactionEmoji(emojiName);
  if (!mappedEmoji) {
    // Unsupported emoji, skip normalization
    return null;
  }

  const payload: ReactionPayload = {
    emoji: mappedEmoji,
    messageId: message.id,
    // targetAgentRole will be determined by the orchestrator based on context
  };

  return {
    id: generateEventId(),
    type: 'reaction_add',
    guildId: message.guildId,
    channelId: message.channel.isThread()
      ? message.channel.parentId ?? message.channelId
      : message.channelId,
    threadId: message.channel.isThread() ? message.channelId : undefined,
    userId: user.id,
    timestamp: Date.now(),
    payload,
  };
}
