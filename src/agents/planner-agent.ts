/**
 * Planner Agent
 * 
 * Decomposes features into ordered tasks with dependencies and complexity.
 * 
 * Output Format:
 * - Tasks: Ordered list of atomic tasks with complexity
 * - Dependencies: DAG of task dependencies
 * - Edge Cases: Special cases to consider
 * - Complexity: Total estimation and critical path
 * 
 * @validates Requirements 4.7
 */

import { BaseAgent } from './base-agent.js';
import { registerAgent } from './agent-factory.js';
import { PLANNER_SYSTEM_PROMPT } from './prompts/planner.js';
import type { AgentRole, AgentResult } from '../types/agents.js';
import type { FullContext } from '../types/orchestrator.js';

/** Structured output from Planner Agent */
export interface PlannerOutput {
  tasks: TaskDefinition[];
  dependencies: TaskDependency[];
  edgeCases: string[];
  complexity: ComplexityEstimate;
}

/** Task definition in the plan */
export interface TaskDefinition {
  id: number;
  name: string;
  description: string;
  complexity: 'trivial' | 'simple' | 'media' | 'compleja' | 'muy compleja';
}

/** Dependency between tasks */
export interface TaskDependency {
  taskId: number;
  dependsOn: number[];
}

/** Complexity estimation */
export interface ComplexityEstimate {
  totalTasks: number;
  estimatedDays: string;
  criticalPath: number[];
  risks: string[];
}

/**
 * Planner Agent - decomposes features into executable tasks.
 */
export class PlannerAgent extends BaseAgent {
  readonly role: AgentRole = 'planner';
  
