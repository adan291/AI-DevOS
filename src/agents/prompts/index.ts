/**
 * Agent Prompts Index
 * 
 * Exports all agent prompt configurations for the 8 agent roles.
 * Each prompt defines the agent's role, responsibilities, output rules and expected format.
 * 
 * @validates Requirements 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12
 */

import type { AgentPromptConfig, AgentRole } from '../../types/agents.js';

// Import individual prompt configs
export { 
  coordinatorPromptConfig, 
  COORDINATOR_SYSTEM_PROMPT 
} from './coordinator.js';

export { 
  architectPromptConfig, 
  ARCHITECT_SYSTEM_PROMPT 
} from './architect.js';

export { 
  plannerPromptConfig, 
  PLANNER_SYSTEM_PROMPT 
} from './planner.js';

export { 
  developerPromptConfig, 
  DEVELOPER_SYSTEM_PROMPT 
} from './developer.js';

export { 
  reviewerPromptConfig, 
  REVIEWER_SYSTEM_PROMPT 
} from './reviewer.js';

export { 
  qaPromptConfig, 
  QA_SYSTEM_PROMPT 
} from './qa.js';

export { 
  devopsPromptConfig, 
  DEVOPS_SYSTEM_PROMPT 
} from './devops.js';

export { 
  memoryPromptConfig, 
  MEMORY_SYSTEM_PROMPT 
} from './memory.js';

// Import for registry
import { coordinatorPromptConfig } from './coordinator.js';
import { architectPromptConfig } from './architect.js';
import { plannerPromptConfig } from './planner.js';
import { developerPromptConfig } from './developer.js';
import { reviewerPromptConfig } from './reviewer.js';
import { qaPromptConfig } from './qa.js';
import { devopsPromptConfig } from './devops.js';
import { memoryPromptConfig } from './memory.js';

/**
 * Registry of all agent prompt configurations indexed by role.
 */
export const agentPromptRegistry: Record<AgentRole, AgentPromptConfig> = {
  coordinator: coordinatorPromptConfig,
  architect: architectPromptConfig,
  planner: plannerPromptConfig,
  developer: developerPromptConfig,
  reviewer: reviewerPromptConfig,
  qa: qaPromptConfig,
  devops: devopsPromptConfig,
  memory: memoryPromptConfig,
};

/**
 * Get the prompt configuration for a specific agent role.
 * 
 * @param role - The agent role
 * @returns The prompt configuration for that role
 */
export function getPromptConfig(role: AgentRole): AgentPromptConfig {
  return agentPromptRegistry[role];
}

/**
 * Get the system prompt for a specific agent role.
 * 
 * @param role - The agent role
 * @returns The system prompt string for that role
 */
export function getSystemPrompt(role: AgentRole): string {
  return agentPromptRegistry[role].systemPrompt;
}

/**
 * Get all available prompt configurations.
 * 
 * @returns Array of all prompt configurations
 */
export function getAllPromptConfigs(): AgentPromptConfig[] {
  return Object.values(agentPromptRegistry);
}

/**
 * Check if a prompt configuration exists for a role.
 * 
 * @param role - The agent role to check
 * @returns True if a prompt config exists for the role
 */
export function hasPromptConfig(role: AgentRole): boolean {
  return role in agentPromptRegistry;
}
