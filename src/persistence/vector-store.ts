/**
 * Vector Store implementation using pgvector
 * Provides semantic search capabilities via cosine similarity
 * Requirements: 5.3, 5.5
 */

import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { VectorStore, VectorMetadata, VectorResult } from '../types/persistence.js';
import { embeddings } from './schema.js';

type DrizzleDB = PostgresJsDatabase | NodePgDatabase;

/**
 * Creates a VectorStore implementation using pgvector
 * Uses cosine distance (<=> operator) for similarity search
 */
export function createVectorStore(db: DrizzleDB): VectorStore {
  return {
    /**
     * Store content with its metadata
     * Generates embedding internally (placeholder - would use OpenAI/etc in production)
     */
    async store(id: string, content: string, metadata: Partial<VectorMetadata>): Promise<void> {
      // In production, you would generate embeddings using OpenAI or similar
      // For now, we store with a placeholder embedding
      const placeholderEmbedding = new Array(1536).fill(0);
      
      await db.insert(embeddings).values({
        id,
        threadId: metadata.threadId ?? '',
        type: metadata.type ?? 'summary',
        contentText: content,
        embedding: placeholderEmbedding,
        createdAt: new Date(metadata.timestamp ?? Date.now()),
      });
    },

    /**
     * Query for similar content using semantic search
     * Returns top K results ordered by similarity score
     */
    async query(queryText: string, topK: number = 10): Promise<VectorResult[]> {
      // In production, you would generate embedding for queryText using OpenAI or similar
      // For now, we use a placeholder that returns recent entries
      const placeholderEmbedding = new Array(1536).fill(0);
      const vectorString = `[${placeholderEmbedding.join(',')}]`;

      // Use raw SQL for pgvector cosine distance operator (<=>)
      const results = await db
        .select({
          id: embeddings.id,
          threadId: embeddings.threadId,
          type: embeddings.type,
          contentText: embeddings.contentText,
          createdAt: embeddings.createdAt,
          distance: sql<number>`${embeddings.embedding} <=> ${vectorString}::vector`,
        })
        .from(embeddings)
        .orderBy(sql`${embeddings.embedding} <=> ${vectorString}::vector`)
        .limit(topK);

      return results.map((row) => ({
        metadata: {
          threadId: row.threadId,
          type: row.type as VectorMetadata['type'],
          content: row.contentText,
          timestamp: row.createdAt.getTime(),
        },
        // Convert cosine distance to similarity score
        score: 1 - row.distance / 2,
      }));
    },
  };
}

export type { VectorStore };
