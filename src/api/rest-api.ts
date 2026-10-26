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

export interface RestApiConfig {
  port: number;
  apiKey?: string;
  /** Interface to bind to (default: API_HOST env, then 127.0.0.1) */
  host?: string;
  orchestrator?: Orchestrator;
}

export class RestApi {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private apiKey: string;
  private orchestrator: Orchestrator | null;
  private pendingResponses: Map<string, { resolve: (value: string) => void; timeout: NodeJS.Timeout }> = new Map();

  constructor(restConfig: RestApiConfig) {
    this.port = restConfig.port;
    this.apiKey = restConfig.apiKey ?? '';
    this.host = resolveBindHost(restConfig.host ?? config.API_HOST(), this.apiKey, 'REST API');
    this.orchestrator = restConfig.orchestrator ?? null;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.port, this.host, () => {
        console.log(`[REST API] Listening on ${this.host}:${this.port}`);
        resolve();
      });
    });
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

    try {
      // Route requests
      if (path === '/api/status' && req.method === 'GET') {
        await this.handleStatus(res);
      } else if (path === '/api/agents' && req.method === 'GET') {
        await this.handleListAgents(res);
      } else if (path === '/api/ask' && req.method === 'POST') {
        await this.handleAsk(req, res);
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
      console.error('[REST API] Error:', error);
      this.sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  /** GET /api/status */
  private async handleStatus(res: http.ServerResponse): Promise<void> {
    this.sendJson(res, 200, {
      status: 'ok',
      version: '1.0.0',
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
    const body = await this.readBody(req);
    const { question, agent, context } = JSON.parse(body);

    if (!question) {
      this.sendJson(res, 400, { error: 'question is required' });
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

  /** POST /api/ingest */
  private async handleIngest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const { type, path: sourcePath } = JSON.parse(body);

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
    const body = await this.readBody(req);
    const { type, entity, format } = JSON.parse(body);

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
    const body = await this.readBody(req);
    const { query, type, limit } = JSON.parse(body);

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

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }
}

export function createRestApi(config: RestApiConfig): RestApi {
  return new RestApi(config);
}
