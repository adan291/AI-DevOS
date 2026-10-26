/**
 * Knowledge Base Tools
 * 
 * Tools for searching and querying the knowledge base (pgvector).
 */

import type { Tool, ToolResult, ToolParameter } from './base-tool.js';
import { getKnowledgeStore, type KnowledgeStore } from '../../ingestion/knowledge-store.js';

/** Search code in the knowledge base */
export class SearchCodeTool implements Tool {
  name = 'search_code';
  description = 'Search for code snippets, classes, methods, or patterns in the indexed codebase. Returns relevant code with context.';
  parameters: ToolParameter[] = [
    { name: 'query', type: 'string', description: 'Natural language query describing what code to find', required: true },
    { name: 'subtype', type: 'string', description: 'Filter by code type: class, function, interface, type', required: false },
    { name: 'limit', type: 'number', description: 'Maximum number of results (default: 5)', required: false, default: 5 },
  ];

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args.query as string;
    const subtype = args.subtype as string | undefined;
    const limit = (args.limit as number) ?? 5;

    if (!query) {
      return { success: false, error: 'Query is required' };
    }

    try {
      const store = getKnowledgeStore();
      const results = await store.search(query, { type: 'code', subtype, limit });

      if (results.length === 0) {
        return {
          success: true,
          data: {
            message: `No code found for "${query}". Try indexing the codebase first with /api/ingest.`,
            results: [],
          },
        };
      }

      return {
        success: true,
        data: {
          query,
          count: results.length,
          results: results.map(r => ({
            name: r.entry.name,
            type: r.entry.subtype,
            score: Math.round(r.score * 100) / 100,
            filePath: r.entry.metadata.filePath,
            lines: `${r.entry.metadata.startLine}-${r.entry.metadata.endLine}`,
            summary: r.entry.summary?.slice(0, 200),
            content: r.entry.content.slice(0, 500) + (r.entry.content.length > 500 ? '...' : ''),
          })),
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Search failed' };
    }
  }
}

/** Search documentation */
export class SearchDocsTool implements Tool {
  name = 'search_docs';
  description = 'Search for documentation, markdown files, PDFs, or text documents in the knowledge base.';
  parameters: ToolParameter[] = [
    { name: 'query', type: 'string', description: 'Natural language query', required: true },
    { name: 'subtype', type: 'string', description: 'Document type filter (markdown, pdf, text)', required: false },
    { name: 'limit', type: 'number', description: 'Maximum results (default: 5)', required: false, default: 5 },
  ];

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args.query as string;
    const subtype = args.subtype as string | undefined;
    const limit = (args.limit as number) ?? 5;

    if (!query) {
      return { success: false, error: 'Query is required' };
    }

    try {
      const store = getKnowledgeStore();
      const results = await store.search(query, { type: 'document', subtype, limit });

      if (results.length === 0) {
        return {
          success: true,
          data: {
            message: `No documents found for "${query}". Index documents with /api/ingest.`,
            results: [],
          },
        };
      }

      return {
        success: true,
        data: {
          query,
          count: results.length,
          results: results.map(r => ({
            name: r.entry.name,
            type: r.entry.subtype,
            score: Math.round(r.score * 100) / 100,
            filePath: r.entry.metadata.filePath,
            summary: r.entry.summary,
            content: r.entry.content.slice(0, 500) + (r.entry.content.length > 500 ? '...' : ''),
          })),
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Search failed' };
    }
  }
}

/** Get summary of an entity (class, module, document) */
export class GetSummaryTool implements Tool {
  name = 'get_summary';
  description = 'Get details about a specific entity like a class, function, or document by name.';
  parameters: ToolParameter[] = [
    { name: 'name', type: 'string', description: 'Name of the entity (class name, function name, document title)', required: true },
    { name: 'type', type: 'string', description: 'Entity type: code or document', required: false },
  ];

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const name = args.name as string;
    const type = args.type as 'code' | 'document' | undefined;

    if (!name) {
      return { success: false, error: 'Name is required' };
    }

    try {
      const store = getKnowledgeStore();
      const entry = await store.getByName(name, type);

      if (!entry) {
        return {
          success: true,
          data: {
            message: `No entry found for "${name}". It may not be indexed yet.`,
            entry: null,
          },
        };
      }

      return {
        success: true,
        data: {
          name: entry.name,
          type: entry.type,
          subtype: entry.subtype,
          filePath: entry.metadata.filePath,
          lines: entry.metadata.startLine ? `${entry.metadata.startLine}-${entry.metadata.endLine}` : undefined,
          summary: entry.summary,
          content: entry.content,
          metadata: entry.metadata,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get summary' };
    }
  }
}

/** Get dependencies of a code entity */
export class GetDependenciesTool implements Tool {
  name = 'get_dependencies';
  description = 'Find what a class or function imports/depends on, or what depends on it.';
  parameters: ToolParameter[] = [
    { name: 'name', type: 'string', description: 'Name of the class or function', required: true },
  ];

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const name = args.name as string;

    if (!name) {
      return { success: false, error: 'Name is required' };
    }

    try {
      const store = getKnowledgeStore();
      const entry = await store.getByName(name, 'code');

      if (!entry) {
        return {
          success: true,
          data: {
            message: `No code entry found for "${name}".`,
            dependencies: [],
          },
        };
      }

      // Extract imports from the code content
      const importMatches = entry.content.matchAll(/import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g);
      const imports = Array.from(importMatches).map((m: RegExpMatchArray) => m[1]);

      // Find what references this entity
      const allEntries = await store.list({ type: 'code', limit: 1000 });
      const referencedBy = allEntries
        .filter((e) => e.name !== name && e.content.includes(name))
        .map((e) => e.name);

      return {
        success: true,
        data: {
          name,
          filePath: entry.metadata.filePath,
          imports,
          referencedBy: referencedBy.slice(0, 20),
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get dependencies' };
    }
  }
}


/** List entities in the knowledge base */
export class ListKnowledgeTool implements Tool {
  name = 'list_knowledge';
  description = 'List what is indexed in the knowledge base. Useful to see what code and documents are available.';
  parameters: ToolParameter[] = [
    { name: 'type', type: 'string', description: 'Filter by type: code or document', required: false },
    { name: 'limit', type: 'number', description: 'Maximum results (default: 20)', required: false, default: 20 },
  ];

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const type = args.type as 'code' | 'document' | undefined;
    const limit = (args.limit as number) ?? 20;

    try {
      const store = getKnowledgeStore();
      const stats = await store.getStats();
      const entries = await store.list({ type, limit });

      return {
        success: true,
        data: {
          stats,
          entries: entries.map((e) => ({
            name: e.name,
            type: e.type,
            subtype: e.subtype,
            filePath: e.metadata.filePath,
          })),
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to list knowledge' };
    }
  }
}
