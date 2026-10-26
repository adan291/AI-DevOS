/**
 * Types and validation for POST /api/review (contract 3.3 in
 * DynamicBackend/docs/FABRICA.md). Validation is manual: zod is not a dependency.
 */

import type { ReviewerOutput } from '../agents/reviewer-agent.js';

export type Severity = 'high' | 'medium' | 'low';
export type Verdict = 'APPROVE' | 'REJECT';

export interface ReviewFile {
  path: string;
  content: string;
}

export interface ReviewRequest {
  files: ReviewFile[];
  context?: { projectName?: string; stack?: string[] };
}

export interface ReviewIssue {
  severity: Severity;
  category: string;
  file: string | null;
  line: number | null;
  description: string;
  suggestion: string | null;
}

/** Result for one batch of files */
export interface BatchReview {
  verdict: Verdict;
  summary: string;
  issues: ReviewIssue[];
}

export interface ReviewResponse extends BatchReview {
  reviewedFiles: number;
  skippedFiles: number;
  model: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Validate the HTTP request body. Errors are safe to return to the client. */
export function validateReviewRequest(body: unknown): Result<ReviewRequest> {
  if (!isObject(body)) return { ok: false, error: 'body must be an object' };
  const { files, context } = body;
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, error: 'files must be a non-empty array' };
  }
  for (let i = 0; i < files.length; i++) {
    const f: unknown = files[i];
    if (!isObject(f) || typeof f.path !== 'string' || f.path.trim() === '' || typeof f.content !== 'string') {
      return { ok: false, error: `files[${i}] must have a non-empty string "path" and a string "content"` };
    }
  }

  let ctx: ReviewRequest['context'];
  if (context !== undefined && context !== null) {
    if (!isObject(context)) return { ok: false, error: 'context must be an object' };
    const { projectName, stack } = context;
    if (projectName !== undefined && typeof projectName !== 'string') {
      return { ok: false, error: 'context.projectName must be a string' };
    }
    if (stack !== undefined && (!Array.isArray(stack) || !stack.every((s) => typeof s === 'string'))) {
      return { ok: false, error: 'context.stack must be an array of strings' };
    }
    ctx = { projectName, stack: stack as string[] | undefined };
  }

  return {
    ok: true,
    value: {
      files: (files as Record<string, string>[]).map((f) => ({ path: f.path, content: f.content })),
      context: ctx,
    },
  };
}

/** Take the JSON object out of a model answer (tolerates code fences and surrounding text). */
function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Parse and validate the model's JSON answer for one batch.
 * @param defaultFile used when an issue has no file and the batch has a single file
 */
export function parseModelJson(raw: string, defaultFile: string | null): Result<BatchReview> {
  let data: unknown;
  try {
    data = extractJson(raw);
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isObject(data)) return { ok: false, error: 'answer is not an object' };

  const verdict = typeof data.verdict === 'string' ? data.verdict.trim().toUpperCase() : '';
  if (verdict !== 'APPROVE' && verdict !== 'REJECT') {
    return { ok: false, error: 'verdict must be APPROVE or REJECT' };
  }
  if (typeof data.summary !== 'string') return { ok: false, error: 'summary must be a string' };
  if (!Array.isArray(data.issues)) return { ok: false, error: 'issues must be an array' };

  const issues: ReviewIssue[] = [];
  for (let i = 0; i < data.issues.length; i++) {
    const it: unknown = data.issues[i];
    if (!isObject(it)) return { ok: false, error: `issues[${i}] is not an object` };
    const severity = typeof it.severity === 'string' ? it.severity.trim().toLowerCase() : '';
    if (!SEVERITIES.includes(severity as Severity)) {
      return { ok: false, error: `issues[${i}].severity must be high, medium or low` };
    }
    if (typeof it.category !== 'string' || it.category.trim() === '') {
      return { ok: false, error: `issues[${i}].category must be a non-empty string` };
    }
    if (typeof it.description !== 'string' || it.description.trim() === '') {
      return { ok: false, error: `issues[${i}].description must be a non-empty string` };
    }
    if (it.file !== undefined && it.file !== null && typeof it.file !== 'string') {
      return { ok: false, error: `issues[${i}].file must be a string or null` };
    }
    if (
      it.line !== undefined && it.line !== null &&
      !(typeof it.line === 'number' && Number.isInteger(it.line) && it.line > 0)
    ) {
      return { ok: false, error: `issues[${i}].line must be a positive integer or null` };
    }
    if (it.suggestion !== undefined && it.suggestion !== null && typeof it.suggestion !== 'string') {
      return { ok: false, error: `issues[${i}].suggestion must be a string or null` };
    }
    issues.push({
      severity: severity as Severity,
      category: it.category.trim().toLowerCase(),
      file: (it.file as string | undefined)?.trim() || defaultFile,
      line: (it.line as number | null | undefined) ?? null,
      description: it.description.trim(),
      suggestion: (it.suggestion as string | undefined)?.trim() || null,
    });
  }

  return { ok: true, value: { verdict, summary: data.summary.trim(), issues } };
}

const MARKDOWN_SEVERITY: Record<string, Severity> = { Alta: 'high', Media: 'medium', Baja: 'low' };

const MARKDOWN_CATEGORY: [RegExp, string][] = [
  [/segur|secur/i, 'security'],
  [/rendim|perform/i, 'performance'],
  [/bug|error|lógic|logic/i, 'bug'],
  [/manten|maint|estilo|style|legib/i, 'maintainability'],
];

/**
 * Fallback when the model ignores the JSON format: reuse the Reviewer Agent
 * markdown parser. Returns null when the text has neither issues nor a verdict.
 */
export function fromReviewerMarkdown(
  raw: string,
  parsed: ReviewerOutput,
  defaultFile: string | null
): BatchReview | null {
  if (parsed.issues.length === 0 && !/veredicto/i.test(raw)) {
    return null;
  }
  const issues: ReviewIssue[] = parsed.issues.map((issue) => {
    const suggestion = parsed.suggestions.find((s) => s.issueId === issue.id);
    const lineNumber = issue.line?.match(/\d+/)?.[0];
    return {
      severity: MARKDOWN_SEVERITY[issue.severity] ?? 'medium',
      category: MARKDOWN_CATEGORY.find(([re]) => re.test(issue.category))?.[1] ?? issue.category.toLowerCase(),
      file: defaultFile,
      line: lineNumber ? Number(lineNumber) : null,
      description: issue.description,
      suggestion: suggestion ? suggestion.after || suggestion.title : null,
    };
  });
  // The markdown parser keeps the "**:" left over from "**Razón**: ..."
  const summary = parsed.verdict.reason.replace(/^[*:\s]+/, '');
  return { verdict: parsed.verdict.decision, summary, issues };
}
