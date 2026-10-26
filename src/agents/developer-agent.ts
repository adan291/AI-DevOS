/**
 * Developer Agent
 * 
 * Writes production-ready code following the project's stack.
 * 
 * Output Format:
 * - Implementation: Code blocks with file paths
 * - Modified Files: Table of changed files
 * - Dependencies: Required dependencies (if any)
 * - Implementation Notes: Technical decisions and trade-offs
 * 
 * @validates Requirements 4.8
 */

import { BaseAgent } from './base-agent.js';
import { registerAgent } from './agent-factory.js';
import { DEVELOPER_SYSTEM_PROMPT } from './prompts/developer.js';
import type { AgentRole, AgentResult } from '../types/agents.js';
import type { FullContext } from '../types/orchestrator.js';

/** Structured output from Developer Agent */
export interface DeveloperOutput {
  implementations: CodeImplementation[];
  modifiedFiles: FileChange[];
  dependencies: DependencyRequirement[];
  notes: string[];
}

/** Code implementation with file path */
export interface CodeImplementation {
  filePath: string;
  language: string;
  description: string;
  code: string;
}

/** File change description */
export interface FileChange {
  filePath: string;
  changeDescription: string;
}

/** Dependency requirement */
export interface DependencyRequirement {
  name: string;
  version: string;
  purpose: string;
}

/**
 * Developer Agent - writes production-ready code.
 */
export class DeveloperAgent extends BaseAgent {
  readonly role: AgentRole = 'developer';
  
