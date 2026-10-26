/**
 * Auto-Summary
 * Automatically triggers Memory Agent when message count threshold is reached
 * Requirements: 8.1, 8.2, 8.3
 */

import type { ThreadContext } from '../types/models.js';
import type { PostgresStore, VectorStore } from '../types/persistence.js';
import type { Agent, AgentResult } from '../types/agents.js';
import type { FullContext } from '../types/orchestrator.js';

/** Auto-summary configuration */
export interface AutoSummaryConfig {
  /** Number of messages between summaries (default: 15) */
  threshold: number;
}

/** Auto-summary result */
export interface AutoSummaryResult {
  triggered: boolean;
  summary?: string;
  decisionsCount?: number;
  issuesCount?: number;
}

/** Default threshold for auto-summary */
export const AUTO_SUMMARY_THRESHOLD = 15;

/**
 * Checks if auto-summary should be triggered
 */
export function shouldTriggerSummary(
  messageCount: number,
  lastSummaryAt: number,
  threshold: number = AUTO_SUMMARY_THRESHOLD
): boolean {
  return messageCount - lastSummaryAt >= threshold;
}

/** Auto-Summary Handler interface */
export interface AutoSummaryHandler {
  /** Check and trigger summary if needed */
  checkAndTrigger(
    thread: ThreadContext,
    memoryAgent: Agent,
    postgresStore: PostgresStore,
    vectorStore: VectorStore
  ): Promise<AutoSummaryResult>;
}

/** Default implementation of AutoSummaryHandler */
export class DefaultAutoSummaryHandler implements AutoSummaryHandler {
  private readonly threshold: number;

  constructor(config?: Partial<AutoSummaryConfig>) {
    this.threshold = config?.threshold ?? AUTO_SUMMARY_THRESHOLD;
  }

  async checkAndTrigger(
    thread: ThreadContext,
    memoryAgent: Agent,
    postgresStore: PostgresStore,
    vectorStore: VectorStore
  ): Promise<AutoSummaryResult> {
    // Check if summary should be triggered
    if (!shouldTriggerSummary(thread.messageCount, thread.lastSummaryAt, this.threshold)) {
      return { triggered: false };
    }

    // Build context for Memory Agent
    const taskDescription = this.buildSummaryContext(thread);
    
    // Create minimal FullContext for the agent
    const fullContext: FullContext = {
      org: { guildId: '', standards: [], architecture: [] },
      project: { channelId: thread.channelId, guildId: '', name: '', stack: [], rules: [] },
      thread,
      memories: [],
      currentMessage: taskDescription,
    };

    // Execute Memory Agent
    const result = await memoryAgent.execute(fullContext, taskDescription);

    // Parse and persist summary
    const parsedSummary = this.parseSummaryResult(result);

    // Persist to PostgreSQL
    await postgresStore.upsertThread(thread.threadId, {
      channelId: thread.channelId,
      type: thread.type,
      state: thread.state,
      summary: parsedSummary.summary,
      messageCount: thread.messageCount,
      lastSummaryAt: thread.messageCount, // Update lastSummaryAt to current count
    });

    // Store in VectorStore for semantic search
    if (parsedSummary.summary) {
      await vectorStore.store(
        `summary-${thread.threadId}-${Date.now()}`,
        parsedSummary.summary,
        {
          threadId: thread.threadId,
          type: 'summary',
          timestamp: Date.now(),
        }
      );
    }

    return {
      triggered: true,
      summary: parsedSummary.summary,
      decisionsCount: parsedSummary.decisionsCount,
      issuesCount: parsedSummary.issuesCount,
    };
  }

  private buildSummaryContext(thread: ThreadContext): string {
    const decisions = thread.decisions
      .map(d => `- ${d.description} (${d.status})`)
      .join('\n');

    const artifacts = thread.artifacts
      .map(a => `- ${a.type}: ${a.id}`)
      .join('\n');

    return `
Thread: ${thread.threadId}
Type: ${thread.type}
State: ${thread.state}
Messages: ${thread.messageCount}

Current Summary:
${thread.summary || 'No previous summary'}

Decisions:
${decisions || 'No decisions recorded'}

Artifacts:
${artifacts || 'No artifacts'}

Please generate an updated summary including:
1. Key decisions made
2. Current state of work
3. Open issues or blockers
    `.trim();
  }

  private parseSummaryResult(result: AgentResult): {
    summary: string;
    decisionsCount: number;
    issuesCount: number;
  } {
    // Extract summary from agent result (use output, content is alias)
    const content = result.output;
    
    // Count decisions (lines starting with "Decision:" or similar patterns)
    const decisionMatches = content.match(/decision[s]?:/gi) || [];
    const decisionsCount = decisionMatches.length;

    // Count issues (lines starting with "Issue:" or "Blocker:" or similar)
    const issueMatches = content.match(/(issue|blocker|problem)[s]?:/gi) || [];
    const issuesCount = issueMatches.length;

    return {
      summary: content,
      decisionsCount,
      issuesCount,
    };
  }
}

/** Factory function */
export function createAutoSummaryHandler(config?: Partial<AutoSummaryConfig>): AutoSummaryHandler {
  return new DefaultAutoSummaryHandler(config);
}
