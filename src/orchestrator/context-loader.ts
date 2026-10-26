/**
 * Context Loader
 * 
 * Loads context from persistence layers (Redis first, Postgres fallback)
 * for the orchestrator to use when processing events.
 * 
 * The loader follows a fail-forward approach: if context is not found,
 * it creates default context with empty values.
 * 
 * Requirements: 2.1
 */

import type { ContextLoader, FullContext, RoutingDecision } from '../types/orchestrator.js';
import type { OrgContext, ProjectContext, ThreadContext, ThreadState } from '../types/models.js';
import type { RedisStore, PostgresStore } from '../types/persistence.js';

/**
 * Creates a default OrgContext with empty values
 */
function createDefaultOrgContext(guildId: string): OrgContext {
  return {
    guildId,
    standards: [],
    architecture: [],
  };
}

/**
 * Creates a default ProjectContext with empty values
 */
function createDefaultProjectContext(channelId: string, guildId: string): ProjectContext {
  return {
    channelId,
    guildId,
    name: '',
    stack: [],
    rules: [],
  };
}

/**
 * Creates a default ThreadContext with empty values
 */
function createDefaultThreadContext(threadId: string, channelId: string): ThreadContext {
  return {
    threadId,
    channelId,
    type: 'task',
    title: '',
    summary: '',
    state: 'open',
    decisions: [],
    artifacts: [],
    messageCount: 0,
    lastSummaryAt: 0,
  };
}

/**
 * Default implementation of ContextLoader
 * 
 * Loads OrgContext, ProjectContext, and ThreadContext from persistence.
 * Uses Redis first for thread state (live state), then falls back to Postgres.
 * Creates default context when records don't exist.
 */
export class DefaultContextLoader implements ContextLoader {
  constructor(
    private readonly redisStore: RedisStore,
    private readonly postgresStore: PostgresStore
  ) {}

  /**
   * Loads the full context for processing an event.
   * 
   * Loading strategy:
   * 1. OrgContext: Load from Postgres (source of truth for org data)
   * 2. ProjectContext: Load from Postgres (source of truth for project data)
   * 3. ThreadContext: Try Redis first for live state, fallback to Postgres
   * 
   * If any context is not found, default context with empty values is created.
   * 
   * @param keys - Context keys containing orgId, projectId, and optional threadId
   * @returns FullContext with org, project, and optional thread context
   */
  async load(keys: RoutingDecision['contextKeys']): Promise<FullContext> {
    const { orgId, projectId, threadId } = keys;

    // Load org context from Postgres (always source of truth)
    const org = await this.loadOrgContext(orgId);

    // Load project context from Postgres (always source of truth)
    const project = await this.loadProjectContext(projectId, orgId);

    // Load thread context if threadId is provided
    let thread: ThreadContext | undefined;
    if (threadId) {
      thread = await this.loadThreadContext(threadId, projectId);
    }

    return {
      org,
      project,
      thread,
    };
  }

  /**
   * Loads OrgContext from Postgres.
   * Returns default context if not found.
   */
  private async loadOrgContext(guildId: string): Promise<OrgContext> {
    try {
      const org = await this.postgresStore.getOrg(guildId);
      // PostgresStore already returns default context if not found
      return org;
    } catch {
      // On error, return default context (fail-forward)
      return createDefaultOrgContext(guildId);
    }
  }

  /**
   * Loads ProjectContext from Postgres.
   * Returns default context if not found.
   */
  private async loadProjectContext(channelId: string, guildId: string): Promise<ProjectContext> {
    try {
      const project = await this.postgresStore.getProject(channelId);
      // If project has empty guildId (default), set it from the context
      if (!project.guildId) {
        project.guildId = guildId;
      }
      return project;
    } catch {
      // On error, return default context (fail-forward)
      return createDefaultProjectContext(channelId, guildId);
    }
  }

  /**
   * Loads ThreadContext using Redis first for live state, then Postgres as fallback.
   * 
   * Strategy:
   * 1. Try to get thread state from Redis (live state)
   * 2. Load full thread from Postgres
   * 3. If Redis has state, merge it with Postgres data (Redis is more current)
   * 4. If neither has data, return default context
   */
  private async loadThreadContext(threadId: string, channelId: string): Promise<ThreadContext> {
    let redisState: ThreadState | null = null;
    let postgresThread: ThreadContext;

    // Try to get live state from Redis
    try {
      redisState = await this.redisStore.getThreadState(threadId);
    } catch {
      // Redis unavailable, continue with Postgres only
      redisState = null;
    }

    // Load from Postgres (source of truth for full thread data)
    try {
      postgresThread = await this.postgresStore.getThread(threadId);
    } catch {
      // On error, return default context
      return createDefaultThreadContext(threadId, channelId);
    }

    // If Postgres returned default (empty channelId), set it from context
    if (!postgresThread.channelId) {
      postgresThread.channelId = channelId;
    }

    // If Redis has live state, use it (more current than Postgres)
    if (redisState !== null) {
      postgresThread.state = redisState;
    }

    return postgresThread;
  }
}

/**
 * Creates a new ContextLoader instance
 * 
 * @param redisStore - Redis store for live state
 * @param postgresStore - Postgres store for structured data
 */
export function createContextLoader(
  redisStore: RedisStore,
  postgresStore: PostgresStore
): ContextLoader {
  return new DefaultContextLoader(redisStore, postgresStore);
}