  /**
   * Execute the developer agent and return code implementation.
   */
  async execute(context: FullContext, taskDescription: string): Promise<AgentResult> {
    // Classify on the user's task, not the full prompt with context
    this.currentTaskDescription = taskDescription;
    const prompt = this.buildPrompt(context, taskDescription);
    
    try {
      const output = await this.executeWithRetry(prompt);
      const structured = this.parseDeveloperOutput(output);
      
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
   * Get the structured developer output from the last successful execution.
   */
  getDeveloperOutput(result: AgentResult): DeveloperOutput | null {
    if (!result.success || !result.structured) {
      return null;
    }
    return result.structured as unknown as DeveloperOutput;
  }
  
  /**
   * Build the prompt for the developer.
   */
  protected buildPrompt(context: FullContext, taskDescription: string): string {
    const contextSummary = this.buildContextSummary(context);
    
    return `## Contexto Actual

${contextSummary}

## Tarea
${taskDescription}

## Instrucciones
Implementa código production-ready siguiendo estrictamente el stack del proyecto.
Incluye las secciones obligatorias:
1. Implementación (código completo con rutas de archivo)
2. Archivos Modificados
3. Dependencias Requeridas (solo si son necesarias del stack permitido)
4. Notas de Implementación

IMPORTANTE: NO inventes librerías o dependencias que no estén en el stack del proyecto.
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
    
    // Emphasize the project stack for the developer
    parts.push(`### Proyecto
- Canal ID: ${context.project.channelId}
- Nombre: ${context.project.name}
- **Stack Tecnológico**: ${context.project.stack.length > 0 ? context.project.stack.join(', ') : 'No definido - usar TypeScript por defecto'}
- Reglas: ${context.project.rules.length > 0 ? context.project.rules.join(', ') : 'No definidas'}`);
    
    if (context.thread) {
      const thread = context.thread;
      
      // Include existing artifacts for context
      const codeArtifacts = thread.artifacts.filter(a => a.type === 'code');
      const planArtifacts = thread.artifacts.filter(a => a.type === 'plan');
      
      parts.push(`### Hilo
- Thread ID: ${thread.threadId}
- Tipo: ${thread.type}
- Título: ${thread.title}
- Estado: ${thread.state}
- Resumen: ${thread.summary || 'Sin resumen'}
- Decisiones: ${thread.decisions.length > 0 
    ? thread.decisions.map(d => d.description).join('; ') 
    : 'Ninguna'}
- Código existente: ${codeArtifacts.length > 0 ? `${codeArtifacts.length} artefactos` : 'Ninguno'}
- Plan existente: ${planArtifacts.length > 0 ? 'Sí' : 'No'}`);
    } else {
      parts.push(`### Hilo
- Sin hilo activo`);
    }
    
    return parts.join('\n\n');
  }
  
  /**
   * Parse the LLM output into structured DeveloperOutput.
   */
  private parseDeveloperOutput(output: string): DeveloperOutput {
    const result: DeveloperOutput = {
      implementations: [],
      modifiedFiles: [],
      dependencies: [],
      notes: [],
    };
    
    // Extract code blocks with file paths
    result.implementations = this.parseCodeBlocks(output);
    
    // Extract Modified Files section
    const modifiedMatch = output.match(/###?\s*Archivos Modificados\s*\n([\s\S]*?)(?=###?\s*Dependencias|###?\s*Notas|$)/i);
    if (modifiedMatch) {
      result.modifiedFiles = this.parseModifiedFilesTable(modifiedMatch[1]);
    }
    
    // Extract Dependencies section
    const depsMatch = output.match(/###?\s*Dependencias(?:\s+Requeridas)?\s*\n([\s\S]*?)(?=###?\s*Notas|$)/i);
    if (depsMatch) {
      result.dependencies = this.parseDependencies(depsMatch[1]);
    }
    
    // Extract Notes section
    const notesMatch = output.match(/###?\s*Notas(?:\s+de Implementación)?\s*\n([\s\S]*?)$/i);
    if (notesMatch) {
      result.notes = this.parseNotes(notesMatch[1]);
    }
    
    return result;
  }
  
  /**
   * Parse code blocks from the output.
   */
  private parseCodeBlocks(output: string): CodeImplementation[] {
    const implementations: CodeImplementation[] = [];
    
    // Match code blocks with optional file path comments
    const codeBlockRegex = /```(\w+)?\n(?:\/\/\s*(?:Archivo|File):\s*([^\n]+)\n)?(?:\/\/\s*(?:Descripción|Description):\s*([^\n]+)\n)?([\s\S]*?)```/gi;
    
    let match;
    while ((match = codeBlockRegex.exec(output)) !== null) {
      const language = match[1] || 'typescript';
      const filePath = match[2]?.trim() || 'unknown';
      const description = match[3]?.trim() || '';
      const code = match[4]?.trim() || '';
      
      if (code && filePath !== 'unknown') {
        implementations.push({
          filePath,
          language,
          description,
          code,
        });
      }
    }
    
    return implementations;
  }
  
  /**
   * Parse modified files table from markdown.
   */
  private parseModifiedFilesTable(content: string): FileChange[] {
    const files: FileChange[] = [];
    const lines = content.split('\n').filter(line => line.includes('|'));
    
    for (const line of lines) {
      // Skip header and separator lines
      if (line.includes('Archivo') || line.includes('---')) continue;
      
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 2) {
        files.push({
          filePath: cells[0],
          changeDescription: cells[1],
        });
      }
    }
    
    return files;
  }
  
  /**
   * Parse dependencies from markdown.
   */
  private parseDependencies(content: string): DependencyRequirement[] {
    const dependencies: DependencyRequirement[] = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      // Match "- name: version - purpose" or similar patterns
      const match = line.match(/[-*]\s*([^:]+):\s*([^\s-]+)\s*[-–]\s*(.+)/);
      if (match) {
        dependencies.push({
          name: match[1].trim(),
          version: match[2].trim(),
          purpose: match[3].trim(),
        });
      }
    }
    
    return dependencies;
  }
  
  /**
   * Parse implementation notes from markdown.
   */
  private parseNotes(content: string): string[] {
    const notes: string[] = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      // Match bullet points
      const match = line.match(/[-*]\s*(.+)/);
      if (match) {
        notes.push(match[1].trim());
      }
    }
    
    return notes;
  }
  
  /**
   * Get the system prompt for the developer.
   */
  protected getSystemPrompt(): string {
    return DEVELOPER_SYSTEM_PROMPT;
  }
}

// Register the developer agent with the factory
registerAgent('developer', DeveloperAgent);

export default DeveloperAgent;
