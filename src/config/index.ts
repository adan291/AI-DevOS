/**
 * Centralized Configuration Module
 * 
 * Environment variables and constants for AI DevOS.
 * Validates required environment variables at startup.
 */

// Environment variable validation
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

/** Positive integer from the environment; invalid or empty values use the default. */
function getIntEnv(name: string, defaultValue: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

// Environment Variables
export const config = {
  // Discord
  DISCORD_TOKEN: () => getRequiredEnv('DISCORD_TOKEN'),
  
  // Redis
  REDIS_URL: () => getOptionalEnv('REDIS_URL', 'redis://localhost:6379'),
  
  // PostgreSQL
  DATABASE_URL: () => getRequiredEnv('DATABASE_URL'),
  
  // Anthropic (Claude API) - optional if using Groq
  ANTHROPIC_API_KEY: () => getOptionalEnv('ANTHROPIC_API_KEY', ''),
  
  // Groq API (free alternative)
  GROQ_API_KEY: () => getOptionalEnv('GROQ_API_KEY', ''),
  
  // OpenAI API
  OPENAI_API_KEY: () => getOptionalEnv('OPENAI_API_KEY', ''),
  
  // LLM Provider: 'anthropic' or 'groq'
  LLM_PROVIDER: () => getOptionalEnv('LLM_PROVIDER', 'groq'),
  
  // GitHub
  GITHUB_TOKEN: () => getOptionalEnv('GITHUB_TOKEN', ''),
  
  // Slack (optional)
  SLACK_BOT_TOKEN: () => getOptionalEnv('SLACK_BOT_TOKEN', ''),
  SLACK_SIGNING_SECRET: () => getOptionalEnv('SLACK_SIGNING_SECRET', ''),
  
  // Telegram (optional)
  TELEGRAM_BOT_TOKEN: () => getOptionalEnv('TELEGRAM_BOT_TOKEN', ''),
  
  // GitLab (optional)
  GITLAB_TOKEN: () => getOptionalEnv('GITLAB_TOKEN', ''),
  GITLAB_URL: () => getOptionalEnv('GITLAB_URL', 'https://gitlab.com'),
  
  // Webhook adapter (optional)
  // Port of the REST API (/api/*). Also the WebhookAdapter port unless
  // WEBHOOK_ADAPTER_PORT is set; both cannot share it (checked at startup).
  WEBHOOK_PORT: () => getOptionalEnv('WEBHOOK_PORT', '3001'),
  WEBHOOK_ADAPTER_PORT: () => getOptionalEnv('WEBHOOK_ADAPTER_PORT', ''),
  WEBHOOK_API_KEY: () => getOptionalEnv('WEBHOOK_API_KEY', ''),
  // Interface the HTTP APIs bind to. Non-loopback values require WEBHOOK_API_KEY.
  API_HOST: () => getOptionalEnv('API_HOST', '127.0.0.1'),
  // REST API body limits in bytes (413 when exceeded)
  API_MAX_BODY_BYTES: () => getIntEnv('API_MAX_BODY_BYTES', 256 * 1024),
  REVIEW_MAX_BODY_BYTES: () => getIntEnv('REVIEW_MAX_BODY_BYTES', 2 * 1024 * 1024),
  // POST /api/review: characters of code per LLM call (~4 chars per token).
  // A file that does not fit in one batch is skipped.
  REVIEW_MAX_CHARS_PER_BATCH: () => getIntEnv('REVIEW_MAX_CHARS_PER_BATCH', 24_000),
  // POST /api/review: batches reviewed in parallel
  REVIEW_CONCURRENCY: () => getIntEnv('REVIEW_CONCURRENCY', 2),
  // POST /api/review: timeout of each LLM call in ms (a batch is larger than a chat message)
  REVIEW_TIMEOUT_MS: () => getIntEnv('REVIEW_TIMEOUT_MS', 180_000),

  // Groq model override (Groq retires models; check https://console.groq.com/docs/models)
  GROQ_MODEL: () => getOptionalEnv('GROQ_MODEL', ''),

  // Ollama (local models, OpenAI-compatible API). Empty model = disabled.
  OLLAMA_BASE_URL: () => getOptionalEnv('OLLAMA_BASE_URL', 'http://127.0.0.1:11434/v1'),
  OLLAMA_MODEL: () => getOptionalEnv('OLLAMA_MODEL', ''),

  // Use the ModelRouter (task complexity -> model). Off = always LLM_PROVIDER.
  MODEL_ROUTER_ENABLED: () => getOptionalEnv('MODEL_ROUTER_ENABLED', 'false') === 'true',

  // Discord channel IDs the bot answers in (comma-separated). Empty = all channels.
  DISCORD_ALLOWED_CHANNEL_IDS: () => getOptionalEnv('DISCORD_ALLOWED_CHANNEL_IDS', ''),
  
  // Enabled adapters (comma-separated: discord,slack,telegram,webhook)
  CHAT_ADAPTERS: () => getOptionalEnv('CHAT_ADAPTERS', 'discord'),
  VCS_ADAPTERS: () => getOptionalEnv('VCS_ADAPTERS', 'github'),
} as const;

// Constants from Design Document — Error Handling section
export const constants = {
  /** Maximum timeout for agent execution in milliseconds (60 seconds) */
  MAX_AGENT_TIMEOUT: 60_000,
  
  /** Number of messages before triggering automatic summary (Requirement 8.1) */
  AUTO_SUMMARY_THRESHOLD: 15,
  
  /** Maximum retry attempts for webhook processing (Requirement 9.5) */
  MAX_RETRY_ATTEMPTS: 3,
  
  /** Maximum turns in multi-agent debate before requesting user decision (Requirement 10.4) */
  DEBATE_MAX_TURNS: 4,
  
  // Reconnection backoff settings (Error Handling — Gateway)
  /** Initial reconnection delay in milliseconds */
  RECONNECT_INITIAL_DELAY: 1_000,
  /** Maximum reconnection delay in milliseconds */
  RECONNECT_MAX_DELAY: 30_000,
  /** Backoff multiplier for reconnection attempts */
  RECONNECT_BACKOFF_MULTIPLIER: 2,
  
  // Retry backoff settings for webhooks (Error Handling — Gateway)
  /** Initial retry delay for webhooks in milliseconds */
  WEBHOOK_RETRY_INITIAL_DELAY: 1_000,
  /** Backoff multiplier for webhook retries */
  WEBHOOK_RETRY_BACKOFF_MULTIPLIER: 2,
  
  // Persistence settings (Error Handling — Persistencia)
  /** Maximum queued writes when Postgres is unavailable */
  MAX_QUEUED_WRITES: 100,
  /** Retry interval for Postgres reconnection in milliseconds */
  POSTGRES_RETRY_INTERVAL: 30_000,
} as const;

// Type exports for configuration
export type Config = typeof config;
export type Constants = typeof constants;

/** Startup mode: everything (chat, Postgres, Redis) or only the REST API */
export type RunMode = 'full' | 'api';

/** True when at least one LLM provider has credentials (or a local Ollama model). */
export function hasLlmProvider(): boolean {
  return ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'OLLAMA_MODEL'].some(
    (name) => !!process.env[name]
  );
}

/**
 * Validates all required environment variables.
 * Call this at application startup to fail fast if configuration is missing.
 * The 'api' mode needs neither Discord nor a database.
 */
export function validateConfig(mode: RunMode = 'full'): void {
  const requiredVars = mode === 'full' ? ['DISCORD_TOKEN', 'DATABASE_URL'] : [];
  const missing: string[] = [];
  
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }
  
  // Need at least one LLM provider
  if (!hasLlmProvider()) {
    missing.push('GROQ_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY or OLLAMA_MODEL');
  }
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}
