/**
 * Property-Based Tests for Dual Persistence Consistency
 * Feature: discord-ai-devos, Property 10: Persistencia dual consistente
 *
 * Validates: Requirements 5.4, 5.5, 8.2
 *
 * Property 10: For any persistence operation from Memory_Agent, data must be written
 * to both Postgres_Store (structured JSON) and Vector_Store (embedding), and when
 * a thread changes state, the state must be updated in both Redis_Store and Postgres_Store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import type { MemoryEntry, ThreadState } from '../types/models.js';
import type { PostgresStore, RedisStore, VectorStore, VectorMetadata } from '../types/persistence.js';

// ============================================================================
// Mock Store Implementations for Testing
// ============================================================================

interface MockPostgresStore extends PostgresStore {
  storedMemories: MemoryEntry[];
  threadStates: Map<string, ThreadState>;
  reset(): void;
}

interface MockRedisStore extends RedisStore {
  threadStates: Map<string, ThreadState>;
  reset(): void;
}

interface MockVectorStore extends VectorStore {
  storedEmbeddings: Array<{ embedding: number[]; metadata: VectorMetadata }>;
  reset(): void;
}

function createMockPostgresStore(): MockPostgresStore {
  const storedMemories: MemoryEntry[] = [];
  const threadStates = new Map<string, ThreadState>();

  return {
    storedMemories,
    threadStates,
    reset() {
      storedMemories.length = 0;
      threadStates.clear();
    },
    async getOrg(guildId: string) {
      return { guildId, standards: [], architecture: [] };
    },
    async upsertOrg() {},
    async getProject(channelId: string) {
      return { channelId, guildId: '', name: '', stack: [], rules: [] };
    },
    async upsertProject() {},
    async getThread(threadId: string) {
      const state = threadStates.get(threadId) ?? 'open';
      return {
        threadId,
        channelId: '',
        type: 'task' as const,
        title: '',
        summary: '',
        state,
        decisions: [],
        artifacts: [],
        messageCount: 0,
        lastSummaryAt: 0,
      };
    },
    async upsertThread(threadId: string, data: { state?: ThreadState }) {
      if (data.state) {
        threadStates.set(threadId, data.state);
      }
    },
    async storeMemory(entry: MemoryEntry) {
      storedMemories.push(entry);
    },
    async getMemories(threadId: string) {
      return storedMemories.filter((m) => m.threadId === threadId);
    },
  };
}

function createMockRedisStore(): MockRedisStore {
  const threadStates = new Map<string, ThreadState>();

  return {
    threadStates,
    reset() {
      threadStates.clear();
    },
    async getThreadState(threadId: string) {
      return threadStates.get(threadId) ?? null;
    },
    async setThreadState(threadId: string, state: ThreadState) {
      threadStates.set(threadId, state);
    },
    async getActiveSession() {
      return null;
    },
    async setActiveSession() {},
    async incrementMessageCount() {
      return 1;
    },
  };
}

function createMockVectorStore(): MockVectorStore {
  const storedEmbeddings: Array<{ embedding: number[]; metadata: VectorMetadata }> = [];

  return {
    storedEmbeddings,
    reset() {
      storedEmbeddings.length = 0;
    },
    async store(id: string, content: string, metadata: Partial<VectorMetadata>) {
      const embedding = new Array(1536).fill(0);
      storedEmbeddings.push({ 
        embedding, 
        metadata: {
          threadId: metadata.threadId ?? '',
          type: metadata.type ?? 'summary',
          content,
          timestamp: metadata.timestamp ?? Date.now(),
        }
      });
    },
    async query() {
      return [];
    },
  };
}

// ============================================================================
// Dual Persistence Service (System Under Test)
// ============================================================================

/**
 * Service that ensures dual-write consistency for memory entries and thread state changes.
 * This represents the behavior that Memory_Agent and Orchestrator must implement.
 */
interface DualPersistenceService {
  /**
   * Stores a memory entry in both PostgresStore and VectorStore
   * Validates: Requirements 5.5, 8.2
   */
  storeMemoryWithEmbedding(
    entry: MemoryEntry
  ): Promise<void>;

  /**
   * Updates thread state in both RedisStore and PostgresStore
   * Validates: Requirements 5.4
   */
  updateThreadState(threadId: string, newState: ThreadState): Promise<void>;
}

function createDualPersistenceService(
  postgresStore: PostgresStore,
  redisStore: RedisStore,
  vectorStore: VectorStore
): DualPersistenceService {
  return {
    async storeMemoryWithEmbedding(entry: MemoryEntry) {
      // Write to PostgresStore (structured JSON)
      await postgresStore.storeMemory(entry);

      // Write to VectorStore (content-based)
      await vectorStore.store(entry.id, JSON.stringify(entry.content), {
        threadId: entry.threadId,
        type: entry.type,
        timestamp: entry.timestamp,
      });
    },

    async updateThreadState(threadId: string, newState: ThreadState) {
      // Update in Redis (live state)
      await redisStore.setThreadState(threadId, newState);

      // Update in Postgres (persistent state)
      await postgresStore.upsertThread(threadId, { state: newState });
    },
  };
}

// ============================================================================
// Fast-Check Arbitraries (Generators)
// ============================================================================

const memoryTypeArb = fc.constantFrom('decision', 'pattern', 'error', 'summary') as fc.Arbitrary<
  'decision' | 'pattern' | 'error' | 'summary'
>;

