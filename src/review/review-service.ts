/**
 * Review Service: synchronous code review for POST /api/review.
 *
 * Splits the files into batches by character budget, reviews the batches with
 * limited concurrency, and merges the results. No orchestrator, Redis or Postgres.
 */

import { config } from '../config/index.js';
import { ReviewerAgent } from '../agents/reviewer-agent.js';
import { FileReviewAgent } from '../agents/file-review-agent.js';
import {
  parseModelJson,
  fromReviewerMarkdown,
  type BatchReview,
  type ReviewFile,
  type ReviewIssue,
  type ReviewRequest,
  type ReviewResponse,
  type Severity,
} from './review-schema.js';

/** LLM used by the service (mocked in tests) */
export interface ReviewLlm {
  /** Model description returned in the response */
  readonly model: string;
  complete(prompt: string): Promise<string>;
}

/** The model failed or gave an unusable answer. Maps to HTTP 502. */
export class ReviewLlmError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ReviewLlmError';
  }
}

export interface ReviewServiceOptions {
  /** Defaults to a FileReviewAgent created on first use */
  llm?: ReviewLlm;
  /** Characters of formatted code per batch (REVIEW_MAX_CHARS_PER_BATCH) */
  maxCharsPerBatch?: number;
  /** Batches reviewed in parallel (REVIEW_CONCURRENCY) */
  concurrency?: number;
  /** Retries after HTTP 429 per model call (REVIEW_RATE_LIMIT_RETRIES) */
  rateLimitRetries?: number;
  /** Cap on a single rate-limit wait */
  maxRateLimitWaitMs?: number;
  /** Injected in tests */
  sleep?: (ms: number) => Promise<void>;
}

/** A file formatted for the prompt, with line numbers */
interface PreparedFile {
  path: string;
  block: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** True for content that looks binary (NUL bytes or many control/replacement chars). */
export function isProbablyBinary(content: string): boolean {
  if (content.includes('\u0000')) return true;
  const sample = content.slice(0, 8192);
  if (sample.length === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13)) {
      suspicious++;
    }
  }
  return suspicious / sample.length > 0.1;
}

/** File block as sent to the model: header plus numbered lines. */
export function formatFile(file: ReviewFile): string {
  const lines = file.content.replace(/\r\n?/g, '\n').split('\n');
  const width = String(lines.length).length;
  const numbered = lines.map((line, i) => `${String(i + 1).padStart(width, ' ')}| ${line}`).join('\n');
  return `=== FILE ${JSON.stringify(file.path)} ===\n${numbered}\n=== END FILE ===\n`;
}

/**
 * Greedy batching in request order. Files whose block alone exceeds the
 * budget are returned as skipped.
 */
export function buildBatches(
  files: ReviewFile[],
  maxChars: number
): { batches: PreparedFile[][]; skipped: string[]; reviewed: number } {
  const batches: PreparedFile[][] = [];
  const skipped: string[] = [];
  let reviewed = 0;
  let current: PreparedFile[] = [];
  let currentSize = 0;

  for (const file of files) {
    if (isProbablyBinary(file.content)) {
      skipped.push(file.path);
      continue;
    }
    if (file.content.trim() === '') {
      reviewed++; // nothing to send
      continue;
    }
    const block = formatFile(file);
    if (block.length > maxChars) {
      skipped.push(file.path);
      continue;
    }
    if (currentSize + block.length > maxChars && current.length > 0) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push({ path: file.path, block });
    currentSize += block.length;
    reviewed++;
  }
  if (current.length > 0) batches.push(current);

  return { batches, skipped, reviewed };
}

function buildPrompt(batch: PreparedFile[], context: ReviewRequest['context']): string {
  const header: string[] = [];
  if (context?.projectName) header.push(`Proyecto: ${context.projectName}`);
  if (context?.stack?.length) header.push(`Stack: ${context.stack.join(', ')}`);
  return [
    ...header,
    `Revisa estos ${batch.length} fichero(s). Responde solo con el JSON indicado.`,
    '',
    ...batch.map((f) => f.block),
  ].join('\n');
}

/** Run tasks with at most `limit` in flight; stops scheduling after the first failure. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Milliseconds to wait if the error is a rate limit (HTTP 429), or null.
 * Reads the Retry-After header or the "try again in 45.4s" text that Groq and
 * OpenAI put in the message. Without a hint, waits 10 s.
 */
