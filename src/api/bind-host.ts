/**
 * Decides which network interface an HTTP API may bind to.
 *
 * Exposing an API beyond loopback without an API key would let anyone on the
 * network call it, so that combination falls back to 127.0.0.1.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function resolveBindHost(requestedHost: string, apiKey: string, label: string): string {
  const host = requestedHost.trim() || '127.0.0.1';
  if (LOOPBACK_HOSTS.has(host) || apiKey) {
    return host;
  }
  console.warn(
    `[${label}] API_HOST=${host} requires WEBHOOK_API_KEY; binding to 127.0.0.1 instead`
  );
  return '127.0.0.1';
}

/** True when a request body is declared as JSON (forces a CORS preflight in browsers). */
export function isJsonRequest(contentType: string | undefined): boolean {
  return (contentType ?? '').toLowerCase().split(';')[0].trim() === 'application/json';
}
