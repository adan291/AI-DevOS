/**
 * QA Agent
 * 
 * Generates test cases, edge cases and failure scenarios.
 * 
 * Output Format:
 * - Test Cases: Table with name, description, input, expected output, type
 * - Edge Cases: Table with case, condition, expected behavior
 * - Failure Scenarios: Table with scenario, cause, expected behavior, recovery
 * 
 * @validates Requirements 4.10
 */

import { BaseAgent } from './base-agent.js';
import { registerAgent } from './agent-factory.js';
import { QA_SYSTEM_PROMPT } from './prompts/qa.js';
import type { AgentRole, AgentResult } from '../types/agents.js';
import type { FullContext } from '../types/orchestrator.js';

/** Structured output from QA Agent */
export interface QAOutput {
  testCases: TestCase[];
  edgeCases: EdgeCase[];
  failureScenarios: FailureScenario[];
  testImplementations: TestImplementation[];
}

/** Test case definition */
export interface TestCase {
  id: number;
  name: string;
  description: string;
  input: string;
  expectedOutput: string;
  type: 'unit' | 'integration' | 'e2e';
}

/** Edge case definition */
export interface EdgeCase {
  id: number;
  case: string;
  condition: string;
  expectedBehavior: string;
}

/** Failure scenario definition */
export interface FailureScenario {
  id: number;
  scenario: string;
  cause: string;
  expectedBehavior: string;
  recovery: string;
}

/** Test implementation code */
export interface TestImplementation {
  testName: string;
  component: string;
  code: string;
}

/**
 * QA Agent - generates comprehensive test cases.
 */
export class QAAgent extends BaseAgent {
  readonly role: AgentRole = 'qa';
  
