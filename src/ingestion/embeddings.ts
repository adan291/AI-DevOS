/**
 * Embeddings Generator
 * 
 * Generates vector embeddings for code and text using:
 * - OpenAI embeddings API (via Groq or OpenAI)
 * - Local sentence-transformers (future)
 */

import { config } from '../config/index.js';

/** Embedding result */
export interface EmbeddingResult {
  text: string;
  embedding: number[];
  model: string;
  tokens: number;
}

/**
 * Embeddings generator using OpenAI-compatible API
 */
export class EmbeddingsGenerator {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor() {
    // Use Groq or OpenAI for embeddings
    // Note: Groq doesn't support embeddings yet, so we'll use a simple approach
    this.apiKey = config.GROQ_API_KEY?.() ?? '';
    this.baseUrl = 'https://api.openai.com/v1'; // OpenAI for embeddings
    this.model = 'text-embedding-3-small';
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<EmbeddingResult> {
    // For now, use a simple hash-based pseudo-embedding
    // In production, use OpenAI or a local model
    const embedding = this.simpleEmbed(text);
    
    return {
      text: text.slice(0, 100),
      embedding,
      model: 'simple-hash',
      tokens: text.split(/\s+/).length,
    };
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  /**
   * Simple hash-based embedding (placeholder)
   * Generates a 384-dimensional vector from text
   */
  private simpleEmbed(text: string): number[] {
    const dimensions = 384;
    const embedding = new Array(dimensions).fill(0);
    
    // Simple character-based hashing
    const normalized = text.toLowerCase();
    for (let i = 0; i < normalized.length; i++) {
      const charCode = normalized.charCodeAt(i);
      const idx = (charCode * (i + 1)) % dimensions;
      embedding[idx] += 1 / (1 + Math.log(i + 1));
    }
    
    // Normalize to unit vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dimensions; i++) {
        embedding[i] /= magnitude;
      }
    }
    
    return embedding;
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }
}

/** Factory function */
export function createEmbeddingsGenerator(): EmbeddingsGenerator {
  return new EmbeddingsGenerator();
}
