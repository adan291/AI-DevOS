/**
 * Ingestion Service
 * 
 * Orchestrates the ingestion of different content types:
 * - Code repositories
 * - Documents (markdown, PDF, text)
 * - Videos (future)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CodeParser, createCodeParser, type ParseResult } from './code-parser.js';
import { KnowledgeStore, getKnowledgeStore, type KnowledgeEntry } from './knowledge-store.js';

/** Ingestion job status */
export type IngestionStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Ingestion job */
export interface IngestionJob {
  id: string;
  type: 'code' | 'document' | 'video';
  source: string;
  status: IngestionStatus;
  progress: number;
  entriesCreated: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Ingestion Service
 */
export class IngestionService {
  private codeParser: CodeParser;
  private knowledgeStore: KnowledgeStore;
  private jobs: Map<string, IngestionJob> = new Map();

  constructor(knowledgeStore?: KnowledgeStore) {
    this.codeParser = createCodeParser();
    this.knowledgeStore = knowledgeStore ?? getKnowledgeStore();
  }

  /**
   * Ingest a code repository
   */
  async ingestCode(sourcePath: string): Promise<IngestionJob> {
    const jobId = `code_${Date.now()}`;
    const job: IngestionJob = {
      id: jobId,
      type: 'code',
      source: sourcePath,
      status: 'pending',
      progress: 0,
      entriesCreated: 0,
    };
    this.jobs.set(jobId, job);

    // Process asynchronously
    this.processCodeIngestion(job).catch(err => {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : 'Unknown error';
    });

    return job;
  }

  /**
   * Ingest a document
   */
  async ingestDocument(filePath: string): Promise<IngestionJob> {
    const jobId = `doc_${Date.now()}`;
    const job: IngestionJob = {
      id: jobId,
      type: 'document',
      source: filePath,
      status: 'pending',
      progress: 0,
      entriesCreated: 0,
    };
    this.jobs.set(jobId, job);

    // Process asynchronously
    this.processDocumentIngestion(job).catch(err => {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : 'Unknown error';
    });

    return job;
  }

  /**
   * Get job status
   */
  getJob(jobId: string): IngestionJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * List all jobs
   */
  listJobs(): IngestionJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Process code ingestion
   */
  private async processCodeIngestion(job: IngestionJob): Promise<void> {
    job.status = 'processing';
    job.startedAt = new Date();

    console.log(`[Ingestion] Starting code ingestion: ${job.source}`);

    // Check if path exists
    if (!fs.existsSync(job.source)) {
      throw new Error(`Path not found: ${job.source}`);
    }

    const stats = fs.statSync(job.source);
    let parseResults: ParseResult[];

    if (stats.isDirectory()) {
      parseResults = this.codeParser.parseDirectory(job.source);
    } else {
      const result = this.codeParser.parseFile(job.source);
      parseResults = result ? [result] : [];
    }

    console.log(`[Ingestion] Parsed ${parseResults.length} files`);

    // Add to knowledge store
    let totalEntities = 0;
    for (const result of parseResults) {
      totalEntities += result.entities.length;
    }

    let processed = 0;
    for (const result of parseResults) {
      const entries = await this.knowledgeStore.addFromParseResult(result);
      job.entriesCreated += entries.length;
      processed += result.entities.length;
      job.progress = Math.round((processed / totalEntities) * 100);
    }

    job.status = 'completed';
    job.completedAt = new Date();
    job.progress = 100;

    console.log(`[Ingestion] Completed: ${job.entriesCreated} entries created`);
  }

  /**
   * Process document ingestion
   */
  private async processDocumentIngestion(job: IngestionJob): Promise<void> {
    job.status = 'processing';
    job.startedAt = new Date();

    console.log(`[Ingestion] Starting document ingestion: ${job.source}`);

    if (!fs.existsSync(job.source)) {
      throw new Error(`File not found: ${job.source}`);
    }

    const content = fs.readFileSync(job.source, 'utf-8');
    const ext = path.extname(job.source).toLowerCase();
    const name = path.basename(job.source, ext);

    // Determine document type
    let subtype = 'text';
    if (ext === '.md' || ext === '.markdown') subtype = 'markdown';
    else if (ext === '.pdf') subtype = 'pdf';
    else if (ext === '.json') subtype = 'json';

    // For markdown, split into sections
    if (subtype === 'markdown') {
      const sections = this.splitMarkdownSections(content);
      
      for (const section of sections) {
        await this.knowledgeStore.add({
          type: 'document',
          subtype: 'markdown',
          name: section.title || name,
          content: section.content,
          summary: section.title,
          metadata: {
            filePath: job.source,
            section: section.title,
            level: section.level,
          },
        });
        job.entriesCreated++;
      }
    } else {
      // Single entry for other document types
      await this.knowledgeStore.add({
        type: 'document',
        subtype,
        name,
        content,
        metadata: {
          filePath: job.source,
        },
      });
      job.entriesCreated = 1;
    }

    job.status = 'completed';
    job.completedAt = new Date();
    job.progress = 100;

    console.log(`[Ingestion] Completed: ${job.entriesCreated} entries created`);
  }

  /**
   * Split markdown into sections by headers
   */
  private splitMarkdownSections(content: string): Array<{ title: string; content: string; level: number }> {
    const sections: Array<{ title: string; content: string; level: number }> = [];
    const lines = content.split('\n');
    
    let currentSection: { title: string; content: string[]; level: number } | null = null;

    for (const line of lines) {
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      
      if (headerMatch) {
        // Save previous section
        if (currentSection) {
          sections.push({
            title: currentSection.title,
            content: currentSection.content.join('\n').trim(),
            level: currentSection.level,
          });
        }
        
        // Start new section
        currentSection = {
          title: headerMatch[2],
          content: [],
          level: headerMatch[1].length,
        };
      } else if (currentSection) {
        currentSection.content.push(line);
      } else {
        // Content before first header
        if (!currentSection) {
          currentSection = { title: '', content: [line], level: 0 };
        }
      }
    }

    // Save last section
    if (currentSection && currentSection.content.length > 0) {
      sections.push({
        title: currentSection.title,
        content: currentSection.content.join('\n').trim(),
        level: currentSection.level,
      });
    }

    return sections.filter(s => s.content.length > 0);
  }
}

/** Global ingestion service */
let globalIngestionService: IngestionService | null = null;

export function getIngestionService(): IngestionService {
  if (!globalIngestionService) {
    globalIngestionService = new IngestionService();
  }
  return globalIngestionService;
}

export function createIngestionService(knowledgeStore?: KnowledgeStore): IngestionService {
  return new IngestionService(knowledgeStore);
}
