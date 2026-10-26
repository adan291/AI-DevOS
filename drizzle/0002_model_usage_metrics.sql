-- Migration: Add model_usage_metrics table for Model Router tracking
-- This table stores usage metrics for LLM model executions including cost, latency, and fallback data

-- Create the model_usage_metrics table
CREATE TABLE IF NOT EXISTS "model_usage_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"complexity" text NOT NULL,
	"agent_role" text,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"estimated_cost" real NOT NULL,
	"success" boolean NOT NULL,
	"error" text,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"fallback_chain" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS "idx_metrics_provider" ON "model_usage_metrics" USING btree ("provider");
CREATE INDEX IF NOT EXISTS "idx_metrics_model" ON "model_usage_metrics" USING btree ("model");
CREATE INDEX IF NOT EXISTS "idx_metrics_complexity" ON "model_usage_metrics" USING btree ("complexity");
CREATE INDEX IF NOT EXISTS "idx_metrics_agent_role" ON "model_usage_metrics" USING btree ("agent_role");
CREATE INDEX IF NOT EXISTS "idx_metrics_created_at" ON "model_usage_metrics" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "idx_metrics_success" ON "model_usage_metrics" USING btree ("success");