  /**
   * Execute the planner agent and return task plan.
   */
  async execute(context: FullContext, taskDescription: string): Promise<AgentResult> {
    // Classify on the user's task, not the full prompt with context
    this.currentTaskDescription = taskDescription;
    const prompt = this.buildPrompt(context, taskDescription);
    
    try {
      const output = await this.executeWithRetry(prompt);
      const structured = this.parsePlannerOutput(output);
      
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
   * Get the structured planner output from the last successful execution.
   */
  getPlannerOutput(result: AgentResult): PlannerOutput | null {
    if (!result.success || !result.structured) {
      return null;
    }
    return result.structured as unknown as PlannerOutput;
  }
  
  /**
   * Build the prompt for the planner.
   */
  protected buildPrompt(context: FullContext, taskDescription: string): string {
    const contextSummary = this.buildContextSummary(context);
    
    return `## Contexto Actual

${contextSummary}

## Tarea
${taskDescription}

## Instrucciones
Analiza el contexto y la tarea, luego produce un plan de implementación detallado con las 4 secciones obligatorias:
1. Tareas (ordenadas y atómicas)
2. Dependencias (DAG válido sin ciclos)
3. Edge Cases
4. Complejidad Total

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
      parts.push(`### Hilo
- Thread ID: ${context.thread.threadId}
- Tipo: ${context.thread.type}
- Título: ${context.thread.title}
- Estado: ${context.thread.state}
- Resumen: ${context.thread.summary || 'Sin resumen'}
- Artefactos: ${context.thread.artifacts.length > 0 
    ? context.thread.artifacts.map(a => `${a.type} (por ${a.agentRole})`).join(', ') 
    : 'Ninguno'}`);
    } else {
      parts.push(`### Hilo
- Sin hilo activo`);
    }
    
    return parts.join('\n\n');
  }
  
  /**
   * Parse the LLM output into structured PlannerOutput.
   */
  private parsePlannerOutput(output: string): PlannerOutput {
    const result: PlannerOutput = {
      tasks: [],
      dependencies: [],
      edgeCases: [],
      complexity: {
        totalTasks: 0,
        estimatedDays: 'No estimado',
        criticalPath: [],
        risks: [],
      },
    };
    
    // Extract Tasks section
    const tasksMatch = output.match(/###?\s*Tareas\s*\n([\s\S]*?)(?=###?\s*Dependencias|$)/i);
    if (tasksMatch) {
      result.tasks = this.parseTasksTable(tasksMatch[1]);
    }
    
    // Extract Dependencies section
    const depsMatch = output.match(/###?\s*Dependencias\s*\n([\s\S]*?)(?=###?\s*Edge Cases|$)/i);
    if (depsMatch) {
      result.dependencies = this.parseDependenciesTable(depsMatch[1]);
    }
    
    // Extract Edge Cases section
    const edgeCasesMatch = output.match(/###?\s*Edge Cases\s*\n([\s\S]*?)(?=###?\s*Complejidad|$)/i);
    if (edgeCasesMatch) {
      result.edgeCases = this.parseEdgeCases(edgeCasesMatch[1]);
    }
    
    // Extract Complexity section
    const complexityMatch = output.match(/###?\s*Complejidad(?:\s+Total)?\s*\n([\s\S]*?)$/i);
    if (complexityMatch) {
      result.complexity = this.parseComplexity(complexityMatch[1], result.tasks.length);
    }
    
    result.complexity.totalTasks = result.tasks.length;
    
    return result;
  }
  
  /**
   * Parse tasks table from markdown.
   */
  private parseTasksTable(content: string): TaskDefinition[] {
    const tasks: TaskDefinition[] = [];
    const lines = content.split('\n').filter(line => line.includes('|'));
    
    for (const line of lines) {
      // Skip header and separator lines
      if (line.includes('Tarea') || line.includes('---') || line.includes('#')) continue;
      
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 3) {
        const id = parseInt(cells[0], 10);
        if (!isNaN(id)) {
          const complexity = cells[3]?.toLowerCase() as TaskDefinition['complexity'];
          tasks.push({
            id,
            name: cells[1],
            description: cells[2],
            complexity: ['trivial', 'simple', 'media', 'compleja', 'muy compleja'].includes(complexity) 
              ? complexity 
              : 'media',
          });
        }
      }
    }
    
    return tasks;
  }
  
  /**
   * Parse dependencies table from markdown.
   */
  private parseDependenciesTable(content: string): TaskDependency[] {
    const dependencies: TaskDependency[] = [];
    const lines = content.split('\n').filter(line => line.includes('|'));
    
    for (const line of lines) {
      // Skip header and separator lines
      if (line.includes('Tarea') || line.includes('Depende') || line.includes('---')) continue;
      
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 2) {
        const taskId = parseInt(cells[0], 10);
        if (!isNaN(taskId)) {
          const dependsOn = cells[1]
            .split(/[,\s]+/)
            .map(d => parseInt(d.trim(), 10))
            .filter(d => !isNaN(d));
          
          dependencies.push({ taskId, dependsOn });
        }
      }
    }
    
    return dependencies;
  }
  
  /**
   * Parse edge cases list from markdown.
   */
  private parseEdgeCases(content: string): string[] {
    const edgeCases: string[] = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      // Match checkbox items or bullet points
      const match = line.match(/[-*\[\]x]\s*(.+)/i);
      if (match) {
        edgeCases.push(match[1].trim());
      }
    }
    
    return edgeCases;
  }
  
  /**
   * Parse complexity estimation from markdown.
   */
  private parseComplexity(content: string, totalTasks: number): ComplexityEstimate {
    const result: ComplexityEstimate = {
      totalTasks,
      estimatedDays: 'No estimado',
      criticalPath: [],
      risks: [],
    };
    
    // Extract estimation
    const estimationMatch = content.match(/Estimación[:\s]*([^\n]+)/i);
    if (estimationMatch) {
      result.estimatedDays = estimationMatch[1].trim();
    }
    
    // Extract critical path
    const criticalPathMatch = content.match(/Ruta crítica[:\s]*([^\n]+)/i);
    if (criticalPathMatch) {
      result.criticalPath = criticalPathMatch[1]
        .split(/[→\->]+/)
        .map(t => parseInt(t.replace(/\D/g, ''), 10))
        .filter(t => !isNaN(t));
    }
    
    // Extract risks
    const risksMatch = content.match(/Riesgos[:\s]*([^\n]+)/i);
    if (risksMatch) {
      result.risks = [risksMatch[1].trim()];
    }
    
    return result;
  }
  
  /**
   * Get the system prompt for the planner.
   */
  protected getSystemPrompt(): string {
    return PLANNER_SYSTEM_PROMPT;
  }
}

// Register the planner agent with the factory
registerAgent('planner', PlannerAgent);

export default PlannerAgent;
