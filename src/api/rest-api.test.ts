/**
 * REST API robustness: auth, content type, body limits and JSON errors.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { RestApi } from './rest-api.js';
import { request } from './test-http.js';
import { config } from '../config/index.js';

const API_KEY = 'test-key';
const AUTH = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

describe('RestApi body handling', () => {
  let api: RestApi;
  let port: number;

  beforeAll(async () => {
    api = new RestApi({ port: 0, host: '127.0.0.1', apiKey: API_KEY, maxBodyBytes: 1024 });
    await api.start();
    port = api.getPort();
  });

  afterAll(async () => {
    await api.stop();
  });

  it('GET /api/status works without auth', async () => {
    const res = await request(port, { path: '/api/status' });
    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('rejects requests without Bearer token with 401', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/api/ask',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST without JSON content type with 415', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/api/ask',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect(res.status).toBe(415);
  });

  it('returns 400 for malformed JSON instead of 500', async () => {
    const res = await request(port, { method: 'POST', path: '/api/ask', headers: AUTH, body: '{"question":' });
    expect(res.status).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for an empty body', async () => {
    const res = await request(port, { method: 'POST', path: '/api/ask', headers: AUTH, body: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when the JSON is not an object', async () => {
    for (const body of ['null', '[1,2]', '"text"']) {
      const res = await request(port, { method: 'POST', path: '/api/ask', headers: AUTH, body });
      expect(res.status).toBe(400);
      expect(res.json()).toEqual({ error: 'JSON body must be an object' });
    }
  });

  it('returns 400 when question has the wrong type', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/api/ask',
      headers: AUTH,
      body: JSON.stringify({ question: 'x', agent: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts a body under the limit', async () => {
    const res = await request(port, { method: 'POST', path: '/api/ask', headers: AUTH, body: '{}' });
    expect(res.status).toBe(400);
    expect(res.json()).toEqual({ error: 'question is required' });
  });

  it('returns 413 when Content-Length exceeds the limit', async () => {
    const body = JSON.stringify({ question: 'x'.repeat(2048) });
    const res = await request(port, { method: 'POST', path: '/api/ask', headers: AUTH, body });
    expect(res.status).toBe(413);
    expect(res.headers.connection).toBe('close');
  });

  it('returns 413 for an oversized chunked body', async () => {
    const body = JSON.stringify({ question: 'x'.repeat(4096) });
    const res = await request(port, { method: 'POST', path: '/api/ask', headers: AUTH, body, chunked: true });
    expect(res.status).toBe(413);
  });

  it('keeps answering after a 413', async () => {
    await request(port, { method: 'POST', path: '/api/ask', headers: AUTH, body: 'x'.repeat(5000) });
    const res = await request(port, { path: '/api/status' });
    expect(res.status).toBe(200);
  });
});

describe('body limit configuration', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('defaults to 256 KB and 2 MB', () => {
    delete process.env['API_MAX_BODY_BYTES'];
    delete process.env['REVIEW_MAX_BODY_BYTES'];
    expect(config.API_MAX_BODY_BYTES()).toBe(256 * 1024);
    expect(config.REVIEW_MAX_BODY_BYTES()).toBe(2 * 1024 * 1024);
  });

  it('reads overrides and ignores invalid values', () => {
    process.env['API_MAX_BODY_BYTES'] = '1000';
    process.env['REVIEW_MAX_BODY_BYTES'] = 'abc';
    expect(config.API_MAX_BODY_BYTES()).toBe(1000);
    expect(config.REVIEW_MAX_BODY_BYTES()).toBe(2 * 1024 * 1024);
  });
});

describe('RestApi api-only mode', () => {
  let api: RestApi;
  let port: number;

  beforeAll(async () => {
    api = new RestApi({ port: 0, host: '127.0.0.1', apiKey: API_KEY, mode: 'api-only' });
    await api.start();
    port = api.getPort();
  });

  afterAll(async () => {
    await api.stop();
  });

  it('reports the mode in /api/status', async () => {
    const res = await request(port, { path: '/api/status' });
    expect(res.json()).toMatchObject({ status: 'ok', mode: 'api-only' });
  });

  it('serves /api/agents', async () => {
    const res = await request(port, { path: '/api/agents', headers: AUTH });
    expect(res.status).toBe(200);
  });

  it('hides endpoints that need the orchestrator or persistence', async () => {
    for (const path of ['/api/knowledge/stats', '/api/ingest/abc']) {
      const res = await request(port, { path, headers: AUTH });
      expect(res.status).toBe(404);
    }
    const res = await request(port, { method: 'POST', path: '/api/ingest', headers: AUTH, body: '{}' });
    expect(res.status).toBe(404);
  });

  it('only accepts sub-agents in /api/ask', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/api/ask',
      headers: AUTH,
      body: JSON.stringify({ question: 'hola', agent: 'reviewer' }),
    });
    expect(res.status).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/sub-agents/);
  });

  it('still validates unknown sub-agents', async () => {
    const res = await request(port, {
      method: 'POST',
      path: '/api/ask',
      headers: AUTH,
      body: JSON.stringify({ question: 'hola', agent: 'nope.nope' }),
    });
    expect(res.status).toBe(400);
    expect(res.json()).toEqual({ error: 'Sub-agent "nope.nope" not found' });
  });
});
