-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid,
	"thread_id" text NOT NULL,
	"type" text NOT NULL,
	"content_text" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" text NOT NULL,
	"type" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_type_check" CHECK ("memories"."type" IN ('decision', 'pattern', 'error', 'summary'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"standards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"architecture" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"stack" text[] DEFAULT '{}'::text[] NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_summary_at" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threads_type_check" CHECK ("threads"."type" IN ('feature', 'bug', 'pr', 'task')),
	CONSTRAINT "threads_state_check" CHECK ("threads"."state" IN ('open', 'in_progress', 'review', 'done'))
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_thread_id_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("thread_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_guild_id_organizations_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."organizations"("guild_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_channel_id_projects_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."projects"("channel_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_memories_thread" ON "memories" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_threads_channel" ON "threads" USING btree ("channel_id");--> statement-breakpoint
-- ivfflat index for vector similarity search (requires pgvector extension)
CREATE INDEX "idx_embeddings_vector" ON "embeddings" USING ivfflat ("embedding" vector_cosine_ops);