/**
 * ReviewService with a mocked LLM: batching, merging, verdict, invalid JSON.
 */

import { describe, it, expect, vi } from 'vitest';
import { ReviewService, ReviewLlmError, buildBatches, formatFile, isProbablyBinary, type ReviewLlm } from './review-service.js';
import { parseModelJson, validateReviewRequest } from './review-schema.js';

const json = (verdict: string, issues: unknown[], summary = 'ok') => JSON.stringify({ verdict, summary, issues });

const issue = (severity: string, file: string, line: number | null = 1) => ({
  severity,
  category: 'bug',
  file,
  line,
  description: `${severity} en ${file}`,
  suggestion: 'arreglarlo',
});

function mockLlm(answers: ((prompt: string) => string | Promise<string>) | string[]): ReviewLlm & { complete: ReturnType<typeof vi.fn> } {
  let call = 0;
  const complete = vi.fn(async (prompt: string) => {
    if (typeof answers === 'function') return answers(prompt);
    return answers[Math.min(call++, answers.length - 1)];
  });
  return { model: 'mock/model', complete };
}

/** Path names of the files included in a prompt */
const filesIn = (prompt: string) => [...prompt.matchAll(/=== FILE "([^"]+)" ===/g)].map((m) => m[1]);

describe('buildBatches', () => {
  it('groups files by character budget, keeping request order', () => {
    const files = ['a', 'b', 'c', 'd'].map((p) => ({ path: p, content: 'x'.repeat(40) }));
    const size = formatFile(files[0]).length;
    const { batches, skipped, reviewed } = buildBatches(files, size * 2);
    expect(batches.map((b) => b.map((f) => f.path))).toEqual([['a', 'b'], ['c', 'd']]);
    expect(skipped).toEqual([]);
    expect(reviewed).toBe(4);
  });

  it('skips binary files and files bigger than one batch', () => {
    const files = [
      { path: 'ok.java', content: 'class A {}' },
      { path: 'img.png', content: 'PNG\u0000\u0001\u0002' },
      { path: 'huge.java', content: 'y'.repeat(5000) },
    ];
    const { batches, skipped, reviewed } = buildBatches(files, 1000);
    expect(batches.flat().map((f) => f.path)).toEqual(['ok.java']);
    expect(skipped).toEqual(['img.png', 'huge.java']);
    expect(reviewed).toBe(1);
  });

  it('numbers lines so the model can report them', () => {
    expect(formatFile({ path: 'A.java', content: 'a\nb' })).toContain('1| a\n2| b');
  });

  it('detects binary content', () => {
    expect(isProbablyBinary('hola\nmundo')).toBe(false);
    expect(isProbablyBinary('\u0000abc')).toBe(true);
    expect(isProbablyBinary('\u0001\u0002\u0003abc')).toBe(true);
  });
});

