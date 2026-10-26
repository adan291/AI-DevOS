/**
 * DevOps Agent
 * 
 * Handles build steps, CI/CD configuration and deployment strategy.
 * 
 * Output Format:
 * - Build Steps: Table with step, command, description
 * - CI/CD Configuration: YAML configuration for the platform
 * - Deployment Strategy: Table with aspect and configuration
 * 
 * @validates Requirements 4.11
 */

import { BaseAgent } from './base-agent.js';
import { registerAgent } from './agent-factory.js';
import { DEVOPS_SYSTEM_PROMPT } from './prompts/devops.js';
import type { AgentRole, AgentResult } from '../types/agents.js';
import type { FullContext } from '../types/orchestrator.js';

/** Structured output from DevOps Agent */
export interface DevOpsOutput {
  buildSteps: BuildStep[];
  buildScript: string;
  cicdConfig: CICDConfig;
  deploymentStrategy: DeploymentStrategy;
}

/** Build step definition */
export interface BuildStep {
  id: number;
  step: string;
  command: string;
  description: string;
}

/** CI/CD configuration */
export interface CICDConfig {
  platform: 'github-actions' | 'gitlab-ci' | 'jenkins' | 'other';
  yaml: string;
}

/** Deployment strategy */
export interface DeploymentStrategy {
  strategy: 'blue-green' | 'rolling' | 'canary' | 'recreate';
  environment: string;
  rollback: string;
  healthChecks: string[];
  secrets: string;
  plan: DeploymentPlan;
}

/** Deployment plan steps */
export interface DeploymentPlan {
  preDeployment: string;
  deployment: string;
  postDeployment: string;
  rollback: string;
}

/**
 * DevOps Agent - handles build, CI/CD and deployment.
 */
export class DevOpsAgent extends BaseAgent {
  readonly role: AgentRole = 'devops';
  
