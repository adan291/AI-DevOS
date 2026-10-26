/**
 * REST API Server
 * 
 * Exposes HTTP endpoints for external integrations:
 * - n8n workflows
 * - CI/CD pipelines
 * - External tools
 * 
 * Endpoints:
 * - POST /api/ask → Send a question to the agents
 * - POST /api/review → Synchronous code review of files (JSON result)
 * - POST /api/ingest → Trigger knowledge ingestion
 * - POST /api/generate → Generate outputs (docs, summaries)
 * - GET /api/status → System status
 * - GET /api/agents → List available agents
 */

import http from 'node:http';
import { config } from '../config/index.js';
import type { Orchestrator } from '../types/orchestrator.js';
import type { NormalizedEvent } from '../types/events.js';
import { subAgentRegistry, getSubAgent } from '../agents/sub-agents/index.js';
import { getIngestionService, getKnowledgeStore } from '../ingestion/index.js';
import { resolveBindHost, isJsonRequest } from './bind-host.js';
import { HttpError, readJsonBody } from './http-body.js';
import type { KnowledgeType } from '../ingestion/knowledge-store.js';
import { ReviewService, ReviewLlmError } from '../review/review-service.js';
import { validateReviewRequest } from '../review/review-schema.js';

/** Paths with their own (larger) body limit */
const REVIEW_PATH = '/api/review';

export interface RestApiConfig {
  port: number;
  apiKey?: string;
  /** Interface to bind to (default: API_HOST env, then 127.0.0.1) */
  host?: string;
  orchestrator?: Orchestrator;
  /** Max body bytes for most endpoints (default: API_MAX_BODY_BYTES, 256 KB) */
  maxBodyBytes?: number;
  /** Max body bytes for POST /api/review (default: REVIEW_MAX_BODY_BYTES, 2 MB) */
  maxReviewBodyBytes?: number;
  /** Service behind POST /api/review (default: created on first use) */
  reviewService?: ReviewService;
  /**
   * 'api-only' exposes only /api/status, /api/agents, /api/review and
   * /api/ask for sub-agents (no orchestrator, Postgres or Redis behind it).
   */
  mode?: RestApiMode;
}

export type RestApiMode = 'full' | 'api-only';

/** Routes available without orchestrator or persistence */
const API_ONLY_PATHS = new Set(['/api/status', '/api/agents', '/api/ask', REVIEW_PATH]);

/** Body of POST /api/ask */
interface AskBody {
  question?: unknown;
  agent?: unknown;
  context?: { guildId?: string; channelId?: string; projectName?: string };
}

export class RestApi {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private apiKey: string;
  private orchestrator: Orchestrator | null;
  private maxBodyBytes: number;
  private maxReviewBodyBytes: number;
  private reviewService: ReviewService | null;
  private mode: RestApiMode;

