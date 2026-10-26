import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@gateway': resolve(__dirname, './src/gateway'),
      '@orchestrator': resolve(__dirname, './src/orchestrator'),
      '@agents': resolve(__dirname, './src/agents'),
      '@persistence': resolve(__dirname, './src/persistence'),
      '@github': resolve(__dirname, './src/github'),
      '@types': resolve(__dirname, './src/types'),
      '@config': resolve(__dirname, './src/config'),
    },
  },
});
