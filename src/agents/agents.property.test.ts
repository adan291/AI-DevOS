/**
 * Property-Based Tests for Agent System
 * Feature: discord-ai-devos
 * 
 * Property 4: Coordinator asigna agentes según estado del hilo
 * **Validates: Requirements 4.2, 4.3, 4.4, 4.5**
 *
 * Property 5: Output de agentes contiene secciones requeridas por rol
 * **Validates: Requirements 4.6, 4.7, 4.9, 4.10, 4.11, 4.12**
 *
 * Property 4: For any FullContext, the ExecutionPlan produced by the Coordinator
 * must follow the rules:
 * - New thread (no thread context) → [architect, planner]
 * - Implementation required → includes developer
 * - Existing code → includes [reviewer, qa]
 * - Approved code → includes devops
 *
 * Property 5: For any agent and valid context, the AgentResult produced must
 * contain all required sections for its role:
 * - Architect → [overview, components, dataFlow, risks]
 * - Planner → [tasks, dependencies, edgeCases, complexity]
 * - Reviewer → [issues, suggestions, verdict]
 * - QA → [testCases, edgeCases, failureScenarios]
 * - DevOps → [buildSteps, cicdConfig, deploymentStrategy]
 * - Memory → [memories, metadata]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { CoordinatorAgent } from './coordinator-agent.js';
import type { FullContext } from '../types/orchestrator.js';
import type { OrgContext, ProjectContext, ThreadContext, ThreadType, ThreadState, Artifact, Decision } from '../types/models.js';
import type { AgentRole, ExecutionPlan } from '../types/agents.js';

// ============================================================================
// Mock the LLM execution to test routing logic without calling Claude API
// ============================================================================

// Mock the base-agent module to avoid actual LLM calls
vi.mock('./base-agent.js', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  
  return {
    ...original,
    BaseAgent: class MockBaseAgent {
      role: AgentRole = 'coordinator';
      
      protected async executeWithRetry(prompt: string): Promise<string> {
        // Parse the context from the prompt to determine the appropriate plan
        return this.generateMockResponse(prompt);
      }
      
      protected handleError(error: unknown) {
        return {
          role: this.role,
          output: '',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
      
      protected getSystemPrompt(): string {
        return 'Mock system prompt';
      }
      
      private generateMockResponse(prompt: string): string {
        // Analyze the prompt to determine the appropriate routing
        const isNewThread = prompt.includes('Sin hilo activo') || prompt.includes('hilo nuevo');
        const hasCode = prompt.includes('Tiene código: Sí');
        const isApproved = prompt.includes('Código aprobado: Sí');
        
        // Check for explicit implementation keywords in the task description
        const taskLower = prompt.toLowerCase();
        const hasImplementKeywords = taskLower.includes('implementar') ||
                                     taskLower.includes('implement') ||
                                     taskLower.includes('escribir el código') ||
                                     taskLower.includes('code this') ||
                                     taskLower.includes('develop');
        
        let agents: AgentRole[] = [];
        let reason = '';
        
        if (isNewThread) {
          agents = ['architect', 'planner'];
          reason = 'Hilo nuevo - se requiere diseño y planificación inicial';
        } else if (isApproved) {
          agents = ['devops'];
          reason = 'Código aprobado - listo para deployment';
        } else if (hasCode) {
          agents = ['reviewer', 'qa'];
          reason = 'Código existente - se requiere revisión y testing';
        } else if (hasImplementKeywords) {
          // Explicit implementation request takes precedence
          agents = ['developer'];
          reason = 'Se requiere implementación de código';
        } else {
          // Default fallback for new threads or threads without code
          agents = ['architect', 'planner'];
          reason = 'Plan por defecto para contexto sin hilo o sin código';
        }
        
        return JSON.stringify({ agents, reason });
      }
    },
  };
});

// ============================================================================
// Fast-Check Arbitraries (Generators) for FullContext
// ============================================================================

/**
 * Generates a Discord snowflake ID
 */
const snowflakeIdArb = fc.stringMatching(/^[0-9]{17,19}$/);

/**
 * Generates an OrgContext
 */
const orgContextArb: fc.Arbitrary<OrgContext> = fc.record({
  guildId: snowflakeIdArb,
  standards: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 5 }),
  architecture: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 5 }),
});

/**
 * Generates a ProjectContext
 */
const projectContextArb: fc.Arbitrary<ProjectContext> = fc.record({
  channelId: snowflakeIdArb,
  guildId: snowflakeIdArb,
  name: fc.string({ minLength: 1, maxLength: 50 }),
  stack: fc.array(fc.constantFrom('TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Redis'), { maxLength: 5 }),
  rules: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 5 }),
});

/**
 * Generates a valid ThreadType
 */
const threadTypeArb: fc.Arbitrary<ThreadType> = fc.constantFrom('feature', 'bug', 'pr', 'task');

/**
 * Generates a valid ThreadState
 */
const threadStateArb: fc.Arbitrary<ThreadState> = fc.constantFrom('open', 'in_progress', 'review', 'done');

/**
 * Generates an AgentRole for decisions/artifacts
 */
const agentRoleArb: fc.Arbitrary<AgentRole> = fc.constantFrom(
  'coordinator', 'architect', 'planner', 'developer', 'reviewer', 'qa', 'devops', 'memory'
);

/**
 * Generates a Decision
 */
const decisionArb: fc.Arbitrary<Decision> = fc.record({
  id: fc.string({ minLength: 5, maxLength: 20 }),
  description: fc.string({ minLength: 1, maxLength: 200 }),
  status: fc.constantFrom('pending', 'approved', 'rejected') as fc.Arbitrary<Decision['status']>,
  madeBy: agentRoleArb,
  createdAt: fc.integer({ min: 1609459200000, max: Date.now() }),
});

/**
 * Generates an Artifact (non-code)
 */