  constructor(restConfig: RestApiConfig) {
    this.port = restConfig.port;
    this.apiKey = restConfig.apiKey ?? '';
    this.host = resolveBindHost(restConfig.host ?? config.API_HOST(), this.apiKey, 'REST API');
    this.orchestrator = restConfig.orchestrator ?? null;
    this.maxBodyBytes = restConfig.maxBodyBytes ?? config.API_MAX_BODY_BYTES();
    this.maxReviewBodyBytes = restConfig.maxReviewBodyBytes ?? config.REVIEW_MAX_BODY_BYTES();
    this.reviewService = restConfig.reviewService ?? null;
    this.mode = restConfig.mode ?? 'full';
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server?.off('error', reject);
        console.log(`[REST API] Listening on ${this.host}:${this.getPort()}`);
        resolve();
      });
    });
  }

  /** Port actually bound (useful when started with port 0). */
  getPort(): number {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : this.port;
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[REST API] Stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // No CORS headers: callers are servers (n8n, CI), not browsers. Requiring
    // JSON on POST also stops web pages from sending "simple" cross-site requests.
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && !isJsonRequest(req.headers['content-type'])) {
      this.sendJson(res, 415, { error: 'Content-Type must be application/json' });
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
    const path = url.pathname;

    // Auth check (skip for status)
    if (path !== '/api/status' && this.apiKey) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${this.apiKey}`) {
        this.sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
    }

    if (this.mode === 'api-only' && !API_ONLY_PATHS.has(path)) {
      this.sendJson(res, 404, { error: 'Not found' });
      return;
    }

    try {
      // Route requests
      if (path === '/api/status' && req.method === 'GET') {
        await this.handleStatus(res);
      } else if (path === '/api/agents' && req.method === 'GET') {
        await this.handleListAgents(res);
      } else if (path === '/api/ask' && req.method === 'POST') {
        await this.handleAsk(req, res);
      } else if (path === REVIEW_PATH && req.method === 'POST') {
        await this.handleReview(req, res);
      } else if (path === '/api/ingest' && req.method === 'POST') {
        await this.handleIngest(req, res);
      } else if (path === '/api/generate' && req.method === 'POST') {
        await this.handleGenerate(req, res);
      } else if (path === '/api/knowledge/search' && req.method === 'POST') {
        await this.handleKnowledgeSearch(req, res);
      } else if (path === '/api/knowledge/stats' && req.method === 'GET') {
        await this.handleKnowledgeStats(res);
      } else if (path.startsWith('/api/ingest/') && req.method === 'GET') {
        const jobId = path.split('/api/ingest/')[1];
        await this.handleIngestStatus(jobId, res);
      } else {
        this.sendJson(res, 404, { error: 'Not found' });
      }
    } catch (error) {
      if (error instanceof HttpError) {
        // After a 413 the rest of the body is not read: close the connection
        const headers = error.status === 413 ? { Connection: 'close' } : undefined;
        this.sendJson(res, error.status, { error: error.message }, headers);
        return;
      }
      console.error('[REST API] Error:', error);
      this.sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  /** GET /api/status */
  private async handleStatus(res: http.ServerResponse): Promise<void> {
    this.sendJson(res, 200, {
      status: 'ok',
      version: '1.0.0',
      mode: this.mode,
      uptime: process.uptime(),
      agents: subAgentRegistry.list(),
    });
  }

  /** GET /api/agents */
  private async handleListAgents(res: http.ServerResponse): Promise<void> {
    const mainAgents = ['coordinator', 'architect', 'planner', 'developer', 'reviewer', 'qa', 'devops', 'memory'];
    const subAgents = subAgentRegistry.list();

    this.sendJson(res, 200, {
      mainAgents,
      subAgents,
      total: mainAgents.length + subAgents.length,
    });
  }

  /** POST /api/ask */
  private async handleAsk(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const { question, agent, context } = (await this.readJson(req)) as AskBody;

    if (!question || typeof question !== 'string') {
      this.sendJson(res, 400, { error: 'question is required' });
      return;
    }
    if (agent !== undefined && typeof agent !== 'string') {
      this.sendJson(res, 400, { error: 'agent must be a string' });
      return;
    }

    // If a specific sub-agent is requested
    if (agent && agent.includes('.')) {
      const subAgent = getSubAgent(agent);
      if (!subAgent) {
        this.sendJson(res, 400, { error: `Sub-agent "${agent}" not found` });
        return;
      }

      const result = await subAgent.execute(
        {
          org: { guildId: context?.guildId ?? 'api', standards: [], architecture: [] },
          project: { channelId: context?.channelId ?? 'api', guildId: context?.guildId ?? 'api', name: context?.projectName ?? 'API Request', stack: [], rules: [] },
        },
        question
      );

      this.sendJson(res, 200, {
        agent,
        question,
        answer: result.output,
        success: result.success,
        error: result.error,
      });
      return;
    }

    if (this.mode === 'api-only') {
      this.sendJson(res, 400, {
        error: 'In API-only mode /api/ask only accepts sub-agents (e.g. "architect.api"); use /api/review for reviews',
      });
      return;
    }

    // Use orchestrator for general questions
    if (!this.orchestrator) {
      this.sendJson(res, 503, { error: 'Orchestrator not available' });
      return;
    }

    // Create a normalized event and process it
    const eventId = `api_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const event: NormalizedEvent = {
      id: eventId,
      type: 'message',
      guildId: context?.guildId ?? 'api',
      channelId: context?.channelId ?? 'api',
      userId: 'api-user',
      timestamp: Date.now(),
      payload: { content: question, authorIsBot: false },
    };

    // Process asynchronously and return immediately
    this.orchestrator.handleEvent(event).catch(err => {
      console.error('[REST API] Event processing error:', err);
    });

    this.sendJson(res, 202, {
      eventId,
      status: 'processing',
      message: 'Question submitted for processing',
    });
  }

  /** POST /api/review (synchronous, contract 3.3 of FABRICA.md) */
  private async handleReview(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsed = validateReviewRequest(await this.readJson(req));
    if (!parsed.ok) {
      this.sendJson(res, 400, { error: parsed.error });
      return;
    }

    this.reviewService ??= new ReviewService();
    try {
      const result = await this.reviewService.review(parsed.value);
      this.sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof ReviewLlmError) {
        // Provider details stay in the server log
        const cause = error.cause instanceof Error ? error.cause.message : error.cause;
        console.error(`[REST API] Review failed: ${error.message}`, cause ?? '');
        this.sendJson(res, 502, { error: 'LLM review failed' });
        return;
      }
      throw error;
    }
  }

  /** POST /api/ingest */
  private async handleIngest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const { type, path: sourcePath } = (await this.readJson(req)) as { type?: string; path?: string };

    if (!type || !sourcePath) {
      this.sendJson(res, 400, { error: 'type and path are required' });
      return;
    }

    const ingestionService = getIngestionService();

    try {
      let job;
      if (type === 'code') {
        job = await ingestionService.ingestCode(sourcePath);
      } else if (type === 'document') {
        job = await ingestionService.ingestDocument(sourcePath);
      } else {
        this.sendJson(res, 400, { error: `Unknown type: ${type}. Use 'code' or 'document'` });
        return;
      }

      this.sendJson(res, 202, {
        jobId: job.id,
        status: job.status,
        message: 'Ingestion started',
      });
    } catch (error) {
      this.sendJson(res, 500, { 
        error: error instanceof Error ? error.message : 'Ingestion failed' 
      });
    }
  }

  /** POST /api/generate */
  private async handleGenerate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const { type, entity, format } = (await this.readJson(req)) as { type?: string; entity?: string; format?: string };

    if (!type) {
      this.sendJson(res, 400, { error: 'type is required (summary, documentation, presentation)' });
      return;
    }

    // TODO: Implement actual generation
    this.sendJson(res, 202, {
      status: 'queued',
      type,
      entity,
      format: format ?? 'markdown',
      message: 'Generation queued. This feature is coming soon.',
    });
  }

  /** POST /api/knowledge/search */
  private async handleKnowledgeSearch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const { query, type, limit } = (await this.readJson(req)) as {
      query?: string;
      type?: KnowledgeType;
      limit?: number;
    };

    if (!query) {
      this.sendJson(res, 400, { error: 'query is required' });
      return;
    }

    const knowledgeStore = getKnowledgeStore();
    const results = await knowledgeStore.search(query, { type, limit: limit ?? 5 });

    this.sendJson(res, 200, {
      query,
      results: results.map(r => ({
        name: r.entry.name,
        type: r.entry.type,
        subtype: r.entry.subtype,
        score: r.score,
        summary: r.entry.summary,
        filePath: r.entry.metadata.filePath,
      })),
    });
  }

  /** GET /api/knowledge/stats */
  private async handleKnowledgeStats(res: http.ServerResponse): Promise<void> {
    const knowledgeStore = getKnowledgeStore();
    const stats = await knowledgeStore.getStats();
    const ingestionService = getIngestionService();
    const jobs = ingestionService.listJobs();

    this.sendJson(res, 200, {
      knowledge: stats,
      usingPostgres: knowledgeStore.isUsingPostgres(),
      recentJobs: jobs.slice(-10).map(j => ({
        id: j.id,
        type: j.type,
        status: j.status,
        entriesCreated: j.entriesCreated,
      })),
    });
  }

  /** GET /api/ingest/:jobId */
  private async handleIngestStatus(jobId: string, res: http.ServerResponse): Promise<void> {
    const ingestionService = getIngestionService();
    const job = ingestionService.getJob(jobId);

    if (!job) {
      this.sendJson(res, 404, { error: 'Job not found' });
      return;
    }

    this.sendJson(res, 200, job);
  }

  // Helpers

  private sendJson(
    res: http.ServerResponse,
    status: number,
    data: unknown,
    headers?: Record<string, string>
  ): void {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(data));
  }

  /** Parse the JSON body with the limit that applies to this path. */
  private readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const limit = path === REVIEW_PATH ? this.maxReviewBodyBytes : this.maxBodyBytes;
    return readJsonBody(req, limit);
  }
}

export function createRestApi(config: RestApiConfig): RestApi {
  return new RestApi(config);
}
