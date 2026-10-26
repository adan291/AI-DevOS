/**
 * POST /api/review over HTTP with a mocked LLM.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { RestApi } from './rest-api.js';
import { ReviewService, type ReviewLlm } from '../review/review-service.js';
import { request } from './test-http.js';

const API_KEY = 'test-key';
const HEADERS = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

const llm: ReviewLlm & { complete: ReturnType<typeof vi.fn> } = {
  model: 'mock/model',
  complete: vi.fn(),
};

describe('POST /api/review', () => {
  let api: RestApi;
  let port: number;

  beforeAll(async () => {
    api = new RestApi({
      port: 0,
      host: '127.0.0.1',
      apiKey: API_KEY,
      maxBodyBytes: 1024, // smaller than the review limit on purpose
      reviewService: new ReviewService({ llm }),
    });
    await api.start();
    port = api.getPort();
  });

  afterAll(async () => {
    await api.stop();
  });

  const post = (body: string, headers: Record<string, string> = HEADERS) =>
    request(port, { method: 'POST', path: '/api/review', headers, body });

  it('returns the contract response', async () => {
    llm.complete.mockResolvedValueOnce(JSON.stringify({
      verdict: 'APPROVE',
      summary: 'Hay un NPE posible',
      issues: [{ severity: 'high', category: 'bug', file: 'src/UserService.java', line: 3, description: 'user puede ser null', suggestion: 'comprobar null' }],
    }));
    const res = await post(JSON.stringify({
      files: [{ path: 'src/UserService.java', content: 'class UserService {\n  String name(User u) {\n    return u.getName();\n  }\n}' }],
      context: { projectName: 'demo', stack: ['Java 25'] },
    }));
    expect(res.status).toBe(200);
    expect(res.json()).toEqual({
      verdict: 'REJECT',
      summary: 'Hay un NPE posible',
      issues: [{ severity: 'high', category: 'bug', file: 'src/UserService.java', line: 3, description: 'user puede ser null', suggestion: 'comprobar null' }],
      reviewedFiles: 1,
      skippedFiles: 0,
      model: 'mock/model',
    });
  });

  it('requires the Bearer token', async () => {
    const res = await post('{}', { 'Content-Type': 'application/json' });
    expect(res.status).toBe(401);
  });

  it('accepts bodies over the general limit but under 2 MB', async () => {
    llm.complete.mockResolvedValueOnce(JSON.stringify({ verdict: 'APPROVE', summary: 'ok', issues: [] }));
    const res = await post(JSON.stringify({ files: [{ path: 'a.txt', content: 'a'.repeat(4000) }] }));
    expect(res.status).toBe(200);
  });

  it('returns 413 for bodies over 2 MB', async () => {
    const body = JSON.stringify({ files: [{ path: 'a.txt', content: 'a'.repeat(3 * 1024 * 1024) }] });
    const res = await post(body);
    expect(res.status).toBe(413);
  });

  it('returns 400 for an invalid request', async () => {
    const res = await post(JSON.stringify({ files: [] }));
    expect(res.status).toBe(400);
    expect(res.json()).toEqual({ error: 'files must be a non-empty array' });
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await post('{"files": [');
    expect(res.status).toBe(400);
  });

  it('returns 502 without internal details when the LLM fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    llm.complete.mockRejectedValueOnce(new Error('401 Invalid API key gsk_secret'));
    const res = await post(JSON.stringify({ files: [{ path: 'a.java', content: 'x' }] }));
    spy.mockRestore();
    expect(res.status).toBe(502);
    expect(res.json()).toEqual({ error: 'LLM review failed' });
    expect(res.body).not.toContain('gsk_secret');
  });
});
