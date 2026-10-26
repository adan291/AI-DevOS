/**
 * Memory Agent
 * 
 * Extracts and persists knowledge as structured JSON.
 * Responsible for extracting decisions, patterns, and errors from conversations.
 * 
 * Output Format:
 * - Returns structured JSON (MemoryEntry format)
 * - Supports dual-write to PostgresStore and VectorStore (data preparation)
 * 
 * @validates Requirements 4.12, 5.5
 */

import { BaseAgent } from './base-agent.js';
import { registerAgent } from './agent-factory.js';
import { MEMORY_SYSTEM_PROMPT } from './prompts/memory.js';
import type { AgentRole, AgentResult } from '../types/agents.js';
import type { FullContext } from '../types/orchestrator.js';
import type { MemoryEntry } from '../types/models.js';
import type { VectorMetadata } from '../types/persistence.js';

/** Memory extraction result from LLM */
export interface MemoryExtractionResult {
  memories: ExtractedMemory[];
  metadata: {
    extractedAt: string;
    sourceMessages: number;
    confidence: number;
  };
}

/** Individual extracted memory item */
export interface ExtractedMemory {
  type: 'decision' | 'pattern' | 'error' | 'summary';
  content: Record<string, unknown>;
  tags: string[];
  importance: 'high' | 'medium' | 'low';
}

/** Prepared data for dual-write persistence */
export interface MemoryPersistenceData {
  entries: MemoryEntry[];
  vectorMetadata: VectorMetadata[];
}

/**
 * Memory Agent - extracts and structures knowledge for persistence.
 */
export class MemoryAgent extends BaseAgent {
  readonly role: AgentRole = 'memory';
  
