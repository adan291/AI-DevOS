/**
 * Request body helpers for the REST API: size limit (413) and JSON parsing (400).
 */

import type http from 'node:http';

/** Error that maps directly to an HTTP status and a public message. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Bytes discarded after the limit is hit before the socket is destroyed.
 * Draining a little lets normal clients finish the upload and read the 413;
 * a client that keeps sending gets disconnected.
 */
const MAX_DRAIN_BYTES = 8 * 1024 * 1024;

/**
 * Read the raw body, rejecting with HttpError(413) as soon as it exceeds
 * maxBytes (from Content-Length or while streaming).
 */
export function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new HttpError(413, `Request body exceeds ${maxBytes} bytes`);

    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      drain(req);
      reject(tooLarge());
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;

    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        chunks.length = 0;
        req.removeAllListeners('data');
        drain(req);
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

/** Discard the rest of the body, destroying the request if it keeps coming. */
function drain(req: http.IncomingMessage): void {
  let discarded = 0;
  req.on('data', (chunk: Buffer) => {
    discarded += chunk.length;
    if (discarded > MAX_DRAIN_BYTES) {
      req.destroy();
    }
  });
  req.resume();
}

/** Read the body and parse it as a JSON object (400 if invalid). */
export async function readJsonBody(
  req: http.IncomingMessage,
  maxBytes: number
): Promise<Record<string, unknown>> {
  const raw = await readBody(req, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'JSON body must be an object');
  }
  return parsed as Record<string, unknown>;
}
