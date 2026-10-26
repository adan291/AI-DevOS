/**
 * Ports of the HTTP servers and the startup check that they do not collide.
 */

import { config } from '../config/index.js';

function parsePort(value: string, name: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${name} must be a port number (0-65535), got "${value}"`);
  }
  return port;
}

/** Port of the REST API (WEBHOOK_PORT, default 3001). */
export function getRestApiPort(): number {
  return parsePort(config.WEBHOOK_PORT(), 'WEBHOOK_PORT');
}

/** Port of the WebhookAdapter: WEBHOOK_ADAPTER_PORT, or WEBHOOK_PORT when unset. */
export function getWebhookAdapterPort(): number {
  const own = config.WEBHOOK_ADAPTER_PORT().trim();
  return own ? parsePort(own, 'WEBHOOK_ADAPTER_PORT') : getRestApiPort();
}

/**
 * Throw a clear error when the WebhookAdapter is enabled and would listen on
 * the REST API port (otherwise the second server fails with EADDRINUSE).
 */
export function assertNoPortConflict(
  chatAdapters: string[],
  restApiPort: number,
  webhookAdapterPort: number
): void {
  if (!chatAdapters.includes('webhook')) return;
  if (restApiPort !== 0 && restApiPort === webhookAdapterPort) {
    throw new Error(
      `The REST API and the webhook chat adapter would both listen on port ${restApiPort}. ` +
        'Set WEBHOOK_ADAPTER_PORT to a different port (WEBHOOK_PORT stays for the REST API).'
    );
  }
}