  /**
   * Execute the DevOps agent and return deployment configuration.
   */
  async execute(context: FullContext, taskDescription: string): Promise<AgentResult> {
    // Classify on the user's task, not the full prompt with context
    this.currentTaskDescription = taskDescription;
    const prompt = this.buildPrompt(context, taskDescription);
    
    try {
      const output = await this.executeWithRetry(prompt);
      const structured = this.parseDevOpsOutput(output);
      
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
   * Get the structured DevOps output from the last successful execution.
   */
  getDevOpsOutput(result: AgentResult): DevOpsOutput | null {
    if (!result.success || !result.structured) {
      return null;
    }
    return result.structured as unknown as DevOpsOutput;
  }
  
  /**
   * Build the prompt for the DevOps agent.
   */
  protected buildPrompt(context: FullContext, taskDescription: string): string {
    const contextSummary = this.buildContextSummary(context);
    
    return `## Contexto Actual

${contextSummary}

## Tarea
${taskDescription}

## Instrucciones
Diseña e implementa la configuración de build, CI/CD y deployment.
Incluye las 3 secciones obligatorias:
1. Build Steps (con scripts)
2. CI/CD Configuration (YAML específico para la plataforma)
3. Deployment Strategy (con plan de deployment y rollback)

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
      
      // Include deployment artifacts if any
      const deploymentArtifacts = thread.artifacts.filter(a => a.type === 'deployment');
      const codeArtifacts = thread.artifacts.filter(a => a.type === 'code');
      
      parts.push(`### Hilo
- Thread ID: ${thread.threadId}
- Tipo: ${thread.type}
- Título: ${thread.title}
- Estado: ${thread.state}
- Resumen: ${thread.summary || 'Sin resumen'}
- Código aprobado: ${codeArtifacts.length > 0 ? 'Sí' : 'No'}
- Configuración de deployment existente: ${deploymentArtifacts.length > 0 ? 'Sí' : 'No'}`);
    } else {
      parts.push(`### Hilo
- Sin hilo activo`);
    }
    
    return parts.join('\n\n');
  }
  
  /**
   * Parse the LLM output into structured DevOpsOutput.
   */
  private parseDevOpsOutput(output: string): DevOpsOutput {
    const result: DevOpsOutput = {
      buildSteps: [],
      buildScript: '',
      cicdConfig: {
        platform: 'github-actions',
        yaml: '',
      },
      deploymentStrategy: {
        strategy: 'rolling',
        environment: 'staging → production',
        rollback: 'Manual',
        healthChecks: [],
        secrets: 'Environment variables',
        plan: {
          preDeployment: '',
          deployment: '',
          postDeployment: '',
          rollback: '',
        },
      },
    };
    
    // Extract Build Steps section
    const buildStepsMatch = output.match(/###?\s*Build Steps\s*\n([\s\S]*?)(?=####?\s*Scripts|###?\s*CI\/CD|$)/i);
    if (buildStepsMatch) {
      result.buildSteps = this.parseBuildStepsTable(buildStepsMatch[1]);
    }
    
    // Extract Build Script
    const buildScriptMatch = output.match(/####?\s*Scripts(?:\s+de Build)?\s*\n```(?:bash|sh)?\n([\s\S]*?)```/i);
    if (buildScriptMatch) {
      result.buildScript = buildScriptMatch[1].trim();
    }
    
    // Extract CI/CD Configuration section
    const cicdMatch = output.match(/###?\s*CI\/CD Configuration\s*\n([\s\S]*?)(?=###?\s*Deployment|$)/i);
    if (cicdMatch) {
      result.cicdConfig = this.parseCICDConfig(cicdMatch[1]);
    }
    
    // Extract Deployment Strategy section
    const deploymentMatch = output.match(/###?\s*Deployment Strategy\s*\n([\s\S]*?)$/i);
    if (deploymentMatch) {
      result.deploymentStrategy = this.parseDeploymentStrategy(deploymentMatch[1]);
    }
    
    return result;
  }
  
  /**
   * Parse build steps table from markdown.
   */
  private parseBuildStepsTable(content: string): BuildStep[] {
    const steps: BuildStep[] = [];
    const lines = content.split('\n').filter(line => line.includes('|'));
    
    for (const line of lines) {
      // Skip header and separator lines
      if (line.includes('Paso') || line.includes('---') || line.includes('#')) continue;
      
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 3) {
        const id = parseInt(cells[0], 10);
        if (!isNaN(id)) {
          steps.push({
            id,
            step: cells[1],
            command: cells[2].replace(/`/g, ''),
            description: cells[3] || '',
          });
        }
      }
    }
    
    return steps;
  }
  
  /**
   * Parse CI/CD configuration from markdown.
   */
  private parseCICDConfig(content: string): CICDConfig {
    const result: CICDConfig = {
      platform: 'github-actions',
      yaml: '',
    };
    
    // Detect platform from content
    if (content.includes('gitlab')) {
      result.platform = 'gitlab-ci';
    } else if (content.includes('jenkins')) {
      result.platform = 'jenkins';
    } else if (content.includes('github') || content.includes('.github/workflows')) {
      result.platform = 'github-actions';
    }
    
    // Extract YAML configuration
    const yamlMatch = content.match(/```ya?ml\n([\s\S]*?)```/i);
    if (yamlMatch) {
      result.yaml = yamlMatch[1].trim();
    }
    
    return result;
  }
  
  /**
   * Parse deployment strategy from markdown.
   */
  private parseDeploymentStrategy(content: string): DeploymentStrategy {
    const result: DeploymentStrategy = {
      strategy: 'rolling',
      environment: 'staging → production',
      rollback: 'Manual',
      healthChecks: [],
      secrets: 'Environment variables',
      plan: {
        preDeployment: '',
        deployment: '',
        postDeployment: '',
        rollback: '',
      },
    };
    
    // Parse strategy table
    const lines = content.split('\n').filter(line => line.includes('|'));
    for (const line of lines) {
      if (line.includes('---') || line.includes('Aspecto')) continue;
      
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 2) {
        const aspect = cells[0].toLowerCase();
        const value = cells[1];
        
        if (aspect.includes('estrategia') || aspect.includes('strategy')) {
          if (value.toLowerCase().includes('blue-green')) result.strategy = 'blue-green';
          else if (value.toLowerCase().includes('canary')) result.strategy = 'canary';
          else if (value.toLowerCase().includes('recreate')) result.strategy = 'recreate';
          else result.strategy = 'rolling';
        } else if (aspect.includes('ambiente') || aspect.includes('environment')) {
          result.environment = value;
        } else if (aspect.includes('rollback')) {
          result.rollback = value;
        } else if (aspect.includes('health')) {
          result.healthChecks = value.split(',').map(h => h.trim());
        } else if (aspect.includes('secret')) {
          result.secrets = value;
        }
      }
    }
    
    // Parse deployment plan
    const planMatch = content.match(/####?\s*Plan(?:\s+de Deployment)?\s*\n([\s\S]*?)$/i);
    if (planMatch) {
      result.plan = this.parseDeploymentPlan(planMatch[1]);
    }
    
    return result;
  }
  
  /**
   * Parse deployment plan from markdown.
   */
  private parseDeploymentPlan(content: string): DeploymentPlan {
    const plan: DeploymentPlan = {
      preDeployment: '',
      deployment: '',
      postDeployment: '',
      rollback: '',
    };
    
    // Extract each phase
    const preMatch = content.match(/Pre-deployment[:\s]*([^\n]+)/i);
    if (preMatch) plan.preDeployment = preMatch[1].trim();
    
    const deployMatch = content.match(/Deployment[:\s]*([^\n]+)/i);
    if (deployMatch) plan.deployment = deployMatch[1].trim();
    
    const postMatch = content.match(/Post-deployment[:\s]*([^\n]+)/i);
    if (postMatch) plan.postDeployment = postMatch[1].trim();
    
    const rollbackMatch = content.match(/Rollback[:\s]*([^\n]+)/i);
    if (rollbackMatch) plan.rollback = rollbackMatch[1].trim();
    
    return plan;
  }
  
  /**
   * Get the system prompt for the DevOps agent.
   */
  protected getSystemPrompt(): string {
    return DEVOPS_SYSTEM_PROMPT;
  }
}

// Register the DevOps agent with the factory
registerAgent('devops', DevOpsAgent);

export default DevOpsAgent;
