/**
 * Reviewer Agent
 * 
 * Reviews code for bugs, security, performance and maintainability.
 * 
 * Output Format:
 * - Issues Found: Table with severity, category, description, line
 * - Severity: Explanation of severity levels
 * - Fix Suggestions: Code fixes for each issue
 * - Verdict: APPROVE or REJECT with justification
 * 
 * @validates Requirements 4.9
 */

import { BaseAgent } from './base-agent.js';
import { registerAgent } from './agent-factory.js';
import { REVIEWER_SYSTEM_PROMPT } from './prompts/reviewer.js';
import type { AgentRole, AgentResult } from '../types/agents.js';
import type { FullContext } from '../types/orchestrator.js';

/** Structured output from Reviewer Agent */
export interface ReviewerOutput {
  issues: ReviewIssue[];
  suggestions: FixSuggestion[];
  verdict: ReviewVerdict;
}

/** Review issue found in code */
export interface ReviewIssue {
  id: number;
  severity: 'Alta' | 'Media' | 'Baja';
  category: string;
  description: string;
  line?: string;
}

/** Fix suggestion for an issue */
export interface FixSuggestion {
  issueId: number;
  title: string;
  before: string;
  after: string;
}

/** Review verdict */
export interface ReviewVerdict {
  decision: 'APPROVE' | 'REJECT';
  reason: string;
  conditions?: string[];
}

/**
 * Reviewer Agent - reviews code for quality issues.
 */
export class ReviewerAgent extends BaseAgent {
  readonly role: AgentRole = 'reviewer';
  
