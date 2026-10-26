/**
 * PostgreSQL Store implementation using Drizzle ORM
 * Implements fail-forward approach: returns default context when records not found
 * Requirements: 5.1, 5.4
 */

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PostgresStore } from '../types/persistence.js';
import type { OrgContext, ProjectContext, ThreadContext, MemoryEntry } from '../types/models.js';
import { organizations, projects, threads, memories } from './schema.js';

type DrizzleDB = PostgresJsDatabase | NodePgDatabase;

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
function createDefaultProjectContext(channelId: string): ProjectContext {
  return {
    channelId,
    guildId: '',
    name: '',
    stack: [],
    rules: [],
  };
}

/**
 * Creates a default ThreadContext with empty values
 */
function createDefaultThreadContext(threadId: string): ThreadContext {
  return {
    threadId,
    channelId: '',
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
 * PostgresStore implementation using Drizzle ORM
 * Follows fail-forward pattern: returns default context when records not found
 */
export function createPostgresStore(db: DrizzleDB): PostgresStore {
  return {
    // ========================================================================
    // Organizations
    // ========================================================================
    async getOrg(guildId: string): Promise<OrgContext> {
      const result = await db
        .select()
        .from(organizations)
        .where(eq(organizations.guildId, guildId))
        .limit(1);

      if (result.length === 0) {
        return createDefaultOrgContext(guildId);
      }

      const org = result[0];
      return {
        guildId: org.guildId,
        standards: (org.standards as string[]) ?? [],
        architecture: (org.architecture as string[]) ?? [],
      };
    },

    async upsertOrg(guildId: string, data: Partial<OrgContext>): Promise<void> {
      const values = {
        guildId,
        ...(data.standards !== undefined && { standards: data.standards }),
        ...(data.architecture !== undefined && { architecture: data.architecture }),
        updatedAt: new Date(),
      };

      await db
        .insert(organizations)
        .values({
          guildId,
          standards: data.standards ?? [],
          architecture: data.architecture ?? [],
        })
        .onConflictDoUpdate({
          target: organizations.guildId,
          set: {
            ...(data.standards !== undefined && { standards: data.standards }),
            ...(data.architecture !== undefined && { architecture: data.architecture }),
            updatedAt: new Date(),
          },
        });
    },

    // ========================================================================
    // Projects
    // ========================================================================
    async getProject(channelId: string): Promise<ProjectContext> {
      const result = await db
        .select()
        .from(projects)
        .where(eq(projects.channelId, channelId))
        .limit(1);

      if (result.length === 0) {
        return createDefaultProjectContext(channelId);
      }

      const project = result[0];
      return {
        channelId: project.channelId,
        guildId: project.guildId,
        name: project.name,
        stack: project.stack ?? [],
        rules: (project.rules as string[]) ?? [],
      };
    },

    async upsertProject(channelId: string, data: Partial<ProjectContext>): Promise<void> {
      // For insert, we need guildId and name at minimum
      const guildId = data.guildId ?? '';
      const name = data.name ?? '';

      await db
        .insert(projects)
        .values({
          channelId,
          guildId,
          name,
          stack: data.stack ?? [],
          rules: data.rules ?? [],
        })
        .onConflictDoUpdate({
          target: projects.channelId,
          set: {
            ...(data.guildId !== undefined && { guildId: data.guildId }),
            ...(data.name !== undefined && { name: data.name }),
            ...(data.stack !== undefined && { stack: data.stack }),
            ...(data.rules !== undefined && { rules: data.rules }),
            updatedAt: new Date(),
          },
        });
    },

    // ========================================================================
    // Threads
    // ========================================================================
    async getThread(threadId: string): Promise<ThreadContext> {
      const result = await db
        .select()
        .from(threads)
        .where(eq(threads.threadId, threadId))
        .limit(1);

      if (result.length === 0) {
        return createDefaultThreadContext(threadId);
      }

      const thread = result[0];
      return {
        threadId: thread.threadId,
        channelId: thread.channelId,
        type: thread.type as ThreadContext['type'],
        title: thread.title,
        summary: thread.summary,
        state: thread.state as ThreadContext['state'],
        decisions: (thread.decisions as ThreadContext['decisions']) ?? [],
        artifacts: (thread.artifacts as ThreadContext['artifacts']) ?? [],
        messageCount: thread.messageCount,
        lastSummaryAt: thread.lastSummaryAt,
      };
    },

    async upsertThread(threadId: string, data: Partial<ThreadContext>): Promise<void> {
      // For insert, we need channelId, type, and title at minimum
      const channelId = data.channelId ?? '';
      const type = data.type ?? 'task';
      const title = data.title ?? '';

      await db
        .insert(threads)
        .values({
          threadId,
          channelId,
          type,
          title,
          summary: data.summary ?? '',
          state: data.state ?? 'open',
          decisions: data.decisions ?? [],
          artifacts: data.artifacts ?? [],
          messageCount: data.messageCount ?? 0,
          lastSummaryAt: data.lastSummaryAt ?? 0,
        })
        .onConflictDoUpdate({
          target: threads.threadId,
          set: {
            ...(data.channelId !== undefined && { channelId: data.channelId }),
            ...(data.type !== undefined && { type: data.type }),
            ...(data.title !== undefined && { title: data.title }),
            ...(data.summary !== undefined && { summary: data.summary }),
            ...(data.state !== undefined && { state: data.state }),
            ...(data.decisions !== undefined && { decisions: data.decisions }),
            ...(data.artifacts !== undefined && { artifacts: data.artifacts }),
            ...(data.messageCount !== undefined && { messageCount: data.messageCount }),
            ...(data.lastSummaryAt !== undefined && { lastSummaryAt: data.lastSummaryAt }),
            updatedAt: new Date(),
          },
        });
    },

    // ========================================================================
    // Memory
    // ========================================================================
    async storeMemory(entry: MemoryEntry): Promise<void> {
      await db.insert(memories).values({
        id: entry.id,
        threadId: entry.threadId,
        type: entry.type,
        content: entry.content,
        createdAt: new Date(entry.timestamp),
      });
    },

    async getMemories(threadId: string): Promise<MemoryEntry[]> {
      const result = await db
        .select()
        .from(memories)
        .where(eq(memories.threadId, threadId));

      return result.map((memory) => ({
        id: memory.id,
        threadId: memory.threadId,
        type: memory.type as MemoryEntry['type'],
        content: memory.content as Record<string, unknown>,
        timestamp: memory.createdAt.getTime(),
      }));
    },
  };
}

export type { PostgresStore };
