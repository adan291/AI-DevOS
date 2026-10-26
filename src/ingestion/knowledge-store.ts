/**
 * Knowledge Store
 * 
 * Stores and retrieves knowledge from PostgreSQL with pgvector.
 * This is the central knowledge base for all ingested content.
 */

import { eq, and, sql, desc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { CodeEntity, ParseResult } from './code-parser.js';
import { EmbeddingsGenerator, type EmbeddingResult } from './embeddings.js';
import { knowledge } from '../persistence/schema.js';

type DrizzleDB = PostgresJsDatabase | NodePgDatabase;

/** Knowledge entry types */
export type KnowledgeType = 'code' | 'document' | 'video' | 'summary';

/** Knowledge entry */
export interface KnowledgeEntry {
  id: string;
  type: KnowledgeType;
  subtype?: string; // 'class', 'function', 'markdown', etc.
  name: string;
  content: string;
  summary?: string;
  embedding?: number[];
  metadata: {
    filePath?: string;
    language?: string;
    startLine?: number;
    endLine?: number;
    imports?: string[];
    exports?: string[];
    [key: string]: unknown;
  };
  createdAt: Date;
  updatedAt: Date;
}

/** Search result */
export interface SearchResult {
  entry: KnowledgeEntry;
  score: number;
}

/**
 * PostgreSQL-backed Knowledge Store with pgvector for semantic search
 */
export class KnowledgeStore {
  private db: DrizzleDB | null = null;
  private embeddings: EmbeddingsGenerator;
  private inMemoryFallback: Map<string, KnowledgeEntry> = new Map();
  private useInMemory: boolean = true;

  constructor(db?: DrizzleDB) {
    this.embeddings = new EmbeddingsGenerator();
    if (db) {
      this.db = db;
      this.useInMemory = false;
    }
  }

  /**
   * Set the database connection (for lazy initialization)
   */
  setDatabase(db: DrizzleDB): void {
    this.db = db;
    this.useInMemory = false;
  }

  /**
   * Check if using PostgreSQL or in-memory fallback
   */
  isUsingPostgres(): boolean {
    return !this.useInMemory && this.db !== null;
  }

  /**
   * Add a knowledge entry
   */
  async add(entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt' | 'embedding'>): Promise<KnowledgeEntry> {
    const id = `${entry.type}_${entry.name}_${Date.now()}`;
    
    // Generate embedding
    const embeddingResult = await this.embeddings.embed(
      `${entry.name}\n${entry.summary ?? ''}\n${entry.content.slice(0, 1000)}`
    );

    const fullEntry: KnowledgeEntry = {
      ...entry,
      id,
      embedding: embeddingResult.embedding,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (this.useInMemory || !this.db) {
      this.inMemoryFallback.set(id, fullEntry);
      return fullEntry;
    }

    // Store in PostgreSQL
    try {
      await this.db.insert(knowledge).values({
        id: fullEntry.id,
        type: fullEntry.type,
        subtype: fullEntry.subtype ?? null,
        name: fullEntry.name,
        content: fullEntry.content,
        summary: fullEntry.summary ?? null,
        embedding: fullEntry.embedding,
        metadata: fullEntry.metadata,
        filePath: fullEntry.metadata.filePath ?? null,
        createdAt: fullEntry.createdAt,
        updatedAt: fullEntry.updatedAt,
      });
    } catch (error) {
      // Fallback to in-memory on error
      console.warn('Failed to store in PostgreSQL, using in-memory fallback:', error);
      this.inMemoryFallback.set(id, fullEntry);
    }

    return fullEntry;
  }

  /**
   * Add multiple entries from parsed code
   */
  async addFromParseResult(result: ParseResult): Promise<KnowledgeEntry[]> {
    const entries: KnowledgeEntry[] = [];

    for (const entity of result.entities) {
      const entry = await this.add({
        type: 'code',
        subtype: entity.type,
        name: entity.name,
        content: entity.content,
        summary: entity.documentation,
        metadata: {
          filePath: entity.filePath,
          language: result.language,
          startLine: entity.startLine,
          endLine: entity.endLine,
          ...entity.metadata,
        },
      });
      entries.push(entry);
    }

    return entries;
  }

  /**
   * Search for entries by semantic similarity using pgvector
   */
  async search(query: string, options: {
    type?: KnowledgeType;
    subtype?: string;
    limit?: number;
  } = {}): Promise<SearchResult[]> {
    const { type, subtype, limit = 5 } = options;

    // Generate query embedding
    const queryEmbedding = await this.embeddings.embed(query);

    if (this.useInMemory || !this.db) {
      return this.searchInMemory(queryEmbedding.embedding, { type, subtype, limit });
    }

    // Use pgvector for similarity search
    try {
      const embeddingStr = `[${queryEmbedding.embedding.join(',')}]`;
      
      // Build conditions
      const conditions = [];
      if (type) {
        conditions.push(eq(knowledge.type, type));
      }
      if (subtype) {
        conditions.push(eq(knowledge.subtype, subtype));
      }
      // Only search entries that have embeddings
      conditions.push(sql`${knowledge.embedding} IS NOT NULL`);

      const whereClause = conditions.length > 0 
        ? and(...conditions)
        : sql`${knowledge.embedding} IS NOT NULL`;

      // Query with cosine distance (1 - cosine_similarity)
      const results = await this.db
        .select({
          id: knowledge.id,
          type: knowledge.type,
          subtype: knowledge.subtype,
          name: knowledge.name,
          content: knowledge.content,
          summary: knowledge.summary,
          embedding: knowledge.embedding,
          metadata: knowledge.metadata,
          filePath: knowledge.filePath,
          createdAt: knowledge.createdAt,
          updatedAt: knowledge.updatedAt,
          // Cosine distance: smaller is more similar
          distance: sql<number>`${knowledge.embedding} <=> ${embeddingStr}::vector`,
        })
        .from(knowledge)
        .where(whereClause)
        .orderBy(sql`${knowledge.embedding} <=> ${embeddingStr}::vector`)
        .limit(limit);

      return results.map((row) => ({
        entry: {
          id: row.id,
          type: row.type as KnowledgeType,
          subtype: row.subtype ?? undefined,
          name: row.name,
          content: row.content,
          summary: row.summary ?? undefined,
          embedding: row.embedding ?? undefined,
          metadata: (row.metadata as KnowledgeEntry['metadata']) ?? {},
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        // Convert distance to similarity score (1 - distance for cosine)
        score: 1 - (row.distance ?? 1),
      }));
    } catch (error) {
      console.warn('PostgreSQL search failed, falling back to in-memory:', error);
      return this.searchInMemory(queryEmbedding.embedding, { type, subtype, limit });
    }
  }

  /**
   * In-memory search fallback
   */
  private searchInMemory(queryEmbedding: number[], options: {
    type?: KnowledgeType;
    subtype?: string;
    limit?: number;
  }): SearchResult[] {
    const { type, subtype, limit = 5 } = options;
    const results: SearchResult[] = [];

    for (const entry of this.inMemoryFallback.values()) {
      if (type && entry.type !== type) continue;
      if (subtype && entry.subtype !== subtype) continue;

      if (entry.embedding) {
        const score = EmbeddingsGenerator.cosineSimilarity(
          queryEmbedding,
          entry.embedding
        );
        results.push({ entry, score });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get entry by ID
   */
  async get(id: string): Promise<KnowledgeEntry | undefined> {
    if (this.useInMemory || !this.db) {
      return this.inMemoryFallback.get(id);
    }

    try {
      const results = await this.db
        .select()
        .from(knowledge)
        .where(eq(knowledge.id, id))
        .limit(1);

      if (results.length === 0) {
        return undefined;
      }

      const row = results[0];
      return {
        id: row.id,
        type: row.type as KnowledgeType,
        subtype: row.subtype ?? undefined,
        name: row.name,
        content: row.content,
        summary: row.summary ?? undefined,
        embedding: row.embedding ?? undefined,
        metadata: (row.metadata as KnowledgeEntry['metadata']) ?? {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    } catch (error) {
      console.warn('PostgreSQL get failed, checking in-memory:', error);
      return this.inMemoryFallback.get(id);
    }
  }

  /**
   * Get entry by name
   */
  async getByName(name: string, type?: KnowledgeType): Promise<KnowledgeEntry | undefined> {
    if (this.useInMemory || !this.db) {
      for (const entry of this.inMemoryFallback.values()) {
        if (entry.name === name && (!type || entry.type === type)) {
          return entry;
        }
      }
      return undefined;
    }

    try {
      const conditions = [eq(knowledge.name, name)];
      if (type) {
        conditions.push(eq(knowledge.type, type));
      }

      const results = await this.db
        .select()
        .from(knowledge)
        .where(and(...conditions))
        .limit(1);

      if (results.length === 0) {
        return undefined;
      }

      const row = results[0];
      return {
        id: row.id,
        type: row.type as KnowledgeType,
        subtype: row.subtype ?? undefined,
        name: row.name,
        content: row.content,
        summary: row.summary ?? undefined,
        embedding: row.embedding ?? undefined,
        metadata: (row.metadata as KnowledgeEntry['metadata']) ?? {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    } catch (error) {
      console.warn('PostgreSQL getByName failed, checking in-memory:', error);
      for (const entry of this.inMemoryFallback.values()) {
        if (entry.name === name && (!type || entry.type === type)) {
          return entry;
        }
      }
      return undefined;
    }
  }

  /**
   * List all entries
   */
  async list(options: { type?: KnowledgeType; limit?: number } = {}): Promise<KnowledgeEntry[]> {
    const { type, limit = 100 } = options;

    if (this.useInMemory || !this.db) {
      const results: KnowledgeEntry[] = [];
      for (const entry of this.inMemoryFallback.values()) {
        if (type && entry.type !== type) continue;
        results.push(entry);
        if (results.length >= limit) break;
      }
      return results;
    }

    try {
      const conditions = type ? [eq(knowledge.type, type)] : [];
      
      const results = await this.db
        .select()
        .from(knowledge)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(knowledge.createdAt))
        .limit(limit);

      return results.map((row) => ({
        id: row.id,
        type: row.type as KnowledgeType,
        subtype: row.subtype ?? undefined,
        name: row.name,
        content: row.content,
        summary: row.summary ?? undefined,
        embedding: row.embedding ?? undefined,
        metadata: (row.metadata as KnowledgeEntry['metadata']) ?? {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    } catch (error) {
      console.warn('PostgreSQL list failed, using in-memory:', error);
      const results: KnowledgeEntry[] = [];
      for (const entry of this.inMemoryFallback.values()) {
        if (type && entry.type !== type) continue;
        results.push(entry);
        if (results.length >= limit) break;
      }
      return results;
    }
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{ total: number; byType: Record<string, number> }> {
    if (this.useInMemory || !this.db) {
      const byType: Record<string, number> = {};
      for (const entry of this.inMemoryFallback.values()) {
        const key = entry.subtype ? `${entry.type}.${entry.subtype}` : entry.type;
        byType[key] = (byType[key] ?? 0) + 1;
      }
      return { total: this.inMemoryFallback.size, byType };
    }

    try {
      // Get total count
      const totalResult = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(knowledge);
      const total = Number(totalResult[0]?.count ?? 0);

      // Get counts by type and subtype
      const typeResults = await this.db
        .select({
          type: knowledge.type,
          subtype: knowledge.subtype,
          count: sql<number>`count(*)`,
        })
        .from(knowledge)
        .groupBy(knowledge.type, knowledge.subtype);

      const byType: Record<string, number> = {};
      for (const row of typeResults) {
        const key = row.subtype ? `${row.type}.${row.subtype}` : row.type;
        byType[key] = Number(row.count);
      }

      return { total, byType };
    } catch (error) {
      console.warn('PostgreSQL getStats failed, using in-memory:', error);
      const byType: Record<string, number> = {};
      for (const entry of this.inMemoryFallback.values()) {
        const key = entry.subtype ? `${entry.type}.${entry.subtype}` : entry.type;
        byType[key] = (byType[key] ?? 0) + 1;
      }
      return { total: this.inMemoryFallback.size, byType };
    }
  }

  /**
   * Clear all entries
   */
  async clear(): Promise<void> {
    this.inMemoryFallback.clear();
    
    if (!this.useInMemory && this.db) {
      try {
        await this.db.delete(knowledge);
      } catch (error) {
        console.warn('PostgreSQL clear failed:', error);
      }
    }
  }

  /**
   * Delete entries by file path (useful for re-ingestion)
   */
  async deleteByFilePath(filePath: string): Promise<number> {
    let count = 0;

    // Delete from in-memory
    for (const [id, entry] of this.inMemoryFallback.entries()) {
      if (entry.metadata.filePath === filePath) {
        this.inMemoryFallback.delete(id);
        count++;
      }
    }

    if (!this.useInMemory && this.db) {
      try {
        const result = await this.db
          .delete(knowledge)
          .where(eq(knowledge.filePath, filePath));
        // Note: Drizzle doesn't return count directly, so we use in-memory count as fallback
      } catch (error) {
        console.warn('PostgreSQL deleteByFilePath failed:', error);
      }
    }

    return count;
  }

  /**
   * Migrate in-memory entries to PostgreSQL
   */
  async migrateToPostgres(): Promise<number> {
    if (this.useInMemory || !this.db) {
      console.warn('Cannot migrate: no PostgreSQL connection');
      return 0;
    }

    let migrated = 0;
    for (const entry of this.inMemoryFallback.values()) {
      try {
        await this.db.insert(knowledge).values({
          id: entry.id,
          type: entry.type,
          subtype: entry.subtype ?? null,
          name: entry.name,
          content: entry.content,
          summary: entry.summary ?? null,
          embedding: entry.embedding,
          metadata: entry.metadata,
          filePath: entry.metadata.filePath ?? null,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        }).onConflictDoNothing();
        migrated++;
      } catch (error) {
        console.warn(`Failed to migrate entry ${entry.id}:`, error);
      }
    }

    return migrated;
  }
}

/** Global knowledge store instance */
let globalKnowledgeStore: KnowledgeStore | null = null;

export function getKnowledgeStore(): KnowledgeStore {
  if (!globalKnowledgeStore) {
    globalKnowledgeStore = new KnowledgeStore();
  }
  return globalKnowledgeStore;
}

export function setKnowledgeStoreDatabase(db: DrizzleDB): void {
  const store = getKnowledgeStore();
  store.setDatabase(db);
}

export function createKnowledgeStore(db?: DrizzleDB): KnowledgeStore {
  return new KnowledgeStore(db);
}