describe('ReviewService', () => {
  it('reviews batches with limited concurrency and merges the issues', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const llm = mockLlm(async (prompt) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      const [file] = filesIn(prompt);
      return json('APPROVE', [issue(file === 'c.java' ? 'medium' : 'low', file)], `lote ${file}`);
    });
    const files = ['a.java', 'b.java', 'c.java', 'd.java', 'e.java'].map((path) => ({ path, content: 'int x = 1;' }));
    const maxChars = formatFile(files[0]).length; // one file per batch

    const result = await new ReviewService({ llm, maxCharsPerBatch: maxChars, concurrency: 2 }).review({ files });

    expect(llm.complete).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBe(2);
    expect(result.issues).toHaveLength(5);
    expect(result.issues[0]).toMatchObject({ severity: 'medium', file: 'c.java' });
    expect(result.verdict).toBe('APPROVE');
    expect(result.reviewedFiles).toBe(5);
    expect(result.skippedFiles).toBe(0);
    expect(result.model).toBe('mock/model');
    expect(result.summary).toContain('5 lotes');
  });

  it('rejects when any batch has a high issue, even if the model approved it', async () => {
    const llm = mockLlm((prompt) => {
      const [file] = filesIn(prompt);
      return json('APPROVE', file === 'b.java' ? [issue('high', file, 7)] : []);
    });
    const files = ['a.java', 'b.java'].map((path) => ({ path, content: 'int x = 1;' }));
    const result = await new ReviewService({ llm, maxCharsPerBatch: formatFile(files[0]).length }).review({ files });
    expect(result.verdict).toBe('REJECT');
    expect(result.issues).toEqual([expect.objectContaining({ severity: 'high', file: 'b.java', line: 7 })]);
  });

  it('approves when there are only medium/low issues, even if the model rejected', async () => {
    const llm = mockLlm([json('REJECT', [issue('medium', 'a.java')])]);
    const result = await new ReviewService({ llm }).review({ files: [{ path: 'a.java', content: 'x' }] });
    expect(result.verdict).toBe('APPROVE');
  });

  it('counts skipped files and does not call the LLM when nothing is reviewable', async () => {
    const llm = mockLlm([json('APPROVE', [])]);
    const result = await new ReviewService({ llm, maxCharsPerBatch: 100 }).review({
      files: [{ path: 'bin', content: '\u0000\u0000' }, { path: 'big', content: 'z'.repeat(500) }],
    });
    expect(llm.complete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ verdict: 'APPROVE', reviewedFiles: 0, skippedFiles: 2, issues: [] });
  });

  it('includes project context in the prompt', async () => {
    const llm = mockLlm([json('APPROVE', [])]);
    await new ReviewService({ llm }).review({
      files: [{ path: 'a.java', content: 'x' }],
      context: { projectName: 'demo', stack: ['Java 25', 'Spring Boot 3.5'] },
    });
    const prompt = llm.complete.mock.calls[0][0] as string;
    expect(prompt).toContain('Proyecto: demo');
    expect(prompt).toContain('Stack: Java 25, Spring Boot 3.5');
  });

  it('retries once when the JSON is invalid', async () => {
    const llm = mockLlm(['esto no es JSON', '```json\n' + json('REJECT', [issue('high', 'a.java')]) + '\n```']);
    const result = await new ReviewService({ llm }).review({ files: [{ path: 'a.java', content: 'x' }] });
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(llm.complete.mock.calls[1][0]).toContain('Tu respuesta anterior no era válida');
    expect(result.verdict).toBe('REJECT');
  });

  it('falls back to the markdown parser after two invalid JSON answers', async () => {
    const markdown = `### Issues Encontrados
| # | Severidad | Categoría | Descripción | Línea |
|---|-----------|-----------|-------------|-------|
| 1 | Alta | Seguridad | SQL concatenado | L12 |

### Veredicto
**REJECT**

**Razón**: hay una inyección SQL`;
    const llm = mockLlm(['{"verdict":"MAYBE"}', markdown]);
    const result = await new ReviewService({ llm }).review({ files: [{ path: 'Repo.java', content: 'x' }] });
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(result.verdict).toBe('REJECT');
    expect(result.summary).toBe('hay una inyección SQL');
    expect(result.issues).toEqual([
      { severity: 'high', category: 'security', file: 'Repo.java', line: 12, description: 'SQL concatenado', suggestion: null },
    ]);
  });

  it('throws ReviewLlmError when neither JSON nor markdown can be parsed', async () => {
    const llm = mockLlm(['nada', 'tampoco']);
    await expect(new ReviewService({ llm }).review({ files: [{ path: 'a', content: 'x' }] })).rejects.toBeInstanceOf(ReviewLlmError);
  });

  it('wraps provider errors in ReviewLlmError', async () => {
    const llm = mockLlm(() => {
      throw new Error('401 invalid api key sk-secret');
    });
    await expect(new ReviewService({ llm }).review({ files: [{ path: 'a', content: 'x' }] })).rejects.toBeInstanceOf(ReviewLlmError);
  });
});

describe('parseModelJson', () => {
  it('normalizes case and fills the file for single-file batches', () => {
    const raw = JSON.stringify({ verdict: 'reject', summary: 's', issues: [{ severity: 'HIGH', category: 'Security', description: 'd', line: null }] });
    const parsed = parseModelJson(raw, 'A.java');
    expect(parsed).toEqual({
      ok: true,
      value: { verdict: 'REJECT', summary: 's', issues: [{ severity: 'high', category: 'security', file: 'A.java', line: null, description: 'd', suggestion: null }] },
    });
  });

  it.each([
    ['bad severity', { verdict: 'APPROVE', summary: '', issues: [{ severity: 'critical', category: 'bug', description: 'd' }] }],
    ['bad line', { verdict: 'APPROVE', summary: '', issues: [{ severity: 'low', category: 'bug', description: 'd', line: 'L4' }] }],
    ['missing issues', { verdict: 'APPROVE', summary: '' }],
    ['missing description', { verdict: 'APPROVE', summary: '', issues: [{ severity: 'low', category: 'bug' }] }],
  ])('rejects %s', (_name, data) => {
    expect(parseModelJson(JSON.stringify(data), null).ok).toBe(false);
  });
});

describe('validateReviewRequest', () => {
  it('accepts the contract example', () => {
    const body = { files: [{ path: 'src/A.java', content: '...' }], context: { projectName: 'demo', stack: ['Java 25'] } };
    expect(validateReviewRequest(body).ok).toBe(true);
  });

  it.each([
    ['no files', {}],
    ['empty files', { files: [] }],
    ['file without path', { files: [{ content: 'x' }] }],
    ['content not string', { files: [{ path: 'a', content: 1 }] }],
    ['bad stack', { files: [{ path: 'a', content: 'x' }], context: { stack: 'Java' } }],
  ])('rejects %s', (_name, body) => {
    expect(validateReviewRequest(body).ok).toBe(false);
  });
});
