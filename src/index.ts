/**
 * AI DevOS - Multi-agent Development Operating System
 * Main entry point
 * 
 * Supports multiple chat platforms (Discord, Slack, Telegram, Webhook/CLI)
 * and multiple VCS platforms (GitHub, GitLab) simultaneously.
 * 
 * Requirements: 1.1, 2.1
 */

import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Redis } from 'ioredis';
import { config } from './config/index.js';
import { DiscordBot } from './gateway/discord-bot.js';
import { createOrchestrator } from './orchestrator/orchestrator.js';
import { createEventRouter } from './orchestrator/event-router.js';
import { createContextLoader } from './orchestrator/context-loader.js';
import { createPromptBuilder } from './orchestrator/prompt-builder.js';
import { createResponseManager } from './orchestrator/response-manager.js';
import { createAgentFactory } from './agents/agent-factory.js';
import { setDefaultModelRouter } from './agents/base-agent.js';
import { createModelRouter } from './model-router/factory.js';
import { createPostgresStore } from './persistence/postgres-store.js';
import { createRedisStore } from './persistence/redis-store.js';
import { createVectorStore } from './persistence/vector-store.js';
import { setKnowledgeStoreDatabase, getKnowledgeStore } from './ingestion/knowledge-store.js';
import type { NormalizedEvent } from './types/events.js';
import type { OrchestratorLogger } from './orchestrator/orchestrator.js';

// Adapters
import { AdapterManager } from './adapters/adapter-manager.js';
import { DiscordAdapter } from './adapters/discord-adapter.js';
import { SlackAdapter } from './adapters/slack-adapter.js';
import { TelegramAdapter } from './adapters/telegram-adapter.js';
import { WebhookAdapter } from './adapters/webhook-adapter.js';
import { VCSManager } from './adapters/vcs-manager.js';
import { GitHubVCSAdapter } from './adapters/github-vcs-adapter.js';
import { GitLabVCSAdapter } from './adapters/gitlab-vcs-adapter.js';

// Import all agents to register them with the factory
import './agents/coordinator-agent.js';
import './agents/architect-agent.js';
import './agents/planner-agent.js';
import './agents/developer-agent.js';
import './agents/reviewer-agent.js';
import './agents/qa-agent.js';
import './agents/devops-agent.js';
import './agents/memory-agent.js';

// Import sub-agents (registers them automatically)
import './agents/sub-agents/index.js';

// REST API
import { createRestApi } from './api/rest-api.js';
import { assertNoPortConflict, getRestApiPort, getWebhookAdapterPort } from './api/ports.js';

/** Console logger implementation */
const logger: OrchestratorLogger = {
  info: (message, data) => console.log(`[INFO] ${message}`, data ?? ''),
  error: (message, data) => console.error(`[ERROR] ${message}`, data ?? ''),
  warn: (message, data) => console.warn(`[WARN] ${message}`, data ?? ''),
  debug: (message, data) => console.debug(`[DEBUG] ${message}`, data ?? ''),
};

/**
 * Initialize chat adapters based on CHAT_ADAPTERS env var.
 * Supports: discord, slack, telegram, webhook
 */
function initChatAdapters(): AdapterManager {
  const manager = new AdapterManager();
  const enabledAdapters = config.CHAT_ADAPTERS().split(',').map(s => s.trim().toLowerCase());

  logger.info('Initializing chat adapters...', { adapters: enabledAdapters });

  for (const adapterName of enabledAdapters) {
    switch (adapterName) {
      case 'discord': {
        const discord = new DiscordAdapter();
        manager.registerAdapter(discord, true); // Discord is primary by default
        logger.info('Discord adapter registered');
        break;
      }
      case 'slack': {
        const slack = new SlackAdapter();
        manager.registerAdapter(slack);
        logger.info('Slack adapter registered');
        break;
      }
      case 'telegram': {
        const telegram = new TelegramAdapter();
        manager.registerAdapter(telegram);
        logger.info('Telegram adapter registered');
        break;
      }
      case 'webhook': {
        const webhook = new WebhookAdapter();
        manager.registerAdapter(webhook);
        logger.info('Webhook/CLI adapter registered');
        break;
      }
      default:
        logger.warn(`Unknown chat adapter: ${adapterName}`);
    }
  }

  return manager;
}

/**
 * Initialize VCS adapters based on VCS_ADAPTERS env var.
 * Supports: github, gitlab
 */
function initVCSAdapters(): VCSManager {
  const manager = new VCSManager();
  const enabledAdapters = config.VCS_ADAPTERS().split(',').map(s => s.trim().toLowerCase());

  logger.info('Initializing VCS adapters...', { adapters: enabledAdapters });

  for (const adapterName of enabledAdapters) {
    switch (adapterName) {
      case 'github': {
        const github = new GitHubVCSAdapter();
        manager.registerAdapter(github, true);
        logger.info('GitHub VCS adapter registered');
        break;
      }
      case 'gitlab': {
        const gitlab = new GitLabVCSAdapter();
        manager.registerAdapter(gitlab);
        logger.info('GitLab VCS adapter registered');
        break;
      }
      default:
        logger.warn(`Unknown VCS adapter: ${adapterName}`);
    }
  }

  return manager;
}

