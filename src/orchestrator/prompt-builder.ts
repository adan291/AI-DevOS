/**
 * Prompt Builder
 * 
 * Constructs prompts with all required layers for agent execution:
 * 1. Global prompt (system-wide instructions)
 * 2. Context prompt (org, project, thread context)
 * 3. Role prompt (agent-specific instructions)
 * 4. Steering rules (interpretation guidelines)
 * 
 * Uses thread summary instead of full history when summary exists.
 * 
 * @validates Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

import type { PromptBuilder, FullContext } from '../types/orchestrator.js';
import type { AgentRole } from '../types/agents.js';
import type { OrgContext, ProjectContext, ThreadContext } from '../types/models.js';
import { getSystemPrompt } from '../agents/prompts/index.js';

/**
 * Global prompt that is always included in every agent execution.
 * Contains system-wide instructions and behavior guidelines.
 * 
 * @validates Requirement 3.1
 */
export const GLOBAL_PROMPT = `Eres parte de AI DevOS, un sistema operativo de desarrollo multi-agente construido sobre Discord.

## Principios Fundamentales
1. Actúa de forma autónoma pero transparente — explica tus decisiones
2. Prioriza la calidad del código y las mejores prácticas
3. Respeta el stack tecnológico y las reglas del proyecto
4. Colabora con otros agentes siguiendo el plan del Coordinator
5. Persiste el conocimiento generado para futuras referencias

## Formato de Respuesta
- Responde siempre en español
- Usa markdown para formatear código y estructuras
- Sé conciso pero completo
- Incluye justificaciones para decisiones importantes`;

/**
 * Steering rules for interpretation and proactive behavior.
 * Allows agents to infer intent with minimal input and act proactively.
 * 
 * @validates Requirement 3.5
 */
export const STEERING_RULES = `## Reglas de Interpretación (Steering)

### Inferencia de Intención
- Cuando el input es ambiguo, infiere la intención más probable basándote en el contexto
- Si la confianza en la inferencia supera el 80%, actúa proactivamente
- Si la confianza es menor al 80%, solicita clarificación al usuario

### Comportamiento Proactivo
- Anticipa necesidades basándote en el estado del hilo y decisiones previas
- Sugiere mejoras cuando detectes oportunidades de optimización
- Alerta sobre riesgos potenciales antes de que se conviertan en problemas

### Consistencia
- Mantén coherencia con decisiones previas del hilo
- Respeta los patrones establecidos en el proyecto
- Sigue los estándares de la organización`;

/**
 * Default implementation of PromptBuilder
 * 
 * Builds prompts in 4 layers:
 * 1. Global prompt - system-wide instructions
 * 2. Context prompt - org, project, thread data
 * 3. Role prompt - agent-specific instructions
 * 4. Steering rules - interpretation guidelines
 */
export class DefaultPromptBuilder implements PromptBuilder {
  /**
   * Builds a complete prompt for agent execution.
   * 
   * @param context - Full context (org, project, thread)
   * @param agentRole - The role of the agent to execute
   * @param taskDescription - Description of the task to perform
   * @returns Complete prompt string with all 4 layers
   * 
   * @validates Requirements 3.1, 3.2, 3.3, 3.4, 3.5
   */
  build(context: FullContext, agentRole: AgentRole, taskDescription: string): string {
    const layers: string[] = [];

    // Layer 1: Global prompt (Requirement 3.1)
    layers.push(GLOBAL_PROMPT);

    // Layer 2: Context prompt (Requirement 3.2)
    layers.push(this.buildContextPrompt(context));

    // Layer 3: Role prompt (Requirement 3.4)
    layers.push(this.buildRolePrompt(agentRole));

    // Layer 4: Steering rules (Requirement 3.5)
    layers.push(STEERING_RULES);

    // Add task description
    layers.push(this.buildTaskSection(taskDescription));

    return layers.join('\n\n---\n\n');
  }

  /**
   * Builds the context prompt with org, project, and thread data.
   * Uses thread summary instead of full history when summary exists.
   * 
   * @param context - Full context to include
   * @returns Context prompt string
   * 
   * @validates Requirements 3.2, 3.3
   */
  private buildContextPrompt(context: FullContext): string {
    const sections: string[] = ['## Contexto Actual'];

    // Organization context
    sections.push(this.buildOrgSection(context.org));

    // Project context
    sections.push(this.buildProjectSection(context.project));

    // Thread context (uses summary when available - Requirement 3.3)
    if (context.thread) {
      sections.push(this.buildThreadSection(context.thread));
    }

    return sections.join('\n\n');
  }

  /**
   * Builds the organization context section.
   */
  private buildOrgSection(org: OrgContext): string {
    const lines: string[] = ['### Organización'];
    lines.push(`- ID: ${org.guildId}`);

    if (org.standards.length > 0) {
      lines.push(`- Estándares: ${org.standards.join(', ')}`);
    }

    if (org.architecture.length > 0) {
      lines.push(`- Arquitectura: ${org.architecture.join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Builds the project context section.
   */
  private buildProjectSection(project: ProjectContext): string {
    const lines: string[] = ['### Proyecto'];
    
    if (project.name) {
      lines.push(`- Nombre: ${project.name}`);
    }
    
    lines.push(`- Canal: ${project.channelId}`);

    if (project.stack.length > 0) {
      lines.push(`- Stack: ${project.stack.join(', ')}`);
    }

    if (project.rules.length > 0) {
      lines.push(`- Reglas: ${project.rules.join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Builds the thread context section.
   * Uses summary instead of full history when summary exists (Requirement 3.3).
   */
  private buildThreadSection(thread: ThreadContext): string {
    const lines: string[] = ['### Hilo'];
    lines.push(`- ID: ${thread.threadId}`);
    lines.push(`- Tipo: ${thread.type}`);
    
    if (thread.title) {
      lines.push(`- Título: ${thread.title}`);
    }
    
    lines.push(`- Estado: ${thread.state}`);
    lines.push(`- Mensajes: ${thread.messageCount}`);

    // Use summary instead of full history when available (Requirement 3.3)
    if (thread.summary && thread.summary.trim().length > 0) {
      lines.push('');
      lines.push('#### Resumen del Hilo');
      lines.push(thread.summary);
    }

    // Include decisions if any
    if (thread.decisions.length > 0) {
      lines.push('');
      lines.push('#### Decisiones Tomadas');
      for (const decision of thread.decisions) {
        const date = new Date(decision.createdAt).toISOString();
        lines.push(`- [${decision.madeBy}] ${decision.description} (${date})`);
      }
    }

    // Include artifacts summary if any
    if (thread.artifacts.length > 0) {
      lines.push('');
      lines.push('#### Artefactos Generados');
      for (const artifact of thread.artifacts) {
        lines.push(`- [${artifact.agentRole}] ${artifact.type}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Builds the role prompt section for the specific agent.
   * 
   * @param agentRole - The agent role
   * @returns Role prompt section
   * 
   * @validates Requirement 3.4
   */
  private buildRolePrompt(agentRole: AgentRole): string {
    const systemPrompt = getSystemPrompt(agentRole);
    return `## Tu Rol: ${agentRole.charAt(0).toUpperCase() + agentRole.slice(1)} Agent\n\n${systemPrompt}`;
  }

  /**
   * Builds the task description section.
   */
  private buildTaskSection(taskDescription: string): string {
    return `## Tarea Actual\n\n${taskDescription}`;
  }
}

/**
 * Creates a new PromptBuilder instance.
 * 
 * @returns A new DefaultPromptBuilder instance
 */
export function createPromptBuilder(): PromptBuilder {
  return new DefaultPromptBuilder();
}
