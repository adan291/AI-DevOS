/**
 * Debate Manager
 * Manages multi-agent debates between Architect and Reviewer
 * Requirements: 10.3, 10.4
 */

import type { Agent, AgentRole, AgentResult } from '../types/agents.js';
import type { FullContext } from '../types/orchestrator.js';

/** Debate configuration */
export interface DebateConfig {
  /** Maximum number of turns (default: 4) */
  maxTurns: number;
  /** Agents participating in the debate */
  participants: AgentRole[];
}

/** Debate turn */
export interface DebateTurn {
  turn: number;
  agent: AgentRole;
  argument: string;
  timestamp: number;
}

/** Debate result */
export interface DebateResult {
  turns: DebateTurn[];
  consensus: boolean;
  summary: string;
  recommendation?: string;
}

/** Default max turns for debate */
export const DEBATE_MAX_TURNS = 4;

/** Debate Manager interface */
export interface DebateManager {
  /** Start a debate between agents */
  startDebate(
    topic: string,
    context: string,
    agents: Map<AgentRole, Agent>
  ): Promise<DebateResult>;
}

/** Default implementation of DebateManager */
export class DefaultDebateManager implements DebateManager {
  private readonly maxTurns: number;
  private readonly participants: AgentRole[];

  constructor(config?: Partial<DebateConfig>) {
    this.maxTurns = config?.maxTurns ?? DEBATE_MAX_TURNS;
    this.participants = config?.participants ?? ['architect', 'reviewer'];
  }

  async startDebate(
    topic: string,
    context: string,
    agents: Map<AgentRole, Agent>
  ): Promise<DebateResult> {
    const turns: DebateTurn[] = [];
    let currentTurn = 0;
    let previousArguments = '';

    // Alternate between participants
    while (currentTurn < this.maxTurns) {
      const participantIndex = currentTurn % this.participants.length;
      const currentAgent = this.participants[participantIndex];
      const agent = agents.get(currentAgent);

      if (!agent) {
        throw new Error(`Agent not found for role: ${currentAgent}`);
      }

      // Build prompt for this turn
      const taskDescription = this.buildTurnPrompt(
        topic,
        context,
        currentAgent,
        previousArguments,
        currentTurn
      );

      // Create minimal FullContext for the agent
      const fullContext: FullContext = {
        org: { guildId: '', standards: [], architecture: [] },
        project: { channelId: '', guildId: '', name: '', stack: [], rules: [] },
        thread: { threadId: '', channelId: '', type: 'task', summary: '', state: 'open', decisions: [], artifacts: [], messageCount: 0, lastSummaryAt: 0 },
        memories: [],
        currentMessage: taskDescription,
      };

      // Execute agent
      const result = await agent.execute(fullContext, taskDescription);

      // Record turn (use output, content is alias)
      const turn: DebateTurn = {
        turn: currentTurn + 1,
        agent: currentAgent,
        argument: result.output,
        timestamp: Date.now(),
      };
      turns.push(turn);

      // Check for consensus
      if (this.detectConsensus(result.output)) {
        return {
          turns,
          consensus: true,
          summary: this.generateConsensusSummary(turns),
          recommendation: this.extractRecommendation(result.output),
        };
      }

      // Update previous arguments for next turn
      previousArguments += `\n\n[${currentAgent.toUpperCase()} - Turn ${currentTurn + 1}]:\n${result.output}`;
      currentTurn++;
    }

    // No consensus reached - generate summary of positions
    return {
      turns,
      consensus: false,
      summary: this.generateNoConsensusSummary(turns, topic),
    };
  }

  private buildTurnPrompt(
    topic: string,
    context: string,
    agent: AgentRole,
    previousArguments: string,
    turn: number
  ): string {
    const isFirstTurn = turn === 0;
    const turnsRemaining = this.maxTurns - turn - 1;

    if (isFirstTurn) {
      return `
DEBATE TOPIC: ${topic}

CONTEXT:
${context}

You are the ${agent.toUpperCase()} in a multi-agent debate.
Please present your initial position on this topic.

Consider:
- Technical feasibility
- Best practices
- Potential risks
- Alternative approaches

Be clear and concise. You have ${turnsRemaining} more turns after this to reach consensus.
      `.trim();
    }

    return `
DEBATE TOPIC: ${topic}

CONTEXT:
${context}

PREVIOUS ARGUMENTS:
${previousArguments}

You are the ${agent.toUpperCase()}. This is turn ${turn + 1} of ${this.maxTurns}.

Please respond to the previous arguments:
- Address specific points raised
- Provide counter-arguments or agreements
- Work towards consensus if possible

If you agree with the other party, clearly state "CONSENSUS REACHED" and summarize the agreed approach.

Turns remaining: ${turnsRemaining}
    `.trim();
  }

  private detectConsensus(content: string): boolean {
    const consensusPatterns = [
      /consensus\s+reached/i,
      /we\s+agree/i,
      /agreed\s+approach/i,
      /common\s+ground/i,
      /mutual\s+agreement/i,
    ];

    return consensusPatterns.some(pattern => pattern.test(content));
  }

  private generateConsensusSummary(turns: DebateTurn[]): string {
    const lastTurn = turns[turns.length - 1];
    const participants = [...new Set(turns.map(t => t.agent))];

    return `
Debate concluded with consensus after ${turns.length} turns.
Participants: ${participants.join(', ')}

Final position from ${lastTurn.agent}:
${lastTurn.argument.slice(0, 500)}${lastTurn.argument.length > 500 ? '...' : ''}
    `.trim();
  }

  private generateNoConsensusSummary(turns: DebateTurn[], topic: string): string {
    const positions = new Map<AgentRole, string[]>();

    for (const turn of turns) {
      if (!positions.has(turn.agent)) {
        positions.set(turn.agent, []);
      }
      positions.get(turn.agent)!.push(turn.argument);
    }

    let summary = `
Debate on "${topic}" concluded without consensus after ${turns.length} turns.

POSITIONS SUMMARY:
`;

    for (const [agent, arguments_] of positions) {
      const lastArgument = arguments_[arguments_.length - 1] ?? '';
      summary += `
[${agent.toUpperCase()}]:
${lastArgument.slice(0, 300)}${lastArgument.length > 300 ? '...' : ''}
`;
    }

    summary += `
USER ACTION REQUIRED:
Please review the positions above and make a decision on how to proceed.
`;

    return summary.trim();
  }

  private extractRecommendation(content: string): string | undefined {
    // Try to extract recommendation from consensus content
    const recommendationPatterns = [
      /recommend(?:ation)?[:\s]+(.+?)(?:\.|$)/i,
      /approach[:\s]+(.+?)(?:\.|$)/i,
      /solution[:\s]+(.+?)(?:\.|$)/i,
    ];

    for (const pattern of recommendationPatterns) {
      const match = content.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return undefined;
  }
}

/** Factory function */
export function createDebateManager(config?: Partial<DebateConfig>): DebateManager {
  return new DefaultDebateManager(config);
}