  /**
   * Execute the memory agent and return structured memory data.
   */
  async execute(context: FullContext, taskDescription: string): Promise<AgentResult> {
    // Classify on the user's task, not the full prompt with context
    this.currentTaskDescription = taskDescription;
    const prompt = this.buildPrompt(context, taskDescription);
    
    try {
      const output = await this.executeWithRetry(prompt);
      const extractionResult = this.parseMemoryExtraction(output);
      const persistenceData = this.preparePersistenceData(extractionResult, context);
      
      return {
        role: this.role,
        output: output,
        structured: {
          extraction: extractionResult,
          persistence: persistenceData,
        } as Record<string, unknown>,
        success: true,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }
  
  /**
   * Get the memory extraction result from the last successful execution.
   */
  getMemoryExtraction(result: AgentResult): MemoryExtractionResult | null {
    if (!result.success || !result.structured) {
      return null;
    }
    
    const structured = result.structured as { extraction?: MemoryExtractionResult };
    return structured.extraction ?? null;
  }
  
  /**
   * Get the prepared persistence data from the last successful execution.
   */
  getPersistenceData(result: AgentResult): MemoryPersistenceData | null {
    if (!result.success || !result.structured) {
      return null;
    }
    
    const structured = result.structured as { persistence?: MemoryPersistenceData };
    return structured.persistence ?? null;
  }
  
  /**
   * Build the prompt for memory extraction.
   */
  protected buildPrompt(context: FullContext, taskDescription: string): string {
    const contextSummary = this.buildContextSummary(context);
    
    return `## Contexto Actual

${contextSummary}

## Tarea de Extracción
${taskDescription}

## Instrucciones
Analiza el contexto y extrae conocimiento relevante (decisiones, patrones, errores, resúmenes).
Responde SOLO con el JSON estructurado según el formato especificado en tu rol.
No incluyas texto adicional fuera del JSON.`;
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
      
      parts.push(`### Hilo
- Thread ID: ${thread.threadId}
- Tipo: ${thread.type}
- Título: ${thread.title}
- Estado: ${thread.state}
- Resumen: ${thread.summary || 'Sin resumen'}
- Mensajes: ${thread.messageCount}
- Decisiones previas: ${thread.decisions.length > 0 
    ? thread.decisions.map(d => `${d.description} (por ${d.madeBy})`).join('; ') 
    : 'Ninguna'}
- Artefactos: ${thread.artifacts.length > 0 
    ? thread.artifacts.map(a => `${a.type} (por ${a.agentRole})`).join(', ') 
    : 'Ninguno'}`);
    } else {
      parts.push(`### Hilo
- Sin hilo activo`);
    }
    
    return parts.join('\n\n');
  }
  
  /**
   * Parse the LLM output into a MemoryExtractionResult.
   */
  private parseMemoryExtraction(output: string): MemoryExtractionResult {
    // Try to extract JSON from the output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return this.createFallbackExtraction(output);
    }
    
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<MemoryExtractionResult>;
      
      // Validate and normalize the parsed result
      if (!parsed.memories || !Array.isArray(parsed.memories)) {
        return this.createFallbackExtraction(output);
      }
      
      // Validate each memory entry
      const validMemories = parsed.memories
        .filter(this.isValidExtractedMemory)
        .map(this.normalizeExtractedMemory);
      
      if (validMemories.length === 0) {
        return this.createFallbackExtraction(output);
      }
      
      return {
        memories: validMemories,
        metadata: {
          extractedAt: parsed.metadata?.extractedAt ?? new Date().toISOString(),
          sourceMessages: parsed.metadata?.sourceMessages ?? 0,
          confidence: parsed.metadata?.confidence ?? 0.5,
        },
      };
    } catch {
      return this.createFallbackExtraction(output);
    }
  }
  
  /**
   * Check if an extracted memory is valid.
   */
  private isValidExtractedMemory(memory: unknown): memory is ExtractedMemory {
    if (!memory || typeof memory !== 'object') {
      return false;
    }
    
    const m = memory as Record<string, unknown>;
    const validTypes = ['decision', 'pattern', 'error', 'summary'];
    
    return (
      typeof m.type === 'string' &&
      validTypes.includes(m.type) &&
      m.content !== undefined &&
      typeof m.content === 'object'
    );
  }
  
  /**
   * Normalize an extracted memory to ensure all fields are present.
   */
  private normalizeExtractedMemory(memory: ExtractedMemory): ExtractedMemory {
    return {
      type: memory.type,
      content: memory.content ?? {},
      tags: Array.isArray(memory.tags) ? memory.tags : [],
      importance: ['high', 'medium', 'low'].includes(memory.importance) 
        ? memory.importance 
        : 'medium',
    };
  }
  
  /**
   * Create a fallback extraction when JSON parsing fails.
   */
  private createFallbackExtraction(output: string): MemoryExtractionResult {
    // Try to extract meaningful content from the output
    const lowerOutput = output.toLowerCase();
    const memories: ExtractedMemory[] = [];
    
    // Detect if output contains decision-like content
    if (lowerOutput.includes('decisión') || lowerOutput.includes('decision') || 
        lowerOutput.includes('decidió') || lowerOutput.includes('decided')) {
      memories.push({
        type: 'decision',
        content: {
          title: 'Decisión extraída',
          description: output.substring(0, 500),
          context: 'Extraído automáticamente del output del agente',
        },
        tags: ['auto-extracted'],
        importance: 'medium',
      });
    }
    
    // Detect if output contains error-like content
    if (lowerOutput.includes('error') || lowerOutput.includes('bug') || 
        lowerOutput.includes('fallo') || lowerOutput.includes('failure')) {
      memories.push({
        type: 'error',
        content: {
          description: output.substring(0, 500),
          cause: 'Causa no determinada',
          solution: 'Solución pendiente',
        },
        tags: ['auto-extracted'],
        importance: 'high',
      });
    }
    
    // Detect if output contains pattern-like content
    if (lowerOutput.includes('patrón') || lowerOutput.includes('pattern') || 
        lowerOutput.includes('práctica') || lowerOutput.includes('practice')) {
      memories.push({
        type: 'pattern',
        content: {
          name: 'Patrón extraído',
          description: output.substring(0, 500),
        },
        tags: ['auto-extracted'],
        importance: 'medium',
      });
    }
    
    // If no specific content detected, create a summary
    if (memories.length === 0) {
      memories.push({
        type: 'summary',
        content: {
          currentState: output.substring(0, 500),
          decisions: [],
          openIssues: [],
          nextSteps: [],
        },
        tags: ['auto-extracted', 'fallback'],
        importance: 'low',
      });
    }
    
    return {
      memories,
      metadata: {
        extractedAt: new Date().toISOString(),
        sourceMessages: 0,
        confidence: 0.3, // Low confidence for fallback extraction
      },
    };
  }
  
  /**
   * Prepare data for dual-write persistence (PostgresStore + VectorStore).
   */
  private preparePersistenceData(
    extraction: MemoryExtractionResult,
    context: FullContext
  ): MemoryPersistenceData {
    const threadId = context.thread?.threadId ?? 'unknown';
    const timestamp = Date.now();
    
    const entries: MemoryEntry[] = [];
    const vectorMetadata: VectorMetadata[] = [];
    
    for (const memory of extraction.memories) {
      // Generate a unique ID for this memory entry
      const id = this.generateMemoryId(threadId, memory.type, timestamp);
      
      // Create MemoryEntry for PostgresStore
      entries.push({
        id,
        threadId,
        type: memory.type,
        content: {
          ...memory.content,
          tags: memory.tags,
          importance: memory.importance,
        },
        timestamp,
      });
      
      // Create VectorMetadata for VectorStore
      vectorMetadata.push({
        threadId,
        type: memory.type,
        content: this.serializeContentForVector(memory),
        timestamp,
      });
    }
    
    return { entries, vectorMetadata };
  }
  
  /**
   * Generate a unique ID for a memory entry.
   */
  private generateMemoryId(threadId: string, type: string, timestamp: number): string {
    const random = Math.random().toString(36).substring(2, 8);
    return `mem_${threadId}_${type}_${timestamp}_${random}`;
  }
  
  /**
   * Serialize memory content for vector embedding.
   */
  private serializeContentForVector(memory: ExtractedMemory): string {
    const parts: string[] = [`[${memory.type.toUpperCase()}]`];
    
    // Add relevant content fields based on type
    const content = memory.content as Record<string, unknown>;
    
    if (content.title) {
      parts.push(`Título: ${content.title}`);
    }
    if (content.name) {
      parts.push(`Nombre: ${content.name}`);
    }
    if (content.description) {
      parts.push(`Descripción: ${content.description}`);
    }
    if (content.context) {
      parts.push(`Contexto: ${content.context}`);
    }
    if (content.cause) {
      parts.push(`Causa: ${content.cause}`);
    }
    if (content.solution) {
      parts.push(`Solución: ${content.solution}`);
    }
    if (content.currentState) {
      parts.push(`Estado: ${content.currentState}`);
    }
    
    // Add tags
    if (memory.tags.length > 0) {
      parts.push(`Tags: ${memory.tags.join(', ')}`);
    }
    
    return parts.join(' | ');
  }
  
  /**
   * Get the system prompt for the memory agent.
   */
  protected getSystemPrompt(): string {
    return MEMORY_SYSTEM_PROMPT;
  }
}

// Register the memory agent with the factory
registerAgent('memory', MemoryAgent);

export default MemoryAgent;