  /**
   * Execute the reviewer agent and return code review.
   */
  async execute(context: FullContext, taskDescription: string): Promise<AgentResult> {
    // Classify on the user's task, not the full prompt with context
    this.currentTaskDescription = taskDescription;
    const prompt = this.buildPrompt(context, taskDescription);
    
    try {
      const output = await this.executeWithRetry(prompt);
      const structured = this.parseReviewerOutput(output);
      
      return {
        role: this.role,
        output: output,
        structured: structured as unknown as Record<string, unknown>,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get the structured reviewer output from the last successful execution.
   */
  getReviewerOutput(result: AgentResult): ReviewerOutput | null {
    if (!result.success || !result.structured) {
      return null;
    }
    return result.structured as unknown as ReviewerOutput;
  }
  
  /**
   * Check if the review verdict is approval.
   */
  isApproved(result: AgentResult): boolean {
    const output = this.getReviewerOutput(result);
    return output?.verdict.decision === 'APPROVE';
  }
  
  /**
   * Build the prompt for the reviewer.
   */
  protected buildPrompt(context: FullContext, taskDescription: string): string {
    const contextSummary = this.buildContextSummary(context);
    
    return `## Contexto Actual

${contextSummary}

## Tarea
${taskDescription}

## Instrucciones
Revisa el código en busca de bugs, vulnerabilidades de seguridad, problemas de rendimiento y mantenibilidad.
Incluye las 4 secciones obligatorias:
1. Issues Encontrados (con severidad)
2. Severidad (explicación de niveles)
3. Sugerencias de Fix
4. Veredicto (APPROVE o REJECT)

Responde siguiendo el formato especificado en tu rol.`;
  }
  
  /**
   * Build a summary of the current context for the prompt.
   */
  private buildContextSummary(context: FullContext): string {
    const parts: string[] = [];
    
    parts.push(`### Organización
- Guild ID: ${context.org.guildId}
- Estándares: ${context.org.standards.length > 0 ? context.org.standards.join(', ') : 'No definidos'}
- Arquitectura: ${context.org.architecture.length > 0 ? context.org.architecture.join(', ') : 'No definida'}`);
    
    parts.push(`### Proyecto
- Canal ID: ${context.project.channelId}
- Nombre: ${context.project.name}
- Stack: ${context.project.stack.length > 0 ? context.project.stack.join(', ') : 'No definido'}
- Reglas: ${context.project.rules.length > 0 ? context.project.rules.join(', ') : 'No definidas'}`);
    
    if (context.thread) {
      const thread = context.thread;
      
      // Include code artifacts for review
      const codeArtifacts = thread.artifacts.filter(a => a.type === 'code');
      
      parts.push(`### Hilo
- Thread ID: ${thread.threadId}
- Tipo: ${thread.type}
- Título: ${thread.title}
- Estado: ${thread.state}
- Resumen: ${thread.summary || 'Sin resumen'}
- Código a revisar: ${codeArtifacts.length > 0 
    ? codeArtifacts.map(a => a.content.substring(0, 500) + '...').join('\n\n') 
    : 'No hay código para revisar'}`);
    } else {
      parts.push(`### Hilo
- Sin hilo activo`);
    }
    
    return parts.join('\n\n');
  }
  
  /**
   * Parse the LLM output into structured ReviewerOutput.
   */
  private parseReviewerOutput(output: string): ReviewerOutput {
    const result: ReviewerOutput = {
      issues: [],
      suggestions: [],
      verdict: {
        decision: 'REJECT',
        reason: 'No se pudo determinar el veredicto',
      },
    };
    
    // Extract Issues section
    const issuesMatch = output.match(/###?\s*Issues(?:\s+Encontrados)?\s*\n([\s\S]*?)(?=###?\s*Severidad|###?\s*Sugerencias|$)/i);
    if (issuesMatch) {
      result.issues = this.parseIssuesTable(issuesMatch[1]);
    }
    
    // Extract Suggestions section
    const suggestionsMatch = output.match(/###?\s*Sugerencias(?:\s+de Fix)?\s*\n([\s\S]*?)(?=###?\s*Veredicto|$)/i);
    if (suggestionsMatch) {
      result.suggestions = this.parseSuggestions(suggestionsMatch[1]);
    }
    
    // Extract Verdict section
    const verdictMatch = output.match(/###?\s*Veredicto\s*\n([\s\S]*?)$/i);
    if (verdictMatch) {
      result.verdict = this.parseVerdict(verdictMatch[1]);
    }
    
    return result;
  }
  
  /**
   * Parse issues table from markdown.
   */
  private parseIssuesTable(content: string): ReviewIssue[] {
    const issues: ReviewIssue[] = [];
    const lines = content.split('\n').filter(line => line.includes('|'));
    
    for (const line of lines) {
      // Skip header and separator lines
      if (line.includes('Severidad') || line.includes('---') || line.includes('#')) continue;
      
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 4) {
        const id = parseInt(cells[0], 10);
        if (!isNaN(id)) {
          // Extract severity from emoji or text
          let severity: ReviewIssue['severity'] = 'Media';
          const severityCell = cells[1].toLowerCase();
          if (severityCell.includes('alta') || severityCell.includes('🔴')) {
            severity = 'Alta';
          } else if (severityCell.includes('baja') || severityCell.includes('🟢')) {
            severity = 'Baja';
          }
          
          issues.push({
            id,
            severity,
            category: cells[2],
            description: cells[3],
            line: cells[4],
          });
        }
      }
    }
    
    return issues;
  }
  
  /**
   * Parse fix suggestions from markdown.
   */
  private parseSuggestions(content: string): FixSuggestion[] {
    const suggestions: FixSuggestion[] = [];
    
    // Match issue headers and code blocks
    const issueRegex = /####?\s*Issue #(\d+):\s*([^\n]+)\n([\s\S]*?)(?=####?\s*Issue|$)/gi;
    
    let match;
    while ((match = issueRegex.exec(content)) !== null) {
      const issueId = parseInt(match[1], 10);
      const title = match[2].trim();
      const codeContent = match[3];
      
      // Extract before and after code blocks
      const beforeMatch = codeContent.match(/\/\/\s*Antes\n```[\w]*\n([\s\S]*?)```/i);
      const afterMatch = codeContent.match(/\/\/\s*Después\n```[\w]*\n([\s\S]*?)```/i);
      
      suggestions.push({
        issueId,
        title,
        before: beforeMatch?.[1]?.trim() || '',
        after: afterMatch?.[1]?.trim() || '',
      });
    }
    
    return suggestions;
  }
  
  /**
   * Parse verdict from markdown.
   */
  private parseVerdict(content: string): ReviewVerdict {
    const result: ReviewVerdict = {
      decision: 'REJECT',
      reason: 'No se pudo determinar el veredicto',
    };
    
    // Check for APPROVE or REJECT
    if (content.includes('APPROVE') || content.includes('✅')) {
      result.decision = 'APPROVE';
    } else if (content.includes('REJECT') || content.includes('❌')) {
      result.decision = 'REJECT';
    }
    
    // Extract reason
    const reasonMatch = content.match(/Razón[:\s]*([^\n]+)/i);
    if (reasonMatch) {
      result.reason = reasonMatch[1].trim();
    }
    
    // Extract conditions (if REJECT)
    if (result.decision === 'REJECT') {
      const conditions: string[] = [];
      const conditionRegex = /\[\s*\]\s*(.+)/g;
      let condMatch;
      while ((condMatch = conditionRegex.exec(content)) !== null) {
        conditions.push(condMatch[1].trim());
      }
      if (conditions.length > 0) {
        result.conditions = conditions;
      }
    }
    
    return result;
  }
  
  /**
   * Get the system prompt for the reviewer.
   */
  protected getSystemPrompt(): string {
    return REVIEWER_SYSTEM_PROMPT;
  }
}

// Register the reviewer agent with the factory
registerAgent('reviewer', ReviewerAgent);

export default ReviewerAgent;
