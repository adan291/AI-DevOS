/**
 * Redis Store implementation using ioredis
 * Stores live state for threads and active sessions
 * Requirements: 5.2, 5.4
 * 
 * Redis Key Schema:
 * - thread:{threadId}:state → JSON { type, state, message_count, last_summary_at }
 * - thread:{threadId}:session → JSON { plan: AgentRole[], currentIndex: number, results: AgentResult[] }
 * - thread:{threadId}:msg_count → INTEGER
 */

import type { Redis } from 'ioredis';
import type { RedisStore } from '../types/persistence.js';
import type { ThreadState, SessionData } from '../types/models.js';

/** Thread state data stored in Redis */
interface ThreadStateData {
  type: string;
  state: ThreadState;
  message_count: number;
  last_summary_at: number;
}

/**
 * Generates Redis key for thread state
 */
function threadStateKey(threadId: string): string {
  return `thread:${threadId}:state`;
}

/**
 * Generates Redis key for active session
 */
function threadSessionKey(threadId: string): string {
  return `thread:${threadId}:session`;
}

/**
 * Generates Redis key for message count
 */
function threadMsgCountKey(threadId: string): string {
  return `thread:${threadId}:msg_count`;
}

/**
 * Creates a RedisStore implementation
 * @param redis - ioredis client instance
 */
export function createRedisStore(redis: Redis): RedisStore {
  return {
    /**
     * Gets the thread state from Redis
     * Returns null if not found
     */
    async getThreadState(threadId: string): Promise<ThreadState | null> {
      const data = await redis.get(threadStateKey(threadId));
      if (!data) {
        return null;
      }
      
      try {
        const parsed = JSON.parse(data) as ThreadStateData;
        return parsed.state;
      } catch {
        return null;
      }
    },

    /**
     * Sets the thread state in Redis
     * Stores full state data including type, state, message_count, and last_summary_at
     */
    async setThreadState(threadId: string, state: ThreadState): Promise<void> {
      const key = threadStateKey(threadId);
      
      // Get existing data to preserve other fields
      const existingData = await redis.get(key);
      let stateData: ThreadStateData;
      
      if (existingData) {
        try {
          stateData = JSON.parse(existingData) as ThreadStateData;
          stateData.state = state;
        } catch {
          // If parsing fails, create new state data
          stateData = {
            type: 'task',
            state,
            message_count: 0,
            last_summary_at: 0,
          };
        }
      } else {
        stateData = {
          type: 'task',
          state,
          message_count: 0,
          last_summary_at: 0,
        };
      }
      
      await redis.set(key, JSON.stringify(stateData));
    },

    /**
     * Gets the active session for a thread
     * Returns null if no active session exists
     */
    async getActiveSession(threadId: string): Promise<SessionData | null> {
      const data = await redis.get(threadSessionKey(threadId));
      if (!data) {
        return null;
      }
      
      try {
        return JSON.parse(data) as SessionData;
      } catch {
        return null;
      }
    },

    /**
     * Sets the active session for a thread
     */
    async setActiveSession(threadId: string, session: SessionData): Promise<void> {
      await redis.set(threadSessionKey(threadId), JSON.stringify(session));
    },

    /**
     * Increments the message count for a thread
     * Returns the new count after incrementing
     */
    async incrementMessageCount(threadId: string): Promise<number> {
      const newCount = await redis.incr(threadMsgCountKey(threadId));
      
      // Also update the message_count in the state data for consistency
      const stateKey = threadStateKey(threadId);
      const existingData = await redis.get(stateKey);
      
      if (existingData) {
        try {
          const stateData = JSON.parse(existingData) as ThreadStateData;
          stateData.message_count = newCount;
          await redis.set(stateKey, JSON.stringify(stateData));
        } catch {
          // Ignore parsing errors, the msg_count key is the source of truth
        }
      }
      
      return newCount;
    },
  };
}

export type { RedisStore };
