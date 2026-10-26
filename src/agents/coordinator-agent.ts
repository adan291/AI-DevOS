/**
 * Coordinator Agent
 * 
 * Central decision-maker that determines which agents should act and in what sequence.
 * Returns an ExecutionPlan instead of regular output.
 * 
 * Routing Logic:
 * - New thread → [architect, planner]
 * - Implementation required → developer
 * - Existing code → [reviewer, qa]
 * - Approved code → devops
 * 
 * @validates Requirements 4.2, 4.3, 4.4, 4.5
 */

import { BaseAgent } from './base-agent.js';
import { registerAgent } from './agent-factory.js';
import { COORDINATOR_SYSTEM_PROMPT } from './prompts/coordinator.js';
import type { AgentRole, AgentResult, ExecutionPlan } from '../types/agents.js';
import type { FullContext } from '../types/orchestrator.js';

/**
 * Coordinator Agent - decides which agents should act and in what order.
 */
export class CoordinatorAgent extends BaseAgent {
  readonly role: AgentRole = 'coordinator';
  
  /**
   * Execute the coordinator and return an ExecutionPlan.
   */
  async execute(context: FullContext, taskDescription: string): Promise<AgentResult> {
    // Classify on the user's task, not the full prompt with context
    this.currentTaskDescription = taskDescription;
    const prompt = this.buildPrompt(context, taskDescription);
    
    try {
      const output = await this.executeWithRetry(prompt);
      const plan = this.parseExecutionPlan(output);
      
      return {
        role: this.role,
        output: output,
        structured: plan as unknown as Record<string, unknown>,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }
  
  /**
   * Get the execution plan from the last successful execution.
   * Parses the structured output into an ExecutionPlan.
   */
  getExecutionPlan(result: AgentResult): ExecutionPlan | null {
    if (!result.success || !result.structured) {
      return null;
    }
    
    const structured = result.structured as { 
      agents?: AgentRole[]; 
      reason?: string;
      createProject?: boolean;
      projectName?: string;
    };
    if (!structured.agents || !Array.isArray(structured.agents)) {
      return null;
    }
    
    return {
      agents: structured.agents,
      reason: structured.reason ?? 'No reason provided',
      createProject: structured.createProject,
      projectName: structured.projectName,
    };
  }
  
  /**
   * Build the prompt for the coordinator.
   */
  protected buildPrompt(context: FullContext, taskDescription: string): string {
    const contextSummary = this.buildContextSummary(context);
    
    // Detect if this looks like a new project request
    const lowerTask = taskDescription.toLowerCase();
    const isNewProject = 
      lowerTask.includes('crear proyecto') ||
      lowerTask.includes('nuevo proyecto') ||
      lowerTask.includes('quiero crear') ||
      lowerTask.includes('quiero hacer') ||
      lowerTask.includes('vamos a crear') ||
      lowerTask.includes('desarrollar') ||
      lowerTask.includes('construir') ||
      (lowerTask.includes('crear') && (
        lowerTask.includes('aplicación') ||
        lowerTask.includes('app') ||
        lowerTask.includes('sistema') ||
        lowerTask.includes('plataforma') ||
        lowerTask.includes('gestor') ||
        lowerTask.includes('bot')
      ));
    
    const projectHint = isNewProject 
      ? `\n\n## IMPORTANTE: Nuevo Proyecto Detectado
El usuario quiere crear algo nuevo. DEBES incluir:
- "createProject": true
- "projectName": "nombre-en-minusculas-con-guiones"

Extrae el nombre del proyecto de la tarea del usuario.`
      : '';
    
    return `## Contexto Actual

${contextSummary}

## Tarea
${taskDescription}${projectHint}

## Instrucciones
Analiza el contexto y la tarea, luego devuelve un plan de ejecución en formato JSON.

IMPORTANTE: Si el usuario quiere crear algo nuevo, SIEMPRE incluye "createProject": true y "projectName".

Responde SOLO con el JSON, sin texto adicional.`;
  }
  
  /**
   * Build a summary of the current context for the prompt.
   */
  private buildContextSummary(context: FullContext): string {
    const parts: string[] = [];
    
    // Organization context
    parts.push(`### Organización
- Guild ID: ${context.org.guildId}
- Estándares: ${context.org.standards.length > 0 ? context.org.standards.join(', ') : 'No definidos'}
- Arquitectura: ${context.org.architecture.length > 0 ? context.org.architecture.join(', ') : 'No definida'}`);
    
    // Project context
    parts.push(`### Proyecto
- Canal ID: ${context.project.channelId}
- Nombre: ${context.project.name}
- Stack: ${context.project.stack.length > 0 ? context.project.stack.join(', ') : 'No definido'}
- Reglas: ${context.project.rules.length > 0 ? context.project.rules.join(', ') : 'No definidas'}`);
    
    // Thread context (if available)
    if (context.thread) {
      const thread = context.thread;
      const hasCode = this.threadHasCode(thread);
      const isApproved = this.threadIsApproved(thread);
      
      parts.push(`### Hilo
- Thread ID: ${thread.threadId}
- Tipo: ${thread.type}
- Título: ${thread.title}
- Estado: ${thread.state}
- Resumen: ${thread.summary || 'Sin resumen'}
- Decisiones: ${thread.decisions.length}
- Artefactos: ${thread.artifacts.length}
- Tiene código: ${hasCode ? 'Sí' : 'No'}
- Código aprobado: ${isApproved ? 'Sí' : 'No'}`);
    } else {
      parts.push(`### Hilo
- Sin hilo activo (hilo nuevo)`);
    }
    
    return parts.join('\n\n');
  }
  
  /**
   * Check if the thread has code artifacts.
   */
  private threadHasCode(thread: NonNullable<FullContext['thread']>): boolean {
    return thread.artifacts.some(artifact => artifact.type === 'code');
  }
  
  /**
   * Check if the thread's code has been approved.
   */
  private threadIsApproved(thread: NonNullable<FullContext['thread']>): boolean {
    // Check if there's a review artifact with approval
    const hasReviewApproval = thread.artifacts.some(
      artifact => artifact.type === 'review' && 
        artifact.content.toLowerCase().includes('approve')
    );
    
    // Also check decisions for approval
    const hasApprovalDecision = thread.decisions.some(
      decision => decision.description.toLowerCase().includes('aprobado') ||
        decision.description.toLowerCase().includes('approved')
    );
    
    return hasReviewApproval || hasApprovalDecision;
  }
  
  /**
   * Parse the LLM output into an ExecutionPlan.
   */
  private parseExecutionPlan(output: string): ExecutionPlan {
    // Try to extract JSON from the output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Fallback: determine plan based on heuristics from output
      return this.createFallbackPlan(output);
    }
    
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { 
        agents?: unknown; 
        reason?: string;
        createProject?: boolean;
        projectName?: string;
      };
      
      // Validate the parsed plan
      if (!parsed.agents || !Array.isArray(parsed.agents)) {
        return this.createFallbackPlan(output);
      }
      
      // Filter to only valid agent roles
      const validRoles: AgentRole[] = [
        'architect', 'planner', 'developer', 'reviewer', 'qa', 'devops', 'memory'
      ];
      
      const agents = parsed.agents.filter(
        (agent): agent is AgentRole => 
          typeof agent === 'string' && validRoles.includes(agent as AgentRole)
      );
      
      if (agents.length === 0) {
        return this.createFallbackPlan(output);
      }
      
      return {
        agents,
        reason: parsed.reason ?? 'Plan parsed from LLM response',
        createProject: parsed.createProject ?? false,
        projectName: parsed.projectName,
      };
    } catch {
      return this.createFallbackPlan(output);
    }
  }
  
