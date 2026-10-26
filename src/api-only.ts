/**
 * API-only entry point (npm run start:api).
 *
 * Starts only the REST API: /api/status, /api/agents, /api/review and
 * /api/ask for sub-agents. No chat adapters (Discord, webhook...), Postgres
 * or Redis, so DATABASE_URL and DISCORD_TOKEN are not needed.
 */

import 'dotenv/config';
import { config, hasLlmProvider } from './config/index.js';
import { setDefaultModelRouter } from './agents/base-agent.js';
import { createModelRouter } from './model-router/factory.js';
import { createRestApi } from './api/rest-api.js';
import { getRestApiPort } from './api/ports.js';

// Registers the sub-agents available through /api/ask
import './agents/sub-agents/index.js';

async function main(): Promise<void> {
  console.log('[API] Starting in API-only mode (no chat adapters, Postgres or Redis)');

  if (!hasLlmProvider()) {
    console.warn('[API] No LLM provider configured (GROQ_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY or OLLAMA_MODEL); /api/review will answer 502');
  }
  const apiKey = config.WEBHOOK_API_KEY();
  if (!apiKey) {
    console.warn('[API] WEBHOOK_API_KEY is empty: endpoints are unauthenticated and bound to loopback only');
  }

  // Must be set before any agent is constructed (agents are cached)
  if (config.MODEL_ROUTER_ENABLED()) {
    setDefaultModelRouter(createModelRouter());
    console.log('[API] ModelRouter enabled');
  } else {
    console.log(`[API] LLM provider: ${config.LLM_PROVIDER()}`);
  }

  const restApi = createRestApi({ port: getRestApiPort(), apiKey, mode: 'api-only' });
  await restApi.start();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[API] Received ${signal}, shutting down...`);
    await restApi.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[API] Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
