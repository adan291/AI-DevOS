/**
 * Architect Agent
 * 
 * Defines high-level solutions, components, data flow and risks.
 * 
 * Output Format:
 * - Overview: General description of the proposed solution
 * - Components: Table of components with responsibilities and technologies
 * - Data Flow: ASCII diagram or description of data flow
 * - Risks: Table of risks with impact and mitigation
 * 
 * @validates Requirements 4.6
 */

import { BaseAgent } from './base-agent.js';
import { registerAgent } from './agent-factory.js';
import { ARCHITECT_SYSTEM_PROMPT } from './prompts/architect.js';
import type { AgentRole, AgentResult } from '../types/agents.js';
import type { FullContext } from '../types/orchestrator.js';

/** Structured output from Architect Agent */
export interface ArchitectOutput {
  overview: string;
  components: ComponentDefinition[];
  dataFlow: string;
  risks: RiskDefinition[];
}

/** Component definition in architecture */
export interface ComponentDefinition {
  name: string;
  responsibility: string;
  technology: string;
}

/** Risk definition with mitigation */
export interface RiskDefinition {
  description: string;
  impact: 'Alto' | 'Medio' | 'Bajo';
  mitigation: string;
}

/**
 * Architect Agent - defines high-level architecture and design.
 */
export class ArchitectAgent extends BaseAgent {
  readonly role: AgentRole = 'architect';
  
  /**
   * Execute the architect agent and return architecture design.
   */
  async execute(context: FullContext, taskDescription: string): Promise<AgentResult> {
    // Classify on the user's task, not the full prompt with context
    this.currentTaskDescription = taskDescription;
    const prompt = this.buildPrompt(context, taskDescription);
    
    try {
      const output = await this.executeWithRetry(prompt);
      const structured = this.parseArchitectOutput(output);
      
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
   * Get the structured architect output from the last successful execution.
   */
  getArchitectOutput(result: AgentResult): ArchitectOutput | null {
    if (!result.success || !result.structured) {
      return null;
    }
    return result.structured as unknown as ArchitectOutput;
  }
  
  /**
   * Build the prompt for the architect.
   */
  protected buildPrompt(context: FullContext, taskDescription: string): string {
    const contextSummary = this.buildContextSummary(context);
    
    return `## Contexto Actual

${contextSummary}

## Tarea
${taskDescription}

## Instrucciones
Analiza el contexto y la tarea, luego produce un diseño arquitectónico completo con las 4 secciones obligatorias:
1. Overview
2. Componentes
3. Flujo de Datos
4. Riesgos

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
- Resumen: ${context.thread.summary || 'Sin resumen'}`);
    } else {
      parts.push(`### Hilo
- Sin hilo activo`);
    }
    
    return parts.join('\n\n');
  }
  
  /**
   * Parse the LLM output into structured ArchitectOutput.
   */
  private parseArchitectOutput(output: string): ArchitectOutput {
    const result: ArchitectOutput = {
      overview: '',
      components: [],
      dataFlow: '',
      risks: [],
    };
    
    // Extract Overview section
    const overviewMatch = output.match(/###?\s*Overview\s*\n([\s\S]*?)(?=###?\s*Componentes|$)/i);
    if (overviewMatch) {
      result.overview = overviewMatch[1].trim();
    }
    
    // Extract Components section
    const componentsMatch = output.match(/###?\s*Componentes\s*\n([\s\S]*?)(?=###?\s*Flujo|$)/i);
    if (componentsMatch) {
      result.components = this.parseComponentsTable(componentsMatch[1]);
    }
    
    // Extract Data Flow section
    const dataFlowMatch = output.match(/###?\s*Flujo de Datos\s*\n([\s\S]*?)(?=###?\s*Riesgos|$)/i);
    if (dataFlowMatch) {
      result.dataFlow = dataFlowMatch[1].trim();
    }
    
    // Extract Risks section
    const risksMatch = output.match(/###?\s*Riesgos\s*\n([\s\S]*?)$/i);
    if (risksMatch) {
      result.risks = this.parseRisksTable(risksMatch[1]);
    }
    
    return result;
  }
  
  /**
   * Parse components table from markdown.
   */
  private parseComponentsTable(content: string): ComponentDefinition[] {
    const components: ComponentDefinition[] = [];
    const lines = content.split('\n').filter(line => line.includes('|'));
    
    for (const line of lines) {
      // Skip header and separator lines
      if (line.includes('Componente') || line.includes('---')) continue;
      
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 3) {
        components.push({
          name: cells[0],
          responsibility: cells[1],
          technology: cells[2],
        });
      }
    }
    
    return components;
  }
  
  /**
   * Parse risks table from markdown.
   */
  private parseRisksTable(content: string): RiskDefinition[] {
    const risks: RiskDefinition[] = [];
    const lines = content.split('\n').filter(line => line.includes('|'));
    
    for (const line of lines) {
      // Skip header and separator lines
      if (line.includes('Riesgo') || line.includes('---')) continue;
      
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 3) {
        const impact = cells[1] as 'Alto' | 'Medio' | 'Bajo';
        risks.push({
          description: cells[0],
          impact: ['Alto', 'Medio', 'Bajo'].includes(impact) ? impact : 'Medio',
          mitigation: cells[2],
        });
      }
    }
    
    return risks;
  }
  
  /**
   * Get the system prompt for the architect.
   */
  protected getSystemPrompt(): string {
    return ARCHITECT_SYSTEM_PROMPT;
  }
}

// Register the architect agent with the factory
registerAgent('architect', ArchitectAgent);

export default ArchitectAgent;
