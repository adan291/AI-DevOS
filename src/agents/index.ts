/**
 * Agents Module
 * 
 * Exports the agent system components:
 * - BaseAgent: Abstract base class with Claude API integration
 * - AgentFactory: Factory for creating agents by role
 * - Agent registration utilities
 * - Individual agent implementations (all 8 agents)
 */

// Base agent class
export { 
  BaseAgent, 
  AgentTimeoutError, 
  InvalidResponseError 
} from './base-agent.js';

// Agent factory and utilities
export { 
  AgentFactory, 
  registerAgent, 
  isAgentRegistered, 
  getRegisteredRoles,
  getAgent,
  AGENT_ROLES 
} from './agent-factory.js';

// Agent implementations
export { CoordinatorAgent } from './coordinator-agent.js';
export { 
  MemoryAgent,
  type MemoryExtractionResult,
  type ExtractedMemory,
  type MemoryPersistenceData,
} from './memory-agent.js';
export { 
  ArchitectAgent,
  type ArchitectOutput,
  type ComponentDefinition,
  type RiskDefinition,
} from './architect-agent.js';
export { 
  PlannerAgent,
  type PlannerOutput,
  type TaskDefinition,
  type TaskDependency,
  type ComplexityEstimate,
} from './planner-agent.js';
export { 
  DeveloperAgent,
  type DeveloperOutput,
  type CodeImplementation,
  type FileChange,
  type DependencyRequirement,
} from './developer-agent.js';
export { 
  ReviewerAgent,
  type ReviewerOutput,
  type ReviewIssue,
  type FixSuggestion,
  type ReviewVerdict,
} from './reviewer-agent.js';
export { 
  QAAgent,
  type QAOutput,
  type TestCase,
  type EdgeCase,
  type FailureScenario,
  type TestImplementation,
} from './qa-agent.js';
export { 
  DevOpsAgent,
  type DevOpsOutput,
  type BuildStep,
  type CICDConfig,
  type DeploymentStrategy,
  type DeploymentPlan,
} from './devops-agent.js';

// Re-export types for convenience
export type { Agent, AgentRole, AgentResult, ExecutionPlan } from '../types/agents.js';