  /**
   * Create a fallback plan when JSON parsing fails.
   * Uses keyword detection to determine appropriate agents.
   */
  private createFallbackPlan(output: string): ExecutionPlan {
    const lowerOutput = output.toLowerCase();
    const agents: AgentRole[] = [];
    
    // Detect keywords and assign agents
    if (lowerOutput.includes('architect') || lowerOutput.includes('diseño') || lowerOutput.includes('design')) {
      agents.push('architect');
    }
    if (lowerOutput.includes('planner') || lowerOutput.includes('plan') || lowerOutput.includes('tareas')) {
      agents.push('planner');
    }
    if (lowerOutput.includes('developer') || lowerOutput.includes('código') || lowerOutput.includes('code') || lowerOutput.includes('implement')) {
      agents.push('developer');
    }
    if (lowerOutput.includes('reviewer') || lowerOutput.includes('review') || lowerOutput.includes('revisar')) {
      agents.push('reviewer');
    }
    if (lowerOutput.includes('qa') || lowerOutput.includes('test')) {
      agents.push('qa');
    }
    if (lowerOutput.includes('devops') || lowerOutput.includes('deploy')) {
      agents.push('devops');
    }
    
    // Default to architect + planner if no agents detected
    if (agents.length === 0) {
      agents.push('architect', 'planner');
    }
    
    return {
      agents,
      reason: 'Fallback plan created from keyword detection',
    };
  }
  
  /**
   * Get the system prompt for the coordinator.
   */
  protected getSystemPrompt(): string {
    return COORDINATOR_SYSTEM_PROMPT;
  }
}

// Register the coordinator agent with the factory
registerAgent('coordinator', CoordinatorAgent);

export default CoordinatorAgent;