/** Initialize all components and start the bot */
async function main(): Promise<void> {
  logger.info('AI DevOS starting...');

  // Fail before opening any connection if two servers would share a port
  const apiPort = getRestApiPort();
  assertNoPortConflict(
    config.CHAT_ADAPTERS().split(',').map(s => s.trim().toLowerCase()),
    apiPort,
    getWebhookAdapterPort()
  );

  // Initialize database connections
  logger.info('Connecting to PostgreSQL...');
  const pgClient = postgres(config.DATABASE_URL());
  const db = drizzle(pgClient);

  logger.info('Connecting to Redis...');
  const redis = new Redis(config.REDIS_URL());

  // Initialize persistence stores with real connections
  logger.info('Initializing persistence stores...');
  const postgresStore = createPostgresStore(db);
  const redisStore = createRedisStore(redis);
  const vectorStore = createVectorStore(db);

  // Initialize Knowledge Store with PostgreSQL connection
  logger.info('Initializing Knowledge Store with PostgreSQL...');
  setKnowledgeStoreDatabase(db);
  const knowledgeStore = getKnowledgeStore();
  const knowledgeStats = await knowledgeStore.getStats();
  logger.info('Knowledge Store initialized', {
    usingPostgres: knowledgeStore.isUsingPostgres(),
    totalEntries: knowledgeStats.total,
  });

  // Initialize agent factory
  logger.info('Initializing agent factory...');
  const agentFactory = createAgentFactory();

  // Initialize chat adapters (multi-platform)
  const chatManager = initChatAdapters();

  // Initialize VCS adapters (multi-platform)
  const vcsManager = initVCSAdapters();

  // ModelRouter must be set before any agent is constructed (agents are cached)
  if (config.MODEL_ROUTER_ENABLED()) {
    setDefaultModelRouter(createModelRouter());
    logger.info('ModelRouter enabled', {
      ollamaModel: config.OLLAMA_MODEL() || '(disabled)',
    });
  } else {
    logger.info('ModelRouter disabled, using LLM_PROVIDER', { provider: config.LLM_PROVIDER() });
  }

  // Initialize orchestrator components
  logger.info('Initializing orchestrator...');
  const eventRouter = createEventRouter();
  const contextLoader = createContextLoader(redisStore, postgresStore);
  const promptBuilder = createPromptBuilder();
  
  const responseManager = createResponseManager({
    gateway: chatManager, // AdapterManager implements Gateway interface
    logger,
  });

  // Create orchestrator
  const orchestrator = createOrchestrator({
    redisStore,
    postgresStore,
    gateway: chatManager, // AdapterManager implements Gateway interface
    logger,
    eventRouter,
    contextLoader,
    promptBuilder,
    responseManager,
    // MemoryAgent output is not persisted anywhere yet, so calling it after
    // every agent only spends tokens. Re-enable once memories are saved.
    agentExecutorConfig: { skipMemoryPersistence: true },
  });

  // Set up event handler on all chat adapters
  chatManager.onEvent(async (event: NormalizedEvent): Promise<void> => {
    try {
      await orchestrator.handleEvent(event);
    } catch (error) {
      logger.error('Error handling event', { 
        eventId: event.id, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // Set up VCS webhook handler
  vcsManager.onWebhook(async (event) => {
    logger.info('VCS webhook received', {
      platform: event.platform,
      action: event.action,
      repo: event.repository.fullName,
    });
    // VCS events can be converted to NormalizedEvents and processed by the orchestrator
  });

  // Start all chat adapters
  logger.info('Starting chat adapters...');
  await chatManager.start();

  // Start REST API
  const restApi = createRestApi({
    port: apiPort,
    apiKey: config.WEBHOOK_API_KEY?.() ?? '',
    orchestrator,
  });
  await restApi.start();

  logger.info('AI DevOS is running!', {
    chatPlatforms: chatManager.getPlatforms(),
    vcsPlatforms: vcsManager.getPlatforms(),
    apiPort,
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down...`);
    
    try {
      await chatManager.stop();
      logger.info('Chat adapters stopped');
      
      await restApi.stop();
      logger.info('REST API stopped');
      
      // Close database connections
      await pgClient.end();
      logger.info('PostgreSQL connection closed');
      
      redis.disconnect();
      logger.info('Redis connection closed');
      
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Run the application
main().catch((error) => {
  logger.error('Fatal error', { 
    error: error instanceof Error ? error.message : String(error) 
  });
  process.exit(1);
});

export { main };