export function rateLimitDelayMs(error: unknown): number | null {
  const e = error as { status?: unknown; headers?: unknown; message?: unknown } | null;
  const message = typeof e?.message === 'string' ? e.message : String(error ?? '');
  const is429 = e?.status === 429 || /\b429\b|rate limit/i.test(message);
  if (!is429) return null;

  const headers = e?.headers as { get?: (name: string) => string | null } | Record<string, string> | undefined;
  const retryAfter = typeof headers?.get === 'function'
    ? headers.get('retry-after')
    : (headers as Record<string, string> | undefined)?.['retry-after'];
  const seconds = Number.parseFloat(retryAfter ?? '');
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);

  const match = /try again in ((\d+)m)?([\d.]+)s/i.exec(message);
  if (match) {
    const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
    return Math.ceil((minutes * 60 + Number.parseFloat(match[3])) * 1000);
  }
  return 10_000;
}

export class ReviewService {
  private llm: ReviewLlm | null;
  private readonly maxCharsPerBatch: number;
  private readonly concurrency: number;
  private readonly rateLimitRetries: number;
  private readonly maxRateLimitWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ReviewServiceOptions = {}) {
    this.llm = options.llm ?? null;
    this.maxCharsPerBatch = options.maxCharsPerBatch ?? config.REVIEW_MAX_CHARS_PER_BATCH();
    this.concurrency = Math.max(1, options.concurrency ?? config.REVIEW_CONCURRENCY());
    this.rateLimitRetries = options.rateLimitRetries ?? config.REVIEW_RATE_LIMIT_RETRIES();
    this.maxRateLimitWaitMs = options.maxRateLimitWaitMs ?? 120_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    const { batches, skipped, reviewed } = buildBatches(request.files, this.maxCharsPerBatch);

    if (batches.length === 0) {
      return {
        verdict: 'APPROVE',
        summary: reviewed === 0 ? 'No se revisó ningún fichero (todos binarios o demasiado grandes).' : 'Los ficheros están vacíos.',
        issues: [],
        reviewedFiles: reviewed,
        skippedFiles: skipped.length,
        model: this.llm?.model ?? 'none',
      };
    }

    const llm = this.getLlm();
    const results = await mapWithConcurrency(batches, this.concurrency, (batch) =>
      this.reviewBatch(llm, batch, request.context)
    );

    const issues = results
      .flatMap((r) => r.issues)
      .map((issue, index) => ({ issue, index }))
      .sort((a, b) => SEVERITY_ORDER[a.issue.severity] - SEVERITY_ORDER[b.issue.severity] || a.index - b.index)
      .map(({ issue }) => issue);

    const summaries = results.map((r) => r.summary).filter(Boolean);
    const summary = results.length === 1
      ? summaries[0] ?? ''
      : `Revisión en ${results.length} lotes. ${summaries.join(' ')}`.trim();

    return {
      verdict: issues.some((i) => i.severity === 'high') ? 'REJECT' : 'APPROVE',
      summary,
      issues,
      reviewedFiles: reviewed,
      skippedFiles: skipped.length,
      model: llm.model,
    };
  }

  /** JSON answer, one retry, then the markdown parser as last resort. */
  private async reviewBatch(
    llm: ReviewLlm,
    batch: PreparedFile[],
    context: ReviewRequest['context']
  ): Promise<BatchReview> {
    const defaultFile = batch.length === 1 ? batch[0].path : null;
    const prompt = buildPrompt(batch, context);

    const first = await this.call(llm, prompt);
    const firstParsed = parseModelJson(first, defaultFile);
    if (firstParsed.ok) return firstParsed.value;

    const retryPrompt = `${prompt}\n\nTu respuesta anterior no era válida (${firstParsed.error}). Responde SOLO con el objeto JSON del formato indicado.`;
    const second = await this.call(llm, retryPrompt);
    const secondParsed = parseModelJson(second, defaultFile);
    if (secondParsed.ok) return secondParsed.value;

    const fallback = fromReviewerMarkdown(second, ReviewerAgent.parseReviewerOutput(second), defaultFile);
    if (fallback) return fallback;

    throw new ReviewLlmError(`Unusable model answer: ${secondParsed.error}`);
  }

  /**
   * One model call. On a rate limit (HTTP 429) waits what the provider asks
   * (Retry-After or "try again in Ns"), up to rateLimitRetries times.
   */
  private async call(llm: ReviewLlm, prompt: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await llm.complete(prompt);
      } catch (error) {
        const waitMs = rateLimitDelayMs(error);
        if (waitMs === null || attempt >= this.rateLimitRetries) {
          throw new ReviewLlmError('LLM call failed', error);
        }
        await this.sleep(Math.min(waitMs, this.maxRateLimitWaitMs));
      }
    }
  }

  private getLlm(): ReviewLlm {
    if (!this.llm) {
      try {
        const agent = new FileReviewAgent();
        this.llm = { model: agent.describeModel(), complete: (prompt) => agent.complete(prompt) };
      } catch (error) {
        throw new ReviewLlmError('LLM client could not be created', error);
      }
    }
    return this.llm;
  }
}

export function createReviewService(options?: ReviewServiceOptions): ReviewService {
  return new ReviewService(options);
}
