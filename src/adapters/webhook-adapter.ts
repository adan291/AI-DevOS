/**
 * Webhook/CLI Chat Adapter
 * 
 * Generic adapter for any tool that communicates via HTTP webhooks.
 * This is the integration point for:
 * - Kiro IDE
 * - JetBrains AI Assistant
 * - Claude Code CLI
 * - VS Code extensions
 * - Any HTTP client
 * 
 * Exposes an HTTP API that accepts messages and returns responses.
 * Supports Server-Sent Events (SSE) for streaming responses.
 */

import http from 'node:http';
import type {
  ChatAdapter,
  ChatPlatform,
  AdapterCapabilities,
  AdapterEmbed,
  AdapterEventHandler,
  AdapterProjectStructure,
  AdapterProjectResult,
  AdapterTaskThreadResult,
} from './chat-adapter.js';
import type { NormalizedEvent } from '../types/events.js';
import { config } from '../config/index.js';
import { resolveBindHost } from '../api/bind-host.js';

/** In-memory message store for the webhook adapter */
interface StoredMessage {
  id: string;
  channelId: string;
  content: string;
  embed?: AdapterEmbed;
  timestamp: number;
}

/** Pending response for SSE streaming */
interface PendingResponse {
  res: http.ServerResponse;
  channelId: string;
  resolve: (value: string) => void;
}

/**
 * Webhook Chat Adapter
 * 
 * HTTP API endpoints:
 *   POST /message          - Send a message to the bot
 *   GET  /messages/:channel - Get messages for a channel
 *   GET  /stream/:channel   - SSE stream for real-time updates
 *   POST /webhook           - Generic webhook endpoint
 *   GET  /health            - Health check
 */
export class WebhookAdapter implements ChatAdapter {
  readonly platform: ChatPlatform = 'webhook';
  readonly capabilities: AdapterCapabilities = {
    richEmbeds: true,
    threads: false,
    createChannels: false,
    reactions: false,
    editMessages: true,
    deleteMessages: true,
    projectStructures: false,
    typingIndicator: true,
  };

  private server: http.Server | null = null;
  private port: number;
  private eventHandler: AdapterEventHandler | null = null;
  private messages: Map<string, StoredMessage[]> = new Map();
  private sseClients: Map<string, http.ServerResponse[]> = new Map();
  private messageCounter = 0;
  private apiKey: string;

