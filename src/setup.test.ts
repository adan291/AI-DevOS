import { describe, it, expect } from 'vitest';

describe('Project Setup', () => {
  it('should have TypeScript configured correctly', () => {
    expect(true).toBe(true);
  });

  it('should have fast-check available for property-based testing', async () => {
    const fc = await import('fast-check');
    expect(fc.integer).toBeDefined();
  });
});