  /**
   * Execute the QA agent and return test cases.
   */
  async execute(context: FullContext, taskDescription: string): Promise<AgentResult> {
    // Classify on the user's task, not the full prompt with context
    this.currentTaskDescription = taskDescription;
    const prompt = this.buildPrompt(context, taskDescription);
    
    try {
      const output = await this.executeWithRetry(prompt);
      const structured = this.parseQAOutput(output);
      
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
   * Get the structured QA output from the last successful execution.
   */
  getQAOutput(result: AgentResult): QAOutput | null {
    if (!result.success || !result.structured) {
      return null;
    }
    return result.structured as unknown as QAOutput;
  }
  
  /**
   * Build the prompt for the QA agent.
   */
  protected buildPrompt(context: FullContext, taskDescription: string): string {
    const contextSummary = this.buildContextSummary(context);
    
    return `## Contexto Actual

${contextSummary}

## Tarea
${taskDescription}

## Instrucciones
Diseña una estrategia de testing comprehensiva que cubra casos normales, edge cases y escenarios de fallo.
Incluye las 3 secciones obligatorias:
1. Test Cases (con implementación de código)
2. Edge Cases
3. Failure Scenarios

Responde siguiendo el formato especificado en tu rol.`;
  }
  
  /**
   * Build a summary of the current context for the prompt.
   */
  private buildContextSummary(context: FullContext): string {
    const parts: string[] = [];
    
    parts.push(`### Organización
- Guild ID: ${context.org.guildId}
- Estándares: ${context.org.standards.length > 0 ? context.org.standards.join(', ') : 'No definidos'}`);
    
    parts.push(`### Proyecto
- Canal ID: ${context.project.channelId}
- Nombre: ${context.project.name}
- Stack: ${context.project.stack.length > 0 ? context.project.stack.join(', ') : 'No definido'}
- Reglas: ${context.project.rules.length > 0 ? context.project.rules.join(', ') : 'No definidas'}`);
    
    if (context.thread) {
      const thread = context.thread;
      
      // Include code artifacts for testing
      const codeArtifacts = thread.artifacts.filter(a => a.type === 'code');
      
      parts.push(`### Hilo
- Thread ID: ${thread.threadId}
- Tipo: ${thread.type}
- Título: ${thread.title}
- Estado: ${thread.state}
- Resumen: ${thread.summary || 'Sin resumen'}
- Código a testear: ${codeArtifacts.length > 0 
    ? codeArtifacts.map(a => a.content.substring(0, 500) + '...').join('\n\n') 
    : 'No hay código para testear'}`);
    } else {
      parts.push(`### Hilo
- Sin hilo activo`);
    }
    
    return parts.join('\n\n');
  }
  
  /**
   * Parse the LLM output into structured QAOutput.
   */
  private parseQAOutput(output: string): QAOutput {
    const result: QAOutput = {
      testCases: [],
      edgeCases: [],
      failureScenarios: [],
      testImplementations: [],
    };
    
    // Extract Test Cases section
    const testCasesMatch = output.match(/###?\s*Test Cases\s*\n([\s\S]*?)(?=####?\s*Implementación|###?\s*Edge Cases|$)/i);
    if (testCasesMatch) {
      result.testCases = this.parseTestCasesTable(testCasesMatch[1]);
    }
    
    // Extract Test Implementations
    const implMatch = output.match(/####?\s*Implementación(?:\s+de Tests)?\s*\n([\s\S]*?)(?=###?\s*Edge Cases|$)/i);
    if (implMatch) {
      result.testImplementations = this.parseTestImplementations(implMatch[1]);
    }
    
    // Extract Edge Cases section
    const edgeCasesMatch = output.match(/###?\s*Edge Cases\s*\n([\s\S]*?)(?=###?\s*Failure|$)/i);
    if (edgeCasesMatch) {
      result.edgeCases = this.parseEdgeCasesTable(edgeCasesMatch[1]);
    }
    
    // Extract Failure Scenarios section
    const failureMatch = output.match(/###?\s*Failure Scenarios\s*\n([\s\S]*?)$/i);
    if (failureMatch) {
      result.failureScenarios = this.parseFailureScenariosTable(failureMatch[1]);
    }
    
    return result;
  }
  
  /**
   * Parse test cases table from markdown.
   */
  private parseTestCasesTable(content: string): TestCase[] {
    const testCases: TestCase[] = [];
    const lines = content.split('\n').filter(line => line.includes('|'));
    
    for (const line of lines) {
      // Skip header and separator lines
      if (line.includes('Nombre') || line.includes('---') || line.includes('#')) continue;
      
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 5) {
        const id = parseInt(cells[0], 10);
        if (!isNaN(id)) {
          const typeCell = cells[5]?.toLowerCase() || 'unit';
          let type: TestCase['type'] = 'unit';
          if (typeCell.includes('integration')) type = 'integration';
          else if (typeCell.includes('e2e')) type = 'e2e';
          
          testCases.push({
            id,
            name: cells[1],
            description: cells[2],
            input: cells[3],
            expectedOutput: cells[4],
            type,
          });
        }
      }
    }
    
    return testCases;
  }
  
  /**
   * Parse test implementations from markdown code blocks.
   */
  private parseTestImplementations(content: string): TestImplementation[] {
    const implementations: TestImplementation[] = [];
    
    // Match test code blocks with comments
    const testRegex = /\/\/\s*Test:\s*([^\n]+)\n```[\w]*\ndescribe\(['"]([^'"]+)['"]/gi;
    const codeBlockRegex = /```[\w]*\n([\s\S]*?)```/g;
    
    let match;
    const codeBlocks: string[] = [];
    while ((match = codeBlockRegex.exec(content)) !== null) {
      codeBlocks.push(match[1]);
    }
    
    for (const code of codeBlocks) {
      // Extract test name and component from describe block
      const describeMatch = code.match(/describe\(['"]([^'"]+)['"]/);
      const itMatch = code.match(/it\(['"]([^'"]+)['"]/);
      
      if (describeMatch) {
        implementations.push({
          testName: itMatch?.[1] || 'Test',
          component: describeMatch[1],
          code: code.trim(),
        });
      }
    }
    
    return implementations;
  }
  
  /**
   * Parse edge cases table from markdown.
   */
  private parseEdgeCasesTable(content: string): EdgeCase[] {
    const edgeCases: EdgeCase[] = [];
    const lines = content.split('\n').filter(line => line.includes('|'));
    
    for (const line of lines) {
      // Skip header and separator lines
      if (line.includes('Caso') || line.includes('---') || line.includes('#')) continue;
      
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 3) {
        const id = parseInt(cells[0], 10);
        if (!isNaN(id)) {
          edgeCases.push({
            id,
            case: cells[1],
            condition: cells[2],
            expectedBehavior: cells[3] || '',
          });
        }
      }
    }
    
    return edgeCases;
  }
  
  /**
   * Parse failure scenarios table from markdown.
   */
  private parseFailureScenariosTable(content: string): FailureScenario[] {
    const scenarios: FailureScenario[] = [];
    const lines = content.split('\n').filter(line => line.includes('|'));
    
    for (const line of lines) {
      // Skip header and separator lines
      if (line.includes('Escenario') || line.includes('---') || line.includes('#')) continue;
      
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 4) {
        const id = parseInt(cells[0], 10);
        if (!isNaN(id)) {
          scenarios.push({
            id,
            scenario: cells[1],
            cause: cells[2],
            expectedBehavior: cells[3],
            recovery: cells[4] || '',
          });
        }
      }
    }
    
    return scenarios;
  }
  
  /**
   * Get the system prompt for the QA agent.
   */
  protected getSystemPrompt(): string {
    return QA_SYSTEM_PROMPT;
  }
}

// Register the QA agent with the factory
registerAgent('qa', QAAgent);

export default QAAgent;
