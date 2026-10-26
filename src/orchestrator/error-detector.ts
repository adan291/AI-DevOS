/**
 * Error Detector
 * Detects error patterns in messages and creates bug threads automatically
 * Requirements: 10.1, 10.2
 */

import type { NormalizedEvent, MessagePayload, ThreadPayload } from '../types/events.js';
import type { ThreadContext, ThreadState } from '../types/models.js';
import type { RedisStore, PostgresStore } from '../types/persistence.js';

/** Error detection result */
export interface ErrorDetectionResult {
  hasError: boolean;
  errorType?: 'exception' | 'stack_trace' | 'error_message' | 'failure';
  errorContext?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

/** Error patterns for detection */
const ERROR_PATTERNS = [
  // Specific exception types (check these first for more specific matches)
  { pattern: /TypeError:\s+.+/i, type: 'exception' as const, severity: 'high' as const },
  { pattern: /ReferenceError:\s+.+/i, type: 'exception' as const, severity: 'high' as const },
  { pattern: /SyntaxError:\s+.+/i, type: 'exception' as const, severity: 'critical' as const },
  { pattern: /Exception:\s+.+/i, type: 'exception' as const, severity: 'high' as const },
  
  // Stack traces
  { pattern: /at\s+[\w.<>]+\s*\([^)]+:\d+:\d+\)/i, type: 'stack_trace' as const, severity: 'high' as const },
  
  // Generic error messages (after specific types)
  { pattern: /Error:\s+.+/i, type: 'error_message' as const, severity: 'medium' as const },
  
  // Critical failure keywords
  { pattern: /\bcrash(ed|ing)?\b/i, type: 'failure' as const, severity: 'critical' as const },
  { pattern: /\bfatal\s+(error)?\b/i, type: 'failure' as const, severity: 'critical' as const },
  { pattern: /\bpanic\b/i, type: 'failure' as const, severity: 'critical' as const },
  { pattern: /\bsegmentation fault\b/i, type: 'failure' as const, severity: 'critical' as const },
  { pattern: /\bout of memory\b/i, type: 'failure' as const, severity: 'critical' as const },
  
  // Common error keywords
  { pattern: /\bfailed\b.*\b(to|with)\b/i, type: 'failure' as const, severity: 'medium' as const },
  
  // HTTP errors
  { pattern: /\b(4\d{2}|5\d{2})\s+(error|status)/i, type: 'error_message' as const, severity: 'medium' as const },
  { pattern: /\binternal server error\b/i, type: 'error_message' as const, severity: 'high' as const },
  
  // Build/test failures
  { pattern: /\bbuild failed\b/i, type: 'failure' as const, severity: 'high' as const },
  { pattern: /\btest(s)? failed\b/i, type: 'failure' as const, severity: 'medium' as const },
  { pattern: /\bcompilation error\b/i, type: 'failure' as const, severity: 'high' as const },
];

/**
 * Detects error patterns in a message
 */
export function detectError(content: string): ErrorDetectionResult {
  for (const { pattern, type, severity } of ERROR_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      // Extract context around the error (up to 100 chars before and after)
      const matchIndex = match.index ?? 0;
      const start = Math.max(0, matchIndex - 100);
      const end = Math.min(content.length, matchIndex + match[0].length + 100);
      const errorContext = content.slice(start, end);

      return {
        hasError: true,
        errorType: type,
        errorContext,
        severity,
      };
    }
  }

  return { hasError: false };
}

/** Error Detector Handler interface */
export interface ErrorDetectorHandler {
  /** Detect errors and create bug thread if needed */
  detectAndCreateThread(
    event: NormalizedEvent,
    redisStore: RedisStore,
    postgresStore: PostgresStore
  ): Promise<ThreadContext | null>;
}

/** Default implementation of ErrorDetectorHandler */
export class DefaultErrorDetectorHandler implements ErrorDetectorHandler {
  async detectAndCreateThread(
    event: NormalizedEvent,
    redisStore: RedisStore,
    postgresStore: PostgresStore
  ): Promise<ThreadContext | null> {
    // Only process message events
    if (event.type !== 'message') {
      return null;
    }

    const payload = event.payload as MessagePayload;
    
    // Skip bot messages
    if (payload.authorIsBot) {
      return null;
    }

    // Detect errors
    const detection = detectError(payload.content);
    
    if (!detection.hasError) {
      return null;
    }

    // Create bug thread
    const threadId = `bug-${event.id}-${Date.now()}`;
    const initialState: ThreadState = 'open';

    const threadContext: ThreadContext = {
      threadId,
      channelId: event.channelId,
      type: 'bug',
      state: initialState,
      summary: `Auto-detected ${detection.errorType}: ${detection.errorContext?.slice(0, 100)}...`,
      decisions: [],
      artifacts: [{
        id: `error-${threadId}`,
        type: 'error_log',
        content: JSON.stringify({
          errorType: detection.errorType,
          severity: detection.severity,
          context: detection.errorContext,
          originalMessage: payload.content,
          detectedAt: Date.now(),
        }),
        createdAt: Date.now(),
      }],
      messageCount: 0,
      lastSummaryAt: 0,
    };

    // Initialize state in Redis
    await redisStore.setThreadState(threadId, initialState);

    // Persist to PostgreSQL
    await postgresStore.upsertThread(threadId, {
      channelId: event.channelId,
      type: 'bug',
      state: initialState,
      summary: threadContext.summary,
      messageCount: 0,
      lastSummaryAt: 0,
    });

    return threadContext;
  }
}

/** Factory function */
export function createErrorDetectorHandler(): ErrorDetectorHandler {
  return new DefaultErrorDetectorHandler();
}