const nonCodeArtifactArb: fc.Arbitrary<Artifact> = fc.record({
  id: fc.string({ minLength: 5, maxLength: 20 }),
  type: fc.constantFrom('plan', 'test', 'deployment') as fc.Arbitrary<Artifact['type']>,
  content: fc.string({ minLength: 1, maxLength: 500 }),
  agentRole: agentRoleArb,
  createdAt: fc.integer({ min: 1609459200000, max: Date.now() }),
});

/**
 * Generates a code Artifact
 */
const codeArtifactArb: fc.Arbitrary<Artifact> = fc.record({
  id: fc.string({ minLength: 5, maxLength: 20 }),
  type: fc.constant('code') as fc.Arbitrary<Artifact['type']>,
  content: fc.string({ minLength: 1, maxLength: 500 }),
  agentRole: fc.constant('developer') as fc.Arbitrary<AgentRole>,
  createdAt: fc.integer({ min: 1609459200000, max: Date.now() }),
});

/**
 * Generates a review Artifact with approval
 */
const approvedReviewArtifactArb: fc.Arbitrary<Artifact> = fc.record({
  id: fc.string({ minLength: 5, maxLength: 20 }),
  type: fc.constant('review') as fc.Arbitrary<Artifact['type']>,
  content: fc.constantFrom('LGTM - Approved', 'Code looks good, approved!', 'Approved with minor suggestions'),
  agentRole: fc.constant('reviewer') as fc.Arbitrary<AgentRole>,
  createdAt: fc.integer({ min: 1609459200000, max: Date.now() }),
});

/**
 * Generates a review Artifact without approval
 */
const nonApprovedReviewArtifactArb: fc.Arbitrary<Artifact> = fc.record({
  id: fc.string({ minLength: 5, maxLength: 20 }),
  type: fc.constant('review') as fc.Arbitrary<Artifact['type']>,
  content: fc.constantFrom('Needs changes', 'Please fix the issues', 'Rejected - security concerns'),
  agentRole: fc.constant('reviewer') as fc.Arbitrary<AgentRole>,
  createdAt: fc.integer({ min: 1609459200000, max: Date.now() }),
});

/**
 * Generates an approval Decision
 */
const approvalDecisionArb: fc.Arbitrary<Decision> = fc.record({
  id: fc.string({ minLength: 5, maxLength: 20 }),
  description: fc.constantFrom('Código aprobado para merge', 'Approved for deployment', 'LGTM - aprobado'),
  status: fc.constant('approved') as fc.Arbitrary<Decision['status']>,
  madeBy: fc.constant('reviewer') as fc.Arbitrary<AgentRole>,
  createdAt: fc.integer({ min: 1609459200000, max: Date.now() }),
});

/**
 * Generates a basic ThreadContext (no code, not approved)
 */
const basicThreadContextArb: fc.Arbitrary<ThreadContext> = fc.record({
  threadId: snowflakeIdArb,
  channelId: snowflakeIdArb,
  type: threadTypeArb,
  title: fc.string({ minLength: 1, maxLength: 100 }),
  summary: fc.string({ maxLength: 500 }),
  state: threadStateArb,
  decisions: fc.array(decisionArb, { maxLength: 3 }),
  artifacts: fc.array(nonCodeArtifactArb, { maxLength: 3 }),
  messageCount: fc.integer({ min: 0, max: 100 }),
  lastSummaryAt: fc.integer({ min: 0, max: 100 }),
});

/**
 * Generates a ThreadContext with code artifacts (existing code)
 */
const threadWithCodeArb: fc.Arbitrary<ThreadContext> = fc.record({
  threadId: snowflakeIdArb,
  channelId: snowflakeIdArb,
  type: threadTypeArb,
  title: fc.string({ minLength: 1, maxLength: 100 }),
  summary: fc.string({ maxLength: 500 }),
  state: fc.constantFrom('in_progress', 'review') as fc.Arbitrary<ThreadState>,
  decisions: fc.array(decisionArb, { maxLength: 3 }),
  artifacts: fc.tuple(codeArtifactArb, fc.array(nonCodeArtifactArb, { maxLength: 2 }))
    .map(([code, others]) => [code, ...others]),
  messageCount: fc.integer({ min: 1, max: 100 }),
  lastSummaryAt: fc.integer({ min: 0, max: 50 }),
});

/**
 * Generates a ThreadContext with approved code
 */
const threadWithApprovedCodeArb: fc.Arbitrary<ThreadContext> = fc.record({
  threadId: snowflakeIdArb,
  channelId: snowflakeIdArb,
  type: threadTypeArb,
  title: fc.string({ minLength: 1, maxLength: 100 }),
  summary: fc.string({ maxLength: 500 }),
  state: fc.constantFrom('review', 'done') as fc.Arbitrary<ThreadState>,
  decisions: fc.tuple(approvalDecisionArb, fc.array(decisionArb, { maxLength: 2 }))
    .map(([approval, others]) => [approval, ...others]),
  artifacts: fc.tuple(codeArtifactArb, approvedReviewArtifactArb, fc.array(nonCodeArtifactArb, { maxLength: 1 }))
    .map(([code, review, others]) => [code, review, ...others]),
  messageCount: fc.integer({ min: 5, max: 100 }),
  lastSummaryAt: fc.integer({ min: 0, max: 50 }),
});

/**
 * Generates a FullContext without thread (new thread scenario)
 */
const fullContextNoThreadArb: fc.Arbitrary<FullContext> = fc.record({
  org: orgContextArb,
  project: projectContextArb,
});

/**
 * Generates a FullContext with a basic thread (implementation required)
 */
const fullContextWithBasicThreadArb: fc.Arbitrary<FullContext> = fc.record({
  org: orgContextArb,
  project: projectContextArb,
  thread: basicThreadContextArb,
});

/**
 * Generates a FullContext with code (existing code scenario)
 */
const fullContextWithCodeArb: fc.Arbitrary<FullContext> = fc.record({
  org: orgContextArb,
  project: projectContextArb,
  thread: threadWithCodeArb,
});

/**
 * Generates a FullContext with approved code
 */
