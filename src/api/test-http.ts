/**
 * Minimal HTTP client for API tests (node:http, so oversized bodies and
 * early responses behave like they do for real clients).
 */

import http from 'node:http';

export interface TestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: () => unknown;
}

export interface TestRequest {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  /** Sent with Content-Length unless chunked is true */
  body?: string | Buffer;
  chunked?: boolean;
}

export function request(port: number, opts: TestRequest): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...opts.headers };
    const body = opts.body === undefined ? undefined : Buffer.from(opts.body);
    if (body && !opts.chunked) {
      headers['Content-Length'] = String(body.length);
    }

    let settled = false;
    const req = http.request(
      { host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          settled = true;
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text, json: () => JSON.parse(text) });
        });
      }
    );
    // The server may close the socket after answering 413 while we still upload
    req.on('error', (err) => {
      if (!settled) reject(err);
    });

    if (body && opts.chunked) {
      const size = 64 * 1024;
      for (let i = 0; i < body.length; i += size) {
        req.write(body.subarray(i, i + size));
      }
      req.end();
    } else {
      req.end(body);
    }
  });
}
