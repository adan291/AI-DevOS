/**
 * Ingestion Module
 * 
 * Handles ingestion of code, documents, and other content into the knowledge base.
 */

export { CodeParser, createCodeParser, type CodeEntity, type ParseResult } from './code-parser.js';
export { EmbeddingsGenerator, createEmbeddingsGenerator, type EmbeddingResult } from './embeddings.js';
export { 
  KnowledgeStore, 
  getKnowledgeStore, 
  createKnowledgeStore,
  type KnowledgeType,
  type KnowledgeEntry,
  type SearchResult,
} from './knowledge-store.js';
export {
  IngestionService,
  getIngestionService,
  createIngestionService,
  type IngestionStatus,
  type IngestionJob,
} from './ingestion-service.js';