const fullContextWithApprovedCodeArb: fc.Arbitrary<FullContext> = fc.record({
  org: orgContextArb,
  project: projectContextArb,
  thread: threadWithApprovedCodeArb,
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe('Property 4: Coordinator asigna agentes según estado del hilo', () => {
  let coordinator: CoordinatorAgent;

  beforeEach(() => {
    coordinator = new CoordinatorAgent();
  });

  /**
   * **Validates: Requirements 4.2**
   *
   * Property: When the Coordinator receives a new thread (no thread context),
   * it should assign architect and planner as initial agents.
   */
  describe('New Thread → [architect, planner]', () => {
    it('should assign architect and planner for contexts without thread', async () => {
      await fc.assert(
        fc.asyncProperty(fullContextNoThreadArb, async (context) => {
          // Act
          const result = await coordinator.execute(context, 'Iniciar nuevo feature');
          const plan = coordinator.getExecutionPlan(result);

          // Assert
          expect(result.success).toBe(true);
          expect(plan).not.toBeNull();
          expect(plan!.agents).toContain('architect');
          expect(plan!.agents).toContain('planner');
        }),
        { numRuns: 100 }
      );
    });

    it('should have architect before planner in the execution order', async () => {
      await fc.assert(
        fc.asyncProperty(fullContextNoThreadArb, async (context) => {
          // Act
          const result = await coordinator.execute(context, 'Diseñar nueva funcionalidad');
          const plan = coordinator.getExecutionPlan(result);

          // Assert
          expect(plan).not.toBeNull();
          const architectIndex = plan!.agents.indexOf('architect');
          const plannerIndex = plan!.agents.indexOf('planner');
          
          // Both should be present
          expect(architectIndex).toBeGreaterThanOrEqual(0);
          expect(plannerIndex).toBeGreaterThanOrEqual(0);
          
          // Architect should come before or at the same position as planner
          expect(architectIndex).toBeLessThanOrEqual(plannerIndex);
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * Property: When implementation is required, the Coordinator should
   * include the developer agent in the execution plan.
   */
  describe('Implementation Required → developer', () => {
    it('should include developer when implementation is explicitly requested', async () => {
      // Use specific implementation-related task descriptions
      const implementationTasks = [
        'Implementar la funcionalidad',
        'Escribir el código para esta tarea',
        'Develop the feature now',
        'Code this task please',
        'Implementar el módulo de autenticación',
      ];

      await fc.assert(
        fc.asyncProperty(
          fullContextWithBasicThreadArb,
          fc.constantFrom(...implementationTasks),
          async (context, taskDescription) => {
            // Act
            const result = await coordinator.execute(context, taskDescription);
            const plan = coordinator.getExecutionPlan(result);

            // Assert
            expect(result.success).toBe(true);
            expect(plan).not.toBeNull();
            expect(plan!.agents).toContain('developer');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include developer for threads in open or in_progress state needing implementation', async () => {
      const implementationThreadArb = fc.record({
        threadId: snowflakeIdArb,
        channelId: snowflakeIdArb,
        type: threadTypeArb,
        title: fc.string({ minLength: 1, maxLength: 100 }),
        summary: fc.string({ maxLength: 500 }),
        state: fc.constantFrom('open', 'in_progress') as fc.Arbitrary<ThreadState>,
        decisions: fc.array(decisionArb, { maxLength: 3 }),
        artifacts: fc.array(nonCodeArtifactArb, { maxLength: 2 }), // No code yet
        messageCount: fc.integer({ min: 1, max: 50 }),
        lastSummaryAt: fc.integer({ min: 0, max: 25 }),
      });

      const contextArb = fc.record({
        org: orgContextArb,
        project: projectContextArb,
        thread: implementationThreadArb,
      });

      await fc.assert(
        fc.asyncProperty(contextArb, async (context) => {
          // Act
          const result = await coordinator.execute(context, 'Implementar esta tarea');
          const plan = coordinator.getExecutionPlan(result);

          // Assert
          expect(result.success).toBe(true);
          expect(plan).not.toBeNull();
          expect(plan!.agents).toContain('developer');
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * Property: When there is existing code in the thread, the Coordinator
   * should include reviewer and qa agents.
   */
  describe('Existing Code → [reviewer, qa]', () => {
    it('should include reviewer and qa when thread has code artifacts', async () => {
      await fc.assert(
        fc.asyncProperty(fullContextWithCodeArb, async (context) => {
          // Act
          const result = await coordinator.execute(context, 'Revisar el código existente');
          const plan = coordinator.getExecutionPlan(result);

          // Assert
          expect(result.success).toBe(true);
          expect(plan).not.toBeNull();
          expect(plan!.agents).toContain('reviewer');
          expect(plan!.agents).toContain('qa');
        }),
        { numRuns: 100 }
      );
    });

    it('should include both reviewer and qa together for code review', async () => {
      await fc.assert(
        fc.asyncProperty(fullContextWithCodeArb, async (context) => {
          // Act
          const result = await coordinator.execute(context, 'Evaluar calidad del código');
          const plan = coordinator.getExecutionPlan(result);

          // Assert
          expect(plan).not.toBeNull();
          
          const hasReviewer = plan!.agents.includes('reviewer');
          const hasQA = plan!.agents.includes('qa');
          
          // Both should be present when there's code
          expect(hasReviewer && hasQA).toBe(true);
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 4.5**
   *
   * Property: When code is approved, the Coordinator should include
   * the devops agent for deployment.
   */
  describe('Approved Code → devops', () => {
    it('should include devops when code has been approved', async () => {
      await fc.assert(
        fc.asyncProperty(fullContextWithApprovedCodeArb, async (context) => {
          // Act
          const result = await coordinator.execute(context, 'Proceder con deployment');
          const plan = coordinator.getExecutionPlan(result);

          // Assert
          expect(result.success).toBe(true);
          expect(plan).not.toBeNull();
          expect(plan!.agents).toContain('devops');
        }),
        { numRuns: 100 }
      );
    });

    it('should prioritize devops for approved code over other agents', async () => {
      await fc.assert(
        fc.asyncProperty(fullContextWithApprovedCodeArb, async (context) => {
          // Act
          const result = await coordinator.execute(context, 'Deploy aprobado');
          const plan = coordinator.getExecutionPlan(result);

          // Assert
          expect(plan).not.toBeNull();
          
          // DevOps should be the primary agent for approved code
          expect(plan!.agents).toContain('devops');
          
          // The plan should be focused on deployment
          expect(plan!.agents.length).toBeGreaterThanOrEqual(1);
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 4.2, 4.3, 4.4, 4.5**
   *
   * Property: The execution plan should always contain valid agent roles
   * and have a non-empty reason.
   */
  describe('Plan Validity', () => {
    const validRoles: AgentRole[] = ['coordinator', 'architect', 'planner', 'developer', 'reviewer', 'qa', 'devops', 'memory'];

    it('should always produce plans with valid agent roles', async () => {
      const anyContextArb = fc.oneof(
        fullContextNoThreadArb,
        fullContextWithBasicThreadArb,
        fullContextWithCodeArb,
        fullContextWithApprovedCodeArb
      );

      await fc.assert(
        fc.asyncProperty(
          anyContextArb,
          fc.string({ minLength: 1, maxLength: 200 }),
          async (context, taskDescription) => {
            // Act
            const result = await coordinator.execute(context, taskDescription);
            const plan = coordinator.getExecutionPlan(result);

            // Assert
            expect(result.success).toBe(true);
            expect(plan).not.toBeNull();
            
            // All agents in the plan should be valid roles
            for (const agent of plan!.agents) {
              expect(validRoles).toContain(agent);
            }
            
            // Plan should have at least one agent
            expect(plan!.agents.length).toBeGreaterThan(0);
            
            // Plan should have a reason
            expect(plan!.reason).toBeDefined();
            expect(plan!.reason.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never include coordinator in the execution plan (coordinator decides, does not execute)', async () => {
      const anyContextArb = fc.oneof(
        fullContextNoThreadArb,
        fullContextWithBasicThreadArb,
        fullContextWithCodeArb,
        fullContextWithApprovedCodeArb
      );

      await fc.assert(
        fc.asyncProperty(anyContextArb, async (context) => {
          // Act
          const result = await coordinator.execute(context, 'Cualquier tarea');
          const plan = coordinator.getExecutionPlan(result);

          // Assert
          expect(plan).not.toBeNull();
          
          // Coordinator should not be in its own execution plan
          expect(plan!.agents).not.toContain('coordinator');
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 4.2, 4.3, 4.4, 4.5**
   *
   * Property: The routing decision should be deterministic for the same context state.
   */
  describe('Routing Determinism', () => {
    it('should produce consistent routing for the same thread state category', async () => {
      // Test that new threads always get architect + planner
      await fc.assert(
        fc.asyncProperty(
          fullContextNoThreadArb,
          fullContextNoThreadArb,
          async (context1, context2) => {
            const result1 = await coordinator.execute(context1, 'Nueva tarea');
            const result2 = await coordinator.execute(context2, 'Nueva tarea');
            
            const plan1 = coordinator.getExecutionPlan(result1);
            const plan2 = coordinator.getExecutionPlan(result2);

            // Both should have architect and planner
            expect(plan1!.agents).toContain('architect');
            expect(plan1!.agents).toContain('planner');
            expect(plan2!.agents).toContain('architect');
            expect(plan2!.agents).toContain('planner');
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});


// ============================================================================
// Property 5: Output de agentes contiene secciones requeridas por rol
// **Validates: Requirements 4.6, 4.7, 4.9, 4.10, 4.11, 4.12**
// ============================================================================

/**
 * Mock LLM responses for each agent type to test parsing logic.
 * These responses simulate what the LLM would return for each agent role.
 */
const mockAgentResponses = {
  architect: `## Overview
Esta es una arquitectura de microservicios para el sistema de autenticación.

## Componentes
| Componente | Responsabilidad | Tecnología |
|------------|-----------------|------------|
| AuthService | Manejo de autenticación | Node.js |
| UserDB | Almacenamiento de usuarios | PostgreSQL |
| TokenCache | Cache de tokens JWT | Redis |

## Flujo de Datos
Usuario → AuthService → UserDB → TokenCache → Usuario

## Riesgos
| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Token leak | Alto | Rotación de tokens |
| DB failure | Medio | Replicación |`,

  planner: `## Tareas
| # | Tarea | Descripción | Complejidad |
|---|-------|-------------|-------------|
| 1 | Setup proyecto | Inicializar estructura | simple |
| 2 | Implementar auth | Crear servicio de auth | media |
| 3 | Tests | Escribir tests unitarios | simple |

## Dependencias
| Tarea | Depende de |
|-------|------------|
| 1 | - |
| 2 | 1 |
| 3 | 2 |

## Edge Cases
- [ ] Usuario sin email
- [ ] Token expirado
- [ ] Múltiples sesiones

## Complejidad Total
Estimación: 3-5 días
Ruta crítica: 1 → 2 → 3
Riesgos: Integración con servicios externos`,

  reviewer: `## Issues Encontrados
| # | Severidad | Categoría | Descripción | Línea |
|---|-----------|-----------|-------------|-------|
| 1 | 🔴 Alta | Seguridad | SQL injection posible | 45 |
| 2 | 🟡 Media | Performance | N+1 query | 78 |
| 3 | 🟢 Baja | Style | Variable sin usar | 12 |

## Severidad
- Alta: Problemas críticos de seguridad o funcionalidad
- Media: Problemas de rendimiento o mantenibilidad
- Baja: Problemas de estilo o mejoras menores

## Sugerencias de Fix
#### Issue #1: SQL Injection
// Antes
\`\`\`typescript
const query = "SELECT * FROM users WHERE id = " + userId;
\`\`\`
// Después
\`\`\`typescript
const query = "SELECT * FROM users WHERE id = $1";
\`\`\`

## Veredicto
❌ REJECT
Razón: Vulnerabilidad de seguridad crítica debe ser corregida
[ ] Corregir SQL injection
[ ] Optimizar queries N+1`,

  qa: `## Test Cases
| # | Nombre | Descripción | Input | Output Esperado | Tipo |
|---|--------|-------------|-------|-----------------|------|
| 1 | Login válido | Usuario con credenciales correctas | {user, pass} | token JWT | unit |
| 2 | Login inválido | Credenciales incorrectas | {user, wrong} | error 401 | unit |
| 3 | Flujo completo | Login y acceso a recurso | {user, pass} | recurso | integration |

#### Implementación de Tests
\`\`\`typescript
describe('AuthService', () => {
  it('should return JWT for valid credentials', async () => {
    const result = await authService.login('user', 'pass');
    expect(result.token).toBeDefined();
  });
});
\`\`\`

## Edge Cases
| # | Caso | Condición | Comportamiento Esperado |
|---|------|-----------|------------------------|
| 1 | Email vacío | email = '' | Error de validación |
| 2 | Password corto | len < 8 | Error de validación |
| 3 | Usuario bloqueado | attempts > 5 | Error 403 |

## Failure Scenarios
| # | Escenario | Causa | Comportamiento | Recuperación |
|---|-----------|-------|----------------|--------------|
| 1 | DB caída | Postgres down | Retry con backoff | Failover a replica |
| 2 | Redis timeout | Cache lento | Bypass cache | Usar DB directamente |
| 3 | Token inválido | JWT corrupto | Error 401 | Re-login |`,

  devops: `## Build Steps
| # | Paso | Comando | Descripción |
|---|------|---------|-------------|
| 1 | Install | \`npm ci\` | Instalar dependencias |
| 2 | Lint | \`npm run lint\` | Verificar código |
| 3 | Test | \`npm test\` | Ejecutar tests |
| 4 | Build | \`npm run build\` | Compilar TypeScript |

#### Scripts de Build
\`\`\`bash
#!/bin/bash
npm ci
npm run lint
npm test
npm run build
\`\`\`

## CI/CD Configuration
Plataforma: GitHub Actions
\`\`\`yaml
name: CI/CD Pipeline
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm test
      - run: npm run build
\`\`\`

## Deployment Strategy
| Aspecto | Configuración |
|---------|---------------|
| Estrategia | Rolling deployment |
| Ambiente | staging → production |
| Rollback | Automático en fallo de health check |
| Health Checks | /health, /ready |
| Secrets | AWS Secrets Manager |

#### Plan de Deployment
Pre-deployment: Backup de base de datos
Deployment: Rolling update con 2 replicas
Post-deployment: Smoke tests automáticos
Rollback: Revert a versión anterior`,

  memory: `{
  "memories": [
    {
      "type": "decision",
      "content": {
        "title": "Usar JWT para autenticación",
        "description": "Se decidió usar JWT en lugar de sesiones para mejor escalabilidad",
        "context": "Discusión sobre arquitectura de auth"
      },
      "tags": ["auth", "jwt", "arquitectura"],
      "importance": "high"
    },
    {
      "type": "pattern",
      "content": {
        "name": "Repository Pattern",
        "description": "Usar repository pattern para acceso a datos"
      },
      "tags": ["pattern", "data-access"],
      "importance": "medium"
    }
  ],
  "metadata": {
    "extractedAt": "2024-01-15T10:30:00Z",
    "sourceMessages": 25,
    "confidence": 0.85
  }
}`
};

/**
 * Creates a mock for testing agent output parsing.
 * This allows us to test the parsing logic without calling the actual LLM.
 */
function createAgentMock(agentRole: string, mockResponse: string) {
  return vi.fn().mockImplementation(async () => mockResponse);
}

describe('Property 5: Output de agentes contiene secciones requeridas por rol', () => {
  // Reuse the context arbitraries from Property 4
  const anyContextArb = fc.oneof(
    fullContextNoThreadArb,
    fullContextWithBasicThreadArb,
    fullContextWithCodeArb,
    fullContextWithApprovedCodeArb
  );

  /**
   * **Validates: Requirements 4.6**
   *
   * Property: Architect agent output must contain:
   * - overview: General description of the proposed solution
   * - components: Table of components with responsibilities and technologies
   * - dataFlow: ASCII diagram or description of data flow
   * - risks: Table of risks with impact and mitigation
   */
  describe('Architect → [overview, components, dataFlow, risks]', () => {
    it('should parse architect output with all required sections', async () => {
      // Import the ArchitectAgent dynamically to avoid mock interference
      const { ArchitectAgent } = await import('./architect-agent.js');
      
      await fc.assert(
        fc.asyncProperty(anyContextArb, async (context) => {
          // Create a new instance and mock the executeWithRetry method
          const architect = new ArchitectAgent();
          
          // Mock the LLM response
          (architect as unknown as { executeWithRetry: (prompt: string) => Promise<string> }).executeWithRetry = 
            async () => mockAgentResponses.architect;
          
          // Execute the agent
          const result = await architect.execute(context, 'Diseñar arquitectura del sistema');
          const output = architect.getArchitectOutput(result);
          
          // Assert all required sections are present
          expect(result.success).toBe(true);
          expect(output).not.toBeNull();
          
          // Overview section
          expect(output!.overview).toBeDefined();
          expect(typeof output!.overview).toBe('string');
          expect(output!.overview.length).toBeGreaterThan(0);
          
          // Components section
          expect(output!.components).toBeDefined();
          expect(Array.isArray(output!.components)).toBe(true);
          expect(output!.components.length).toBeGreaterThan(0);
          
          // Each component should have name, responsibility, technology
          for (const component of output!.components) {
            expect(component.name).toBeDefined();
            expect(component.responsibility).toBeDefined();
            expect(component.technology).toBeDefined();
          }
          
          // DataFlow section
          expect(output!.dataFlow).toBeDefined();
          expect(typeof output!.dataFlow).toBe('string');
          
          // Risks section
          expect(output!.risks).toBeDefined();
          expect(Array.isArray(output!.risks)).toBe(true);
          
          // Each risk should have description, impact, mitigation
          for (const risk of output!.risks) {
            expect(risk.description).toBeDefined();
            expect(risk.impact).toBeDefined();
            expect(['Alto', 'Medio', 'Bajo']).toContain(risk.impact);
            expect(risk.mitigation).toBeDefined();
          }
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 4.7**
   *
   * Property: Planner agent output must contain:
   * - tasks: Ordered list of atomic tasks with complexity
   * - dependencies: DAG of task dependencies
   * - edgeCases: Special cases to consider
   * - complexity: Total estimation and critical path
   */
  describe('Planner → [tasks, dependencies, edgeCases, complexity]', () => {
    it('should parse planner output with all required sections', async () => {
      const { PlannerAgent } = await import('./planner-agent.js');
      
      await fc.assert(
        fc.asyncProperty(anyContextArb, async (context) => {
          const planner = new PlannerAgent();
          
          // Mock the LLM response
          (planner as unknown as { executeWithRetry: (prompt: string) => Promise<string> }).executeWithRetry = 
            async () => mockAgentResponses.planner;
          
          const result = await planner.execute(context, 'Planificar implementación del feature');
          const output = planner.getPlannerOutput(result);
          
          expect(result.success).toBe(true);
          expect(output).not.toBeNull();
          
          // Tasks section
          expect(output!.tasks).toBeDefined();
          expect(Array.isArray(output!.tasks)).toBe(true);
          expect(output!.tasks.length).toBeGreaterThan(0);
          
          // Each task should have id, name, description, complexity
          for (const task of output!.tasks) {
            expect(task.id).toBeDefined();
            expect(typeof task.id).toBe('number');
            expect(task.name).toBeDefined();
            expect(task.description).toBeDefined();
            expect(task.complexity).toBeDefined();
            expect(['trivial', 'simple', 'media', 'compleja', 'muy compleja']).toContain(task.complexity);
          }
          
          // Dependencies section
          expect(output!.dependencies).toBeDefined();
          expect(Array.isArray(output!.dependencies)).toBe(true);
          
          // Each dependency should have taskId and dependsOn
          for (const dep of output!.dependencies) {
            expect(dep.taskId).toBeDefined();
            expect(typeof dep.taskId).toBe('number');
            expect(dep.dependsOn).toBeDefined();
            expect(Array.isArray(dep.dependsOn)).toBe(true);
          }
          
          // Edge Cases section
          expect(output!.edgeCases).toBeDefined();
          expect(Array.isArray(output!.edgeCases)).toBe(true);
          
          // Complexity section
          expect(output!.complexity).toBeDefined();
          expect(output!.complexity.totalTasks).toBeDefined();
          expect(typeof output!.complexity.totalTasks).toBe('number');
          expect(output!.complexity.estimatedDays).toBeDefined();
          expect(output!.complexity.criticalPath).toBeDefined();
          expect(Array.isArray(output!.complexity.criticalPath)).toBe(true);
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 4.9**
   *
   * Property: Reviewer agent output must contain:
   * - issues: Table with severity, category, description, line
   * - suggestions: Code fixes for each issue
   * - verdict: APPROVE or REJECT with justification
   */
  describe('Reviewer → [issues, suggestions, verdict]', () => {
    it('should parse reviewer output with all required sections', async () => {
      const { ReviewerAgent } = await import('./reviewer-agent.js');
      
      await fc.assert(
        fc.asyncProperty(anyContextArb, async (context) => {
          const reviewer = new ReviewerAgent();
          
          // Mock the LLM response
          (reviewer as unknown as { executeWithRetry: (prompt: string) => Promise<string> }).executeWithRetry = 
            async () => mockAgentResponses.reviewer;
          
          const result = await reviewer.execute(context, 'Revisar código del PR');
          const output = reviewer.getReviewerOutput(result);
          
          expect(result.success).toBe(true);
          expect(output).not.toBeNull();
          
          // Issues section
          expect(output!.issues).toBeDefined();
          expect(Array.isArray(output!.issues)).toBe(true);
          
          // Each issue should have id, severity, category, description
          for (const issue of output!.issues) {
            expect(issue.id).toBeDefined();
            expect(typeof issue.id).toBe('number');
            expect(issue.severity).toBeDefined();
            expect(['Alta', 'Media', 'Baja']).toContain(issue.severity);
            expect(issue.category).toBeDefined();
            expect(issue.description).toBeDefined();
          }
          
          // Suggestions section
          expect(output!.suggestions).toBeDefined();
          expect(Array.isArray(output!.suggestions)).toBe(true);
          
          // Verdict section
          expect(output!.verdict).toBeDefined();
          expect(output!.verdict.decision).toBeDefined();
          expect(['APPROVE', 'REJECT']).toContain(output!.verdict.decision);
          expect(output!.verdict.reason).toBeDefined();
          expect(typeof output!.verdict.reason).toBe('string');
        }),
        { numRuns: 50 }
      );
    });

    it('should correctly identify approval status', async () => {
      const { ReviewerAgent } = await import('./reviewer-agent.js');
      
      await fc.assert(
        fc.asyncProperty(anyContextArb, async (context) => {
          const reviewer = new ReviewerAgent();
          
          // Mock the LLM response
          (reviewer as unknown as { executeWithRetry: (prompt: string) => Promise<string> }).executeWithRetry = 
            async () => mockAgentResponses.reviewer;
          
          const result = await reviewer.execute(context, 'Revisar código');
          
          // The mock response has REJECT verdict
          expect(reviewer.isApproved(result)).toBe(false);
        }),
        { numRuns: 20 }
      );
    });
  });

  /**
   * **Validates: Requirements 4.10**
   *
   * Property: QA agent output must contain:
   * - testCases: Table with name, description, input, expected output, type
   * - edgeCases: Table with case, condition, expected behavior
   * - failureScenarios: Table with scenario, cause, expected behavior, recovery
   */
  describe('QA → [testCases, edgeCases, failureScenarios]', () => {
    it('should parse QA output with all required sections', async () => {
      const { QAAgent } = await import('./qa-agent.js');
      
      await fc.assert(
        fc.asyncProperty(anyContextArb, async (context) => {
          const qa = new QAAgent();
          
          // Mock the LLM response
          (qa as unknown as { executeWithRetry: (prompt: string) => Promise<string> }).executeWithRetry = 
            async () => mockAgentResponses.qa;
          
          const result = await qa.execute(context, 'Generar casos de test');
          const output = qa.getQAOutput(result);
          
          expect(result.success).toBe(true);
          expect(output).not.toBeNull();
          
          // Test Cases section
          expect(output!.testCases).toBeDefined();
          expect(Array.isArray(output!.testCases)).toBe(true);
          
          // Each test case should have required fields
          for (const testCase of output!.testCases) {
            expect(testCase.id).toBeDefined();
            expect(typeof testCase.id).toBe('number');
            expect(testCase.name).toBeDefined();
            expect(testCase.description).toBeDefined();
            expect(testCase.input).toBeDefined();
            expect(testCase.expectedOutput).toBeDefined();
            expect(testCase.type).toBeDefined();
            expect(['unit', 'integration', 'e2e']).toContain(testCase.type);
          }
          
          // Edge Cases section
          expect(output!.edgeCases).toBeDefined();
          expect(Array.isArray(output!.edgeCases)).toBe(true);
          
          // Each edge case should have required fields
          for (const edgeCase of output!.edgeCases) {
            expect(edgeCase.id).toBeDefined();
            expect(typeof edgeCase.id).toBe('number');
            expect(edgeCase.case).toBeDefined();
            expect(edgeCase.condition).toBeDefined();
            expect(edgeCase.expectedBehavior).toBeDefined();
          }
          
          // Failure Scenarios section
          expect(output!.failureScenarios).toBeDefined();
          expect(Array.isArray(output!.failureScenarios)).toBe(true);
          
          // Each failure scenario should have required fields
          for (const scenario of output!.failureScenarios) {
            expect(scenario.id).toBeDefined();
            expect(typeof scenario.id).toBe('number');
            expect(scenario.scenario).toBeDefined();
            expect(scenario.cause).toBeDefined();
            expect(scenario.expectedBehavior).toBeDefined();
            expect(scenario.recovery).toBeDefined();
          }
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 4.11**
   *
   * Property: DevOps agent output must contain:
   * - buildSteps: Table with step, command, description
   * - cicdConfig: YAML configuration for the platform
   * - deploymentStrategy: Table with aspect and configuration
   */
  describe('DevOps → [buildSteps, cicdConfig, deploymentStrategy]', () => {
    it('should parse DevOps output with all required sections', async () => {
      const { DevOpsAgent } = await import('./devops-agent.js');
      
      await fc.assert(
        fc.asyncProperty(anyContextArb, async (context) => {
          const devops = new DevOpsAgent();
          
          // Mock the LLM response
          (devops as unknown as { executeWithRetry: (prompt: string) => Promise<string> }).executeWithRetry = 
            async () => mockAgentResponses.devops;
          
          const result = await devops.execute(context, 'Configurar CI/CD y deployment');
          const output = devops.getDevOpsOutput(result);
          
          expect(result.success).toBe(true);
          expect(output).not.toBeNull();
          
          // Build Steps section
          expect(output!.buildSteps).toBeDefined();
          expect(Array.isArray(output!.buildSteps)).toBe(true);
          expect(output!.buildSteps.length).toBeGreaterThan(0);
          
          // Each build step should have required fields
          for (const step of output!.buildSteps) {
            expect(step.id).toBeDefined();
            expect(typeof step.id).toBe('number');
            expect(step.step).toBeDefined();
            expect(step.command).toBeDefined();
          }
          
          // CI/CD Config section
          expect(output!.cicdConfig).toBeDefined();
          expect(output!.cicdConfig.platform).toBeDefined();
          expect(['github-actions', 'gitlab-ci', 'jenkins', 'other']).toContain(output!.cicdConfig.platform);
          expect(output!.cicdConfig.yaml).toBeDefined();
          expect(typeof output!.cicdConfig.yaml).toBe('string');
          expect(output!.cicdConfig.yaml.length).toBeGreaterThan(0);
          
          // Deployment Strategy section
          expect(output!.deploymentStrategy).toBeDefined();
          expect(output!.deploymentStrategy.strategy).toBeDefined();
          expect(['blue-green', 'rolling', 'canary', 'recreate']).toContain(output!.deploymentStrategy.strategy);
          expect(output!.deploymentStrategy.environment).toBeDefined();
          expect(output!.deploymentStrategy.rollback).toBeDefined();
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 4.12**
   *
   * Property: Memory agent output must contain:
   * - memories: Array of extracted memories with type, content, tags, importance
   * - metadata: Object with extractedAt, sourceMessages, confidence
   */
  describe('Memory → [memories, metadata]', () => {
    it('should parse Memory output with all required sections', async () => {
      const { MemoryAgent } = await import('./memory-agent.js');
      
      await fc.assert(
        fc.asyncProperty(anyContextArb, async (context) => {
          const memory = new MemoryAgent();
          
          // Mock the LLM response
          (memory as unknown as { executeWithRetry: (prompt: string) => Promise<string> }).executeWithRetry = 
            async () => mockAgentResponses.memory;
          
          const result = await memory.execute(context, 'Extraer conocimiento del hilo');
          const extraction = memory.getMemoryExtraction(result);
          
          expect(result.success).toBe(true);
          expect(extraction).not.toBeNull();
          
          // Memories section
          expect(extraction!.memories).toBeDefined();
          expect(Array.isArray(extraction!.memories)).toBe(true);
          expect(extraction!.memories.length).toBeGreaterThan(0);
          
          // Each memory should have required fields
          for (const mem of extraction!.memories) {
            expect(mem.type).toBeDefined();
            expect(['decision', 'pattern', 'error', 'summary']).toContain(mem.type);
            expect(mem.content).toBeDefined();
            expect(typeof mem.content).toBe('object');
            expect(mem.tags).toBeDefined();
            expect(Array.isArray(mem.tags)).toBe(true);
            expect(mem.importance).toBeDefined();
            expect(['high', 'medium', 'low']).toContain(mem.importance);
          }
          
          // Metadata section
          expect(extraction!.metadata).toBeDefined();
          expect(extraction!.metadata.extractedAt).toBeDefined();
          expect(typeof extraction!.metadata.extractedAt).toBe('string');
          expect(extraction!.metadata.sourceMessages).toBeDefined();
          expect(typeof extraction!.metadata.sourceMessages).toBe('number');
          expect(extraction!.metadata.confidence).toBeDefined();
          expect(typeof extraction!.metadata.confidence).toBe('number');
          expect(extraction!.metadata.confidence).toBeGreaterThanOrEqual(0);
          expect(extraction!.metadata.confidence).toBeLessThanOrEqual(1);
        }),
        { numRuns: 50 }
      );
    });

    it('should prepare persistence data for dual-write', async () => {
      const { MemoryAgent } = await import('./memory-agent.js');
      
      await fc.assert(
        fc.asyncProperty(anyContextArb, async (context) => {
          const memory = new MemoryAgent();
          
          // Mock the LLM response
          (memory as unknown as { executeWithRetry: (prompt: string) => Promise<string> }).executeWithRetry = 
            async () => mockAgentResponses.memory;
          
          const result = await memory.execute(context, 'Extraer conocimiento');
          const persistenceData = memory.getPersistenceData(result);
          
          expect(persistenceData).not.toBeNull();
          
          // Entries for PostgresStore
          expect(persistenceData!.entries).toBeDefined();
          expect(Array.isArray(persistenceData!.entries)).toBe(true);
          
          // Each entry should have required fields for PostgresStore
          for (const entry of persistenceData!.entries) {
            expect(entry.id).toBeDefined();
            expect(entry.threadId).toBeDefined();
            expect(entry.type).toBeDefined();
            expect(entry.content).toBeDefined();
            expect(entry.timestamp).toBeDefined();
          }
          
          // Vector metadata for VectorStore
          expect(persistenceData!.vectorMetadata).toBeDefined();
          expect(Array.isArray(persistenceData!.vectorMetadata)).toBe(true);
          
          // Each vector metadata should have required fields
          for (const meta of persistenceData!.vectorMetadata) {
            expect(meta.threadId).toBeDefined();
            expect(meta.type).toBeDefined();
            expect(meta.content).toBeDefined();
            expect(meta.timestamp).toBeDefined();
          }
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 4.6, 4.7, 4.9, 4.10, 4.11, 4.12**
   *
   * Property: All agents should handle malformed LLM responses gracefully
   * by providing fallback/default values for missing sections.
   */
  describe('Graceful Handling of Malformed Responses', () => {
    // Create a sample context for testing malformed responses
    const sampleContext: FullContext = {
      org: {
        guildId: '123456789012345678',
        standards: ['TypeScript', 'ESLint'],
        architecture: ['Microservices'],
      },
      project: {
        channelId: '123456789012345679',
        guildId: '123456789012345678',
        name: 'Test Project',
        stack: ['TypeScript', 'Node.js'],
        rules: ['Use strict mode'],
      },
    };

    it('should handle empty or malformed architect response', async () => {
      const { ArchitectAgent } = await import('./architect-agent.js');
      
      const architect = new ArchitectAgent();
      (architect as unknown as { executeWithRetry: (prompt: string) => Promise<string> }).executeWithRetry = 
        async () => 'This is not a valid architect response';
      
      const result = await architect.execute(sampleContext, 'Test');
      const output = architect.getArchitectOutput(result);
      
      expect(result.success).toBe(true);
      expect(output).not.toBeNull();
      // Should have default/empty values for missing sections
      expect(output!.overview).toBeDefined();
      expect(output!.components).toBeDefined();
      expect(output!.dataFlow).toBeDefined();
      expect(output!.risks).toBeDefined();
    });

    it('should handle empty or malformed planner response', async () => {
      const { PlannerAgent } = await import('./planner-agent.js');
      
      const planner = new PlannerAgent();
      (planner as unknown as { executeWithRetry: (prompt: string) => Promise<string> }).executeWithRetry = 
        async () => 'Invalid planner output';
      
      const result = await planner.execute(sampleContext, 'Test');
      const output = planner.getPlannerOutput(result);
      
      expect(result.success).toBe(true);
      expect(output).not.toBeNull();
      expect(output!.tasks).toBeDefined();
      expect(output!.dependencies).toBeDefined();
      expect(output!.edgeCases).toBeDefined();
      expect(output!.complexity).toBeDefined();
    });

    it('should handle empty or malformed memory response with fallback extraction', async () => {
      const { MemoryAgent } = await import('./memory-agent.js');
      
      const memory = new MemoryAgent();
      (memory as unknown as { executeWithRetry: (prompt: string) => Promise<string> }).executeWithRetry = 
        async () => 'Se tomó una decisión importante sobre la arquitectura';
      
      const result = await memory.execute(sampleContext, 'Test');
      const extraction = memory.getMemoryExtraction(result);
      
      expect(result.success).toBe(true);
      expect(extraction).not.toBeNull();
      // Should have fallback extraction with detected content
      expect(extraction!.memories).toBeDefined();
      expect(extraction!.memories.length).toBeGreaterThan(0);
      expect(extraction!.metadata).toBeDefined();
      // Fallback should have low confidence
      expect(extraction!.metadata.confidence).toBeLessThan(0.5);
    });
  });
});
