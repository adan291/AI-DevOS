/**
 * Thread Handler
 * Handles thread creation events, classifies threads, and initializes state
 * Requirements: 6.1
 */

import type { NormalizedEvent, ThreadPayload } from '../types/events.js';
import type { ThreadContext, ThreadType, ThreadState } from '../types/models.js';
import type { RedisStore, PostgresStore } from '../types/persistence.js';

/** Thread classification result */
export interface ThreadClassification {
  type: ThreadType;
  confidence: number;
  reason: string;
}

/** Keywords for thread classification */
const CLASSIFICATION_KEYWORDS: Record<ThreadType, string[]> = {
  feature: ['feature', 'feat', 'add', 'implement', 'create', 'new', 'enhancement'],
  bug: ['bug', 'fix', 'error', 'issue', 'broken', 'crash', 'fail', 'problem'],
  pr: ['pr', 'pull request', 'merge', 'review pr', 'code review'],
  task: ['task', 'todo', 'chore', 'refactor', 'update', 'cleanup', 'docs'],
};

/**
 * Classifies a thread based on its name
 */
export function classifyThread(threadName: string): ThreadClassification {
  const nameLower = threadName.toLowerCase();
  
  let bestMatch: ThreadType = 'task';
  let bestScore = 0;
  let matchedKeyword = '';

  for (const [type, keywords] of Object.entries(CLASSIFICATION_KEYWORDS)) {
    for (const keyword of keywords) {
      if (nameLower.includes(keyword)) {
        const score = keyword.length; // Longer matches are more specific
        if (score > bestScore) {
          bestScore = score;
          bestMatch = type as ThreadType;
          matchedKeyword = keyword;
        }
      }
    }
  }

  const confidence = bestScore > 0 ? Math.min(0.5 + bestScore * 0.1, 1.0) : 0.3;
  const reason = bestScore > 0
    ? `Matched keyword "${matchedKeyword}" for type "${bestMatch}"`
    : 'No keywords matched, defaulting to task';

  return {
    type: bestMatch,
    confidence,
    reason,
  };
}

/** Thread Handler interface */
export interface ThreadHandler {
  handle(
    event: NormalizedEvent,
    redisStore: RedisStore,
    postgresStore: PostgresStore
  ): Promise<ThreadContext | null>;
}

/** Default implementation of ThreadHandler */
export class DefaultThreadHandler implements ThreadHandler {
  async handle(
    event: NormalizedEvent,
    redisStore: RedisStore,
    postgresStore: PostgresStore
  ): Promise<ThreadContext | null> {
    if (event.type !== 'thread_create') {
      return null;
    }

    const payload = event.payload as ThreadPayload;
    const classification = classifyThread(payload.name);
    
    const initialState: ThreadState = 'open';
    const threadId = event.threadId ?? event.id;

    // Create thread context
    const threadContext: ThreadContext = {
      threadId,
      channelId: event.channelId,
      type: classification.type,
      state: initialState,
      summary: '',
      decisions: [],
      artifacts: [],
      messageCount: 0,
      lastSummaryAt: 0,
    };

    // Initialize state in Redis
    await redisStore.setThreadState(threadId, initialState);
    
    // Persist to PostgreSQL
    await postgresStore.upsertThread(threadId, {
      channelId: event.channelId,
      type: classification.type,
      state: initialState,
      summary: '',
      messageCount: 0,
      lastSummaryAt: 0,
    });

    return threadContext;
  }
}

/** Factory function */
export function createThreadHandler(): ThreadHandler {
  return new DefaultThreadHandler();
}
