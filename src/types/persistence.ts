/**
 * Persistence types
 * Defines the three storage layers: Redis, PostgreSQL, and Vector
 */

import type { 
  OrgContext, 
  ProjectContext, 
  ThreadContext, 
  MemoryEntry,
  ThreadState 
} from './models.js';
import type { SessionData } from './models.js';

/** Redis Store — live state storage */
export interface RedisStore {
  getThreadState(threadId: string): Promise<ThreadState | null>;
  setThreadState(threadId: string, state: ThreadState): Promise<void>;
  getActiveSession(threadId: string): Promise<SessionData | null>;
  setActiveSession(threadId: string, session: SessionData): Promise<void>;
  incrementMessageCount(threadId: string): Promise<number>;
  close?(): Promise<void>;
}

/** PostgreSQL Store — structured memory storage */
export interface PostgresStore {
  // Organizations
  getOrg(guildId: string): Promise<OrgContext>;
  upsertOrg(guildId: string, data: Partial<OrgContext>): Promise<void>;
  
  // Projects
  getProject(channelId: string): Promise<ProjectContext>;
  upsertProject(channelId: string, data: Partial<ProjectContext>): Promise<void>;
  
  // Threads
  getThread(threadId: string): Promise<ThreadContext>;
  upsertThread(threadId: string, data: Partial<ThreadContext>): Promise<void>;
  
  // Memory
  storeMemory(entry: MemoryEntry): Promise<void>;
  getMemories(threadId: string): Promise<MemoryEntry[]>;
  
  // Lifecycle
  close?(): Promise<void>;
}

/** Vector metadata for semantic search */
export interface VectorMetadata {
  threadId: string;
  type: 'decision' | 'pattern' | 'error' | 'summary';
  content: string;
  timestamp: number;
}

/** Vector search result */
export interface VectorResult {
  metadata: VectorMetadata;
  score: number;
}

/** Vector Store — semantic context storage (pgvector) */
export interface VectorStore {
  store(id: string, content: string, metadata: Partial<VectorMetadata>): Promise<void>;
  query(queryText: string, topK?: number): Promise<VectorResult[]>;
}
