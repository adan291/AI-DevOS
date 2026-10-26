/**
 * PostgreSQL Schema with Drizzle ORM
 * Defines tables: organizations, projects, threads, memories, embeddings (pgvector)
 * Requirements: 5.1, 5.6, 5.7
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  integer,
  uuid,
  index,
  check,
  customType,
  boolean,
  real,
  serial,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// Custom type for pgvector (1536 dimensions for OpenAI embeddings)
const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // Parse "[1,2,3]" format from postgres
    return value
      .slice(1, -1)
      .split(',')
      .map((v) => parseFloat(v));
  },
});

// Custom type for pgvector (384 dimensions for simple/local embeddings)
const vector384 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(384)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(',')
      .map((v) => parseFloat(v));
  },
});

// Alias for backward compatibility
const vector = vector1536;

// ============================================================================
// Organizations (1 per Discord server)
// ============================================================================
export const organizations = pgTable('organizations', {
  guildId: text('guild_id').primaryKey(),
  standards: jsonb('standards').notNull().default([]),
  architecture: jsonb('architecture').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================================
// Projects (1 per Discord channel)
// ============================================================================
export const projects = pgTable(
  'projects',
  {
    channelId: text('channel_id').primaryKey(),
    guildId: text('guild_id')
      .notNull()
      .references(() => organizations.guildId),
    name: text('name').notNull(),
    stack: text('stack').array().notNull().default(sql`'{}'::text[]`),
    rules: jsonb('rules').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }
);

// ============================================================================
// Threads (1 per Discord thread)
// ============================================================================
export const threads = pgTable(
  'threads',
  {
    threadId: text('thread_id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => projects.channelId),
    type: text('type').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    state: text('state').notNull().default('open'),
    decisions: jsonb('decisions').notNull().default([]),
    artifacts: jsonb('artifacts').notNull().default([]),
    messageCount: integer('message_count').notNull().default(0),
    lastSummaryAt: integer('last_summary_at').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_threads_channel').on(table.channelId),
    check('threads_type_check', sql`${table.type} IN ('feature', 'bug', 'pr', 'task')`),
    check('threads_state_check', sql`${table.state} IN ('open', 'in_progress', 'review', 'done')`),
  ]
);

// ============================================================================
// Memories (persistent knowledge)
// ============================================================================
export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.threadId),
    type: text('type').notNull(),
    content: jsonb('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_memories_thread').on(table.threadId),
    check('memories_type_check', sql`${table.type} IN ('decision', 'pattern', 'error', 'summary')`),
  ]
);

// ============================================================================
// Embeddings (pgvector for semantic context)
// ============================================================================
export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memoryId: uuid('memory_id').references(() => memories.id),
    threadId: text('thread_id').notNull(),
    type: text('type').notNull(),
    contentText: text('content_text').notNull(),
    embedding: vector('embedding').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    // Note: ivfflat index must be created via raw SQL migration
    // CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops);
  ]
);

// ============================================================================
// Knowledge (AI Knowledge Hub - code, documents, videos)
// ============================================================================
export const knowledge = pgTable(
  'knowledge',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(), // 'code' | 'document' | 'video' | 'summary'
    subtype: text('subtype'), // 'class' | 'function' | 'interface' | 'markdown' | etc.
    name: text('name').notNull(),
    content: text('content').notNull(),
    summary: text('summary'),
    embedding: vector384('embedding'), // 384 dimensions for simple embeddings
    metadata: jsonb('metadata').notNull().default({}),
    filePath: text('file_path'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_knowledge_type').on(table.type),
    index('idx_knowledge_subtype').on(table.subtype),
    index('idx_knowledge_name').on(table.name),
    index('idx_knowledge_file_path').on(table.filePath),
    // Note: ivfflat index for vector search must be created via raw SQL migration
    // CREATE INDEX idx_knowledge_embedding ON knowledge USING ivfflat (embedding vector_cosine_ops);
  ]
);

// ============================================================================
// Model Usage Metrics (Model Router tracking)
// ============================================================================
export const modelUsageMetrics = pgTable(
  'model_usage_metrics',
  {
    id: serial('id').primaryKey(),
    provider: text('provider').notNull(), // 'groq' | 'anthropic' | 'openai'
    model: text('model').notNull(),
    complexity: text('complexity').notNull(), // 'simple' | 'medium' | 'complex'
    agentRole: text('agent_role'),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    estimatedCost: real('estimated_cost').notNull(),
    success: boolean('success').notNull(),
    error: text('error'),
    fallbackUsed: boolean('fallback_used').notNull().default(false),
    fallbackChain: jsonb('fallback_chain'), // JSON array of attempted model selections
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_metrics_provider').on(table.provider),
    index('idx_metrics_model').on(table.model),
    index('idx_metrics_complexity').on(table.complexity),
    index('idx_metrics_agent_role').on(table.agentRole),
    index('idx_metrics_created_at').on(table.createdAt),
    index('idx_metrics_success').on(table.success),
  ]
);

// ============================================================================
// Relations
// ============================================================================
export const organizationsRelations = relations(organizations, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.guildId],
    references: [organizations.guildId],
  }),
  threads: many(threads),
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  project: one(projects, {
    fields: [threads.channelId],
    references: [projects.channelId],
  }),
  memories: many(memories),
}));

export const memoriesRelations = relations(memories, ({ one, many }) => ({
  thread: one(threads, {
    fields: [memories.threadId],
    references: [threads.threadId],
  }),
  embeddings: many(embeddings),
}));

export const embeddingsRelations = relations(embeddings, ({ one }) => ({
  memory: one(memories, {
    fields: [embeddings.memoryId],
    references: [memories.id],
  }),
}));

// ============================================================================
// Type exports for use in application code
// ============================================================================
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;

export type Embedding = typeof embeddings.$inferSelect;
export type NewEmbedding = typeof embeddings.$inferInsert;

export type Knowledge = typeof knowledge.$inferSelect;
export type NewKnowledge = typeof knowledge.$inferInsert;

export type ModelUsageMetric = typeof modelUsageMetrics.$inferSelect;
export type NewModelUsageMetric = typeof modelUsageMetrics.$inferInsert;