  constructor(port?: number, apiKey?: string) {
    this.port = port ?? parseInt(config.WEBHOOK_PORT?.() ?? '3001', 10);
    this.apiKey = apiKey ?? config.WEBHOOK_API_KEY?.() ?? '';
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      const host = resolveBindHost(config.API_HOST(), this.apiKey, 'Webhook');
      this.server.listen(this.port, host, () => {
        console.log(`[Webhook] HTTP API listening on ${host}:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Close all SSE connections
    for (const clients of this.sseClients.values()) {
      for (const client of clients) {
        client.end();
      }
    }
    this.sseClients.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[Webhook] HTTP API stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  onEvent(handler: AdapterEventHandler): void {
    this.eventHandler = handler;
  }

  async sendMessage(channelId: string, content: string): Promise<void> {
    const msg = this.storeMessage(channelId, content);
    this.broadcastSSE(channelId, { type: 'message', data: msg });
  }

  async sendMessageWithId(channelId: string, content: string): Promise<string> {
    const msg = this.storeMessage(channelId, content);
    this.broadcastSSE(channelId, { type: 'message', data: msg });
    return msg.id;
  }

  async editMessage(channelId: string, messageId: string, content: string): Promise<void> {
    const messages = this.messages.get(channelId) ?? [];
    const msg = messages.find(m => m.id === messageId);
    if (msg) {
      msg.content = content;
      this.broadcastSSE(channelId, { type: 'edit', data: { id: messageId, content } });
    }
  }

  async sendEmbed(channelId: string, embed: AdapterEmbed): Promise<string> {
    const msg = this.storeMessage(channelId, this.embedToText(embed), embed);
    this.broadcastSSE(channelId, { type: 'embed', data: { ...msg, embed } });
    return msg.id;
  }

  async createThread(channelId: string, name: string): Promise<string> {
    // Webhook adapter doesn't support real threads, simulate with a sub-channel
    const threadId = `thread_${Date.now()}`;
    this.broadcastSSE(channelId, { type: 'thread_created', data: { threadId, name } });
    return threadId;
  }

  async createTaskThread(
    channelId: string,
    taskNumber: number,
    taskName: string,
    taskDescription: string,
    complexity: string
  ): Promise<AdapterTaskThreadResult> {
    const threadId = `task_${taskNumber}_${Date.now()}`;
    const msg = this.storeMessage(channelId, `📌 Tarea #${taskNumber}: ${taskName}\n${taskDescription}\nComplejidad: ${complexity}`);
    this.broadcastSSE(channelId, {
      type: 'task_thread',
      data: { threadId, messageId: msg.id, taskNumber, taskName, taskDescription, complexity },
    });
    return { threadId, messageId: msg.id };
  }

  async createProjectStructure(
    _workspaceId: string,
    project: AdapterProjectStructure
  ): Promise<AdapterProjectResult> {
    // Simulate project structure with virtual channels
    const channels: Record<string, string> = {};
    for (const ch of project.channels) {
      channels[ch.name] = `virtual_${ch.name.replace(/\s+/g, '_')}_${Date.now()}`;
    }
    return { categoryId: `project_${project.name}`, channels };
  }

  async showTyping(channelId: string): Promise<void> {
    this.broadcastSSE(channelId, { type: 'typing', data: { active: true } });
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    const messages = this.messages.get(channelId) ?? [];
    const idx = messages.findIndex(m => m.id === messageId);
    if (idx >= 0) {
      messages.splice(idx, 1);
      this.broadcastSSE(channelId, { type: 'delete', data: { id: messageId } });
    }
  }

  // --- HTTP Request Handler ---

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
    const path = url.pathname;

    try {
      // Auth check (skip for health)
      if (path !== '/health' && this.apiKey) {
        const auth = req.headers.authorization;
        if (auth !== `Bearer ${this.apiKey}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
      }

      if (path === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', platform: 'webhook', uptime: process.uptime() }));
        return;
      }

      if (path === '/message' && req.method === 'POST') {
        await this.handleIncomingMessage(req, res);
        return;
      }

      if (path.startsWith('/messages/') && req.method === 'GET') {
        const channelId = path.split('/messages/')[1];
        const messages = this.messages.get(channelId ?? '') ?? [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages }));
        return;
      }

      if (path.startsWith('/stream/') && req.method === 'GET') {
        const channelId = path.split('/stream/')[1] ?? 'default';
        this.handleSSE(channelId, res);
        return;
      }

      if (path === '/webhook' && req.method === 'POST') {
        await this.handleIncomingMessage(req, res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (error) {
      console.error('[Webhook] Request error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private async handleIncomingMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const { content, channelId, userId, guildId } = JSON.parse(body);

    if (!content) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'content is required' }));
      return;
    }

    const event: NormalizedEvent = {
      id: `webhook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'message',
      guildId: guildId ?? 'webhook',
      channelId: channelId ?? 'default',
      userId: userId ?? 'webhook-user',
      timestamp: Date.now(),
      payload: {
        content,
        authorIsBot: false,
      },
    };

    // Acknowledge immediately
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ eventId: event.id, status: 'accepted' }));

    // Process asynchronously
    if (this.eventHandler) {
      this.eventHandler(event).catch(err => {
        console.error('[Webhook] Event processing error:', err);
      });
    }
  }

  private handleSSE(channelId: string, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    res.write('data: {"type":"connected"}\n\n');

    const clients = this.sseClients.get(channelId) ?? [];
    clients.push(res);
    this.sseClients.set(channelId, clients);

    res.on('close', () => {
      const remaining = (this.sseClients.get(channelId) ?? []).filter(c => c !== res);
      this.sseClients.set(channelId, remaining);
    });
  }

  private broadcastSSE(channelId: string, data: Record<string, any>): void {
    const clients = this.sseClients.get(channelId) ?? [];
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      try {
        client.write(payload);
      } catch {
        // Client disconnected
      }
    }
  }

  private storeMessage(channelId: string, content: string, embed?: AdapterEmbed): StoredMessage {
    const msg: StoredMessage = {
      id: `msg_${++this.messageCounter}_${Date.now()}`,
      channelId,
      content,
      embed,
      timestamp: Date.now(),
    };

    const messages = this.messages.get(channelId) ?? [];
    messages.push(msg);
    // Keep last 100 messages per channel
    if (messages.length > 100) messages.shift();
    this.messages.set(channelId, messages);

    return msg;
  }

  private embedToText(embed: AdapterEmbed): string {
    const lines: string[] = [`**${embed.title}**`];
    if (embed.description) lines.push(embed.description);
    if (embed.fields) {
      for (const f of embed.fields) {
        lines.push(`• ${f.name}: ${f.value}`);
      }
    }
    if (embed.footer) lines.push(`_${embed.footer}_`);
    return lines.join('\n');
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
