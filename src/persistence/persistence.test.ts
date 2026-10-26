/**
 * Unit Tests for Persistence Layer
 * Tests PostgresStore, RedisStore, and VectorStore interfaces using mock implementations
 * 
 * Requirements: 5.1, 5.2, 5.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { 
  PostgresStore, 
  RedisStore, 
  VectorStore, 
  VectorMetadata, 
  VectorResult 
} from '../types/persistence.js';
import type { 
  OrgContext, 
  ProjectContext, 
  ThreadContext, 
  MemoryEntry, 
  ThreadState, 
  SessionData 
} from '../types/models.js';

// ============================================================================
// Mock PostgresStore Implementation
// ============================================================================

interface MockPostgresStoreData {
  orgs: Map<string, OrgContext>;
  projects: Map<string, ProjectContext>;
  threads: Map<string, ThreadContext>;
  memories: MemoryEntry[];
}

function createMockPostgresStore(): PostgresStore & { _data: MockPostgresStoreData } {
  const _data: MockPostgresStoreData = {
    orgs: new Map(),
    projects: new Map(),
    threads: new Map(),
    memories: [],
  };

  return {
    _data,

    // Organizations
    async getOrg(guildId: string): Promise<OrgContext> {
      const org = _data.orgs.get(guildId);
      if (!org) {
        return { guildId, standards: [], architecture: [] };
      }
      return org;
    },

    async upsertOrg(guildId: string, data: Partial<OrgContext>): Promise<void> {
      const existing = _data.orgs.get(guildId);
      if (existing) {
        _data.orgs.set(guildId, { ...existing, ...data, guildId });
      } else {
        _data.orgs.set(guildId, {
          guildId,
          standards: data.standards ?? [],
          architecture: data.architecture ?? [],
        });
      }
    },

    // Projects
    async getProject(channelId: string): Promise<ProjectContext> {
      const project = _data.projects.get(channelId);
      if (!project) {
        return { channelId, guildId: '', name: '', stack: [], rules: [] };
      }
      return project;
    },

    async upsertProject(channelId: string, data: Partial<ProjectContext>): Promise<void> {
      const existing = _data.projects.get(channelId);
      if (existing) {
        _data.projects.set(channelId, { ...existing, ...data, channelId });
      } else {
        _data.projects.set(channelId, {
          channelId,
          guildId: data.guildId ?? '',
          name: data.name ?? '',
          stack: data.stack ?? [],
          rules: data.rules ?? [],
        });
      }
    },

    // Threads
    async getThread(threadId: string): Promise<ThreadContext> {
      const thread = _data.threads.get(threadId);
      if (!thread) {
        return {
          threadId,
          channelId: '',
          type: 'task',
          title: '',
          summary: '',
          state: 'open',
          decisions: [],
          artifacts: [],
          messageCount: 0,
          lastSummaryAt: 0,
        };
      }
      return thread;
    },

    async upsertThread(threadId: string, data: Partial<ThreadContext>): Promise<void> {
      const existing = _data.threads.get(threadId);
      if (existing) {
        _data.threads.set(threadId, { ...existing, ...data, threadId });
      } else {
        _data.threads.set(threadId, {
          threadId,
          channelId: data.channelId ?? '',
          type: data.type ?? 'task',
          title: data.title ?? '',
          summary: data.summary ?? '',
          state: data.state ?? 'open',
          decisions: data.decisions ?? [],
          artifacts: data.artifacts ?? [],
          messageCount: data.messageCount ?? 0,
          lastSummaryAt: data.lastSummaryAt ?? 0,
        });
      }
    },

    // Memory
    async storeMemory(entry: MemoryEntry): Promise<void> {
      _data.memories.push(entry);
    },

    async getMemories(threadId: string): Promise<MemoryEntry[]> {
      return _data.memories.filter((m) => m.threadId === threadId);
    },
  };
}


// ============================================================================
// Mock RedisStore Implementation
// ============================================================================

interface MockRedisStoreData {
  threadStates: Map<string, ThreadState>;
  sessions: Map<string, SessionData>;
  messageCounts: Map<string, number>;
}

function createMockRedisStore(): RedisStore & { _data: MockRedisStoreData } {
  const _data: MockRedisStoreData = {
    threadStates: new Map(),
    sessions: new Map(),
    messageCounts: new Map(),
  };

  return {
    _data,

    async getThreadState(threadId: string): Promise<ThreadState | null> {
      return _data.threadStates.get(threadId) ?? null;
    },

    async setThreadState(threadId: string, state: ThreadState): Promise<void> {
      _data.threadStates.set(threadId, state);
    },

    async getActiveSession(threadId: string): Promise<SessionData | null> {
      return _data.sessions.get(threadId) ?? null;
    },

    async setActiveSession(threadId: string, session: SessionData): Promise<void> {
      _data.sessions.set(threadId, session);
    },

    async incrementMessageCount(threadId: string): Promise<number> {
      const current = _data.messageCounts.get(threadId) ?? 0;
      const newCount = current + 1;
      _data.messageCounts.set(threadId, newCount);
      return newCount;
    },
  };
}

// ============================================================================
// Mock VectorStore Implementation
// ============================================================================

interface StoredEmbedding {
  embedding: number[];
  metadata: VectorMetadata;
}

function createMockVectorStore(): VectorStore & { _data: StoredEmbedding[] } {
  const _data: StoredEmbedding[] = [];

  return {
    _data,

    async store(id: string, content: string, metadata: Partial<VectorMetadata>): Promise<void> {
      const embedding = new Array(1536).fill(0);
      _data.push({ 
        embedding, 
        metadata: {
          threadId: metadata.threadId ?? '',
          type: metadata.type ?? 'summary',
          content,
          timestamp: metadata.timestamp ?? Date.now(),
        } 
      });
    },

    async query(queryText: string, topK: number = 10): Promise<VectorResult[]> {
      const results = _data.map((stored) => ({
        metadata: stored.metadata,
        score: 0.9,
      }));
      return results.slice(0, topK);
    },
  };
}


// ============================================================================
// PostgresStore Unit Tests
// ============================================================================

describe('PostgresStore', () => {
  let store: ReturnType<typeof createMockPostgresStore>;

  beforeEach(() => {
    store = createMockPostgresStore();
  });

  describe('Organizations (getOrg/upsertOrg)', () => {
    it('should return default context when org not found', async () => {
      const result = await store.getOrg('unknown-guild');
      expect(result).toEqual({ guildId: 'unknown-guild', standards: [], architecture: [] });
    });

    it('should create new org with upsertOrg', async () => {
      await store.upsertOrg('guild-123', { standards: ['TypeScript'], architecture: ['microservices'] });
      const result = await store.getOrg('guild-123');
      expect(result.guildId).toBe('guild-123');
      expect(result.standards).toEqual(['TypeScript']);
    });

    it('should update existing org with upsertOrg', async () => {
      await store.upsertOrg('guild-123', { standards: ['JavaScript'] });
      await store.upsertOrg('guild-123', { standards: ['TypeScript'] });
      const result = await store.getOrg('guild-123');
      expect(result.standards).toEqual(['TypeScript']);
    });
  });

  describe('Projects (getProject/upsertProject)', () => {
    it('should return default context when project not found', async () => {
      const result = await store.getProject('unknown-channel');
      expect(result).toEqual({ channelId: 'unknown-channel', guildId: '', name: '', stack: [], rules: [] });
    });

    it('should create new project with upsertProject', async () => {
      await store.upsertProject('channel-123', { guildId: 'guild-123', name: 'AI DevOS', stack: ['TypeScript'] });
      const result = await store.getProject('channel-123');
      expect(result.channelId).toBe('channel-123');
      expect(result.name).toBe('AI DevOS');
    });
  });

  describe('Threads (getThread/upsertThread)', () => {
    it('should return default context when thread not found', async () => {
      const result = await store.getThread('unknown-thread');
      expect(result.threadId).toBe('unknown-thread');
      expect(result.state).toBe('open');
    });

    it('should create new thread with upsertThread', async () => {
      await store.upsertThread('thread-123', { channelId: 'channel-123', type: 'feature', state: 'in_progress' });
      const result = await store.getThread('thread-123');
      expect(result.threadId).toBe('thread-123');
      expect(result.type).toBe('feature');
      expect(result.state).toBe('in_progress');
    });

    it('should update thread state correctly', async () => {
      await store.upsertThread('thread-123', { type: 'bug', state: 'open' });
      await store.upsertThread('thread-123', { state: 'review' });
      const result = await store.getThread('thread-123');
      expect(result.state).toBe('review');
      expect(result.type).toBe('bug');
    });
  });

  describe('Memory (storeMemory/getMemories)', () => {
    it('should store and retrieve memory entries', async () => {
      const entry: MemoryEntry = { id: 'mem-123', threadId: 'thread-123', type: 'decision', content: { decision: 'Use PostgreSQL' }, timestamp: Date.now() };
      await store.storeMemory(entry);
      const memories = await store.getMemories('thread-123');
      expect(memories).toHaveLength(1);
      expect(memories[0]).toEqual(entry);
    });

    it('should return empty array when no memories exist', async () => {
      const memories = await store.getMemories('unknown-thread');
      expect(memories).toEqual([]);
    });

    it('should filter memories by threadId', async () => {
      await store.storeMemory({ id: 'mem-1', threadId: 'thread-A', type: 'decision', content: {}, timestamp: 1000 });
      await store.storeMemory({ id: 'mem-2', threadId: 'thread-B', type: 'pattern', content: {}, timestamp: 2000 });
      const memoriesA = await store.getMemories('thread-A');
      const memoriesB = await store.getMemories('thread-B');
      expect(memoriesA).toHaveLength(1);
      expect(memoriesB).toHaveLength(1);
    });
  });
});


// ============================================================================
// RedisStore Unit Tests
// ============================================================================

describe('RedisStore', () => {
  let store: ReturnType<typeof createMockRedisStore>;

  beforeEach(() => {
    store = createMockRedisStore();
  });

  describe('Thread State (getThreadState/setThreadState)', () => {
    it('should return null when thread state not found', async () => {
      const result = await store.getThreadState('unknown-thread');
      expect(result).toBeNull();
    });

    it('should set and get thread state', async () => {
      await store.setThreadState('thread-123', 'in_progress');
      const result = await store.getThreadState('thread-123');
      expect(result).toBe('in_progress');
    });

    it('should update existing thread state', async () => {
      await store.setThreadState('thread-123', 'open');
      await store.setThreadState('thread-123', 'done');
      const result = await store.getThreadState('thread-123');
      expect(result).toBe('done');
    });
  });

  describe('Active Session (getActiveSession/setActiveSession)', () => {
    it('should return null when no active session exists', async () => {
      const result = await store.getActiveSession('unknown-thread');
      expect(result).toBeNull();
    });

    it('should set and get active session', async () => {
      const session: SessionData = { plan: ['coordinator', 'architect'], currentIndex: 1, results: [] };
      await store.setActiveSession('thread-123', session);
      const result = await store.getActiveSession('thread-123');
      expect(result).toEqual(session);
    });
  });

  describe('Message Count (incrementMessageCount)', () => {
    it('should start count at 1 for new thread', async () => {
      const count = await store.incrementMessageCount('new-thread');
      expect(count).toBe(1);
    });

    it('should increment count correctly', async () => {
      const count1 = await store.incrementMessageCount('thread-123');
      const count2 = await store.incrementMessageCount('thread-123');
      expect(count1).toBe(1);
      expect(count2).toBe(2);
    });
  });
});


// ============================================================================
// VectorStore Unit Tests
// ============================================================================

describe('VectorStore', () => {
  let store: ReturnType<typeof createMockVectorStore>;

  beforeEach(() => {
    store = createMockVectorStore();
  });

  describe('Store Content', () => {
    it('should store content with metadata', async () => {
      await store.store('id-1', 'Use PostgreSQL for persistence', { threadId: 'thread-123', type: 'decision', timestamp: Date.now() });
      expect(store._data).toHaveLength(1);
      expect(store._data[0].metadata.content).toBe('Use PostgreSQL for persistence');
    });

    it('should store multiple entries', async () => {
      await store.store('id-1', 'Content A', { threadId: 't1', type: 'decision', timestamp: 1000 });
      await store.store('id-2', 'Content B', { threadId: 't2', type: 'pattern', timestamp: 2000 });
      expect(store._data).toHaveLength(2);
    });
  });

  describe('Query by Text', () => {
    it('should return empty array when no content stored', async () => {
      const results = await store.query('search text', 5);
      expect(results).toEqual([]);
    });

    it('should return stored results', async () => {
      await store.store('id-1', 'First entry', { threadId: 't1', type: 'decision', timestamp: 1000 });
      await store.store('id-2', 'Second entry', { threadId: 't2', type: 'pattern', timestamp: 2000 });
      const results = await store.query('search', 3);
      expect(results).toHaveLength(2);
    });

    it('should respect topK limit', async () => {
      for (let i = 0; i < 10; i++) {
        await store.store(`id-${i}`, `Entry ${i}`, { threadId: `t${i}`, type: 'decision', timestamp: i * 1000 });
      }
      const results = await store.query('search', 3);
      expect(results).toHaveLength(3);
    });
  });
});
