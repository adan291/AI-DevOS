import { describe, it, expect, afterEach } from 'vitest';
import { assertNoPortConflict, getRestApiPort, getWebhookAdapterPort } from './ports.js';

describe('ports', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('uses WEBHOOK_PORT for both servers by default', () => {
    process.env['WEBHOOK_PORT'] = '4000';
    delete process.env['WEBHOOK_ADAPTER_PORT'];
    expect(getRestApiPort()).toBe(4000);
    expect(getWebhookAdapterPort()).toBe(4000);
  });

  it('lets the webhook adapter use its own port', () => {
    process.env['WEBHOOK_PORT'] = '3001';
    process.env['WEBHOOK_ADAPTER_PORT'] = '3002';
    expect(getWebhookAdapterPort()).toBe(3002);
  });

  it('rejects invalid ports', () => {
    process.env['WEBHOOK_PORT'] = 'abc';
    expect(() => getRestApiPort()).toThrow(/WEBHOOK_PORT/);
  });

  it('fails clearly when the webhook adapter shares the REST API port', () => {
    expect(() => assertNoPortConflict(['discord', 'webhook'], 3001, 3001)).toThrow(/WEBHOOK_ADAPTER_PORT/);
  });

  it('allows the same port when the webhook adapter is disabled', () => {
    expect(() => assertNoPortConflict(['discord'], 3001, 3001)).not.toThrow();
  });

  it('allows different ports', () => {
    expect(() => assertNoPortConflict(['webhook'], 3001, 3002)).not.toThrow();
  });
});