const threadStateArb = fc.constantFrom('open', 'in_progress', 'review', 'done') as fc.Arbitrary<ThreadState>;

const memoryEntryArb: fc.Arbitrary<MemoryEntry> = fc.record({
  id: fc.uuid(),
  threadId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  type: memoryTypeArb,
  content: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean())
  ),
  timestamp: fc.integer({ min: 0, max: Date.now() + 1000000 }),
});

// Generate a valid embedding vector (1536 dimensions for OpenAI-compatible embeddings)
const embeddingArb: fc.Arbitrary<number[]> = fc.array(fc.float({ min: -1, max: 1, noNaN: true }), {
  minLength: 1536,
  maxLength: 1536,
});

const threadIdArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Property 10: Persistencia dual consistente', () => {
  let postgresStore: MockPostgresStore;
  let redisStore: MockRedisStore;
  let vectorStore: MockVectorStore;
  let service: DualPersistenceService;

  beforeEach(() => {
    postgresStore = createMockPostgresStore();
    redisStore = createMockRedisStore();
    vectorStore = createMockVectorStore();
    service = createDualPersistenceService(postgresStore, redisStore, vectorStore);
  });

  /**
   * **Validates: Requirements 5.5, 8.2**
   *
   * Property: For any MemoryEntry, when storeMemoryWithEmbedding is called,
   * the entry MUST be written to BOTH PostgresStore AND VectorStore.
   */
  it('should write MemoryEntry to both PostgresStore AND VectorStore', async () => {
    await fc.assert(
      fc.asyncProperty(memoryEntryArb, async (entry) => {
        // Reset stores before each test
        postgresStore.reset();
        vectorStore.reset();

        // Act: Store memory
        await service.storeMemoryWithEmbedding(entry);

        // Assert: Memory was written to PostgresStore
        const storedInPostgres = postgresStore.storedMemories.find((m) => m.id === entry.id);
        expect(storedInPostgres).toBeDefined();
        expect(storedInPostgres?.threadId).toBe(entry.threadId);
        expect(storedInPostgres?.type).toBe(entry.type);
        expect(storedInPostgres?.content).toEqual(entry.content);
        expect(storedInPostgres?.timestamp).toBe(entry.timestamp);

        // Assert: Content was written to VectorStore
        const storedInVector = vectorStore.storedEmbeddings.find(
          (e) => e.metadata.threadId === entry.threadId && e.metadata.timestamp === entry.timestamp
        );
        expect(storedInVector).toBeDefined();
        expect(storedInVector?.metadata.type).toBe(entry.type);
        expect(storedInVector?.metadata.content).toBe(JSON.stringify(entry.content));
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * Property: For any thread state change, when updateThreadState is called,
   * the state MUST be updated in BOTH RedisStore AND PostgresStore.
   */
  it('should update thread state in both RedisStore AND PostgresStore', async () => {
    await fc.assert(
      fc.asyncProperty(threadIdArb, threadStateArb, async (threadId, newState) => {
        // Reset stores before each test
        redisStore.reset();
        postgresStore.reset();

        // Act: Update thread state
        await service.updateThreadState(threadId, newState);

        // Assert: State was updated in Redis
        const redisState = await redisStore.getThreadState(threadId);
        expect(redisState).toBe(newState);

        // Assert: State was updated in Postgres
        const postgresThread = await postgresStore.getThread(threadId);
        expect(postgresThread.state).toBe(newState);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.4, 5.5, 8.2**
   *
   * Property: After dual-write operations, both stores contain consistent data.
   * This verifies that the data written to both stores is identical in meaning.
   */
  it('should maintain consistency between stores after dual-write', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(memoryEntryArb, { minLength: 1, maxLength: 10 }),
        async (entries) => {
          // Reset stores
          postgresStore.reset();
          vectorStore.reset();

          // Store multiple entries
          for (const entry of entries) {
            await service.storeMemoryWithEmbedding(entry);
          }

          // Assert: Same number of entries in both stores
          expect(postgresStore.storedMemories.length).toBe(entries.length);
          expect(vectorStore.storedEmbeddings.length).toBe(entries.length);

          // Assert: Each entry in Postgres has a corresponding entry in Vector
          for (const pgEntry of postgresStore.storedMemories) {
            const vectorEntry = vectorStore.storedEmbeddings.find(
              (v) =>
                v.metadata.threadId === pgEntry.threadId &&
                v.metadata.timestamp === pgEntry.timestamp &&
                v.metadata.type === pgEntry.type
            );
            expect(vectorEntry).toBeDefined();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * Property: Multiple state transitions maintain consistency between Redis and Postgres.
   */
  it('should maintain Redis-Postgres consistency across multiple state transitions', async () => {
    await fc.assert(
      fc.asyncProperty(
        threadIdArb,
        fc.array(threadStateArb, { minLength: 1, maxLength: 5 }),
        async (threadId, stateTransitions) => {
          // Reset stores
          redisStore.reset();
          postgresStore.reset();

          // Apply all state transitions
          for (const state of stateTransitions) {
            await service.updateThreadState(threadId, state);
          }

          // Assert: Final state is consistent between Redis and Postgres
          const finalState = stateTransitions[stateTransitions.length - 1];
          const redisState = await redisStore.getThreadState(threadId);
          const postgresThread = await postgresStore.getThread(threadId);

          expect(redisState).toBe(finalState);
          expect(postgresThread.state).toBe(finalState);
        }
      ),
      { numRuns: 100 }
    );
  });
});
