/**
 * Agent Factory
 * 
 * Factory that instantiates agents by role.
 * Supports all 8 agent roles defined in the system.
 */

import type { Agent, AgentRole } from '../types/agents.js';

/** Registry of agent constructors by role */
type AgentConstructor = new () => Agent;
const agentRegistry = new Map<AgentRole, AgentConstructor>();

/**
 * Register an agent constructor for a specific role.
 * Used by individual agent implementations to register themselves.
 */
export function registerAgent(role: AgentRole, constructor: AgentConstructor): void {
  agentRegistry.set(role, constructor);
}

/**
 * Check if an agent is registered for a specific role.
 */
export function isAgentRegistered(role: AgentRole): boolean {
  return agentRegistry.has(role);
}

/**
 * Get all registered agent roles.
 */
export function getRegisteredRoles(): AgentRole[] {
  return Array.from(agentRegistry.keys());
}

/**
 * Agent Factory - creates agent instances by role.
 */
export class AgentFactory {
  private static instance: AgentFactory;
  private agentCache: Map<AgentRole, Agent> = new Map();
  
  private constructor() {}
  
  /**
   * Get the singleton instance of the AgentFactory.
   */
  static getInstance(): AgentFactory {
    if (!AgentFactory.instance) {
      AgentFactory.instance = new AgentFactory();
    }
    return AgentFactory.instance;
  }
  
  /**
   * Create or retrieve an agent by role.
   * Agents are cached for reuse.
   * 
   * @param role - The agent role to create
   * @returns The agent instance
   * @throws Error if the role is not registered
   */
  getAgent(role: AgentRole): Agent {
    // Check cache first
    const cached = this.agentCache.get(role);
    if (cached) {
      return cached;
    }
    
    // Create new agent
    const agent = this.createAgent(role);
    this.agentCache.set(role, agent);
    return agent;
  }
  
  /**
   * Create a new agent instance by role.
   * 
   * @param role - The agent role to create
   * @returns A new agent instance
   * @throws Error if the role is not registered
   */
  createAgent(role: AgentRole): Agent {
    const Constructor = agentRegistry.get(role);
    if (!Constructor) {
      throw new Error(`No agent registered for role: ${role}`);
    }
    return new Constructor();
  }
  
  /**
   * Check if an agent can be created for a specific role.
   */
  canCreate(role: AgentRole): boolean {
    return isAgentRegistered(role);
  }
  
  /**
   * Get all roles that can be created.
   */
  getAvailableRoles(): AgentRole[] {
    return getRegisteredRoles();
  }
  
  /**
   * Clear the agent cache. Useful for testing.
   */
  clearCache(): void {
    this.agentCache.clear();
  }
  
  /**
   * Reset the factory instance. Useful for testing.
   */
  static resetInstance(): void {
    AgentFactory.instance = undefined as unknown as AgentFactory;
  }
}

/**
 * Convenience function to get an agent by role.
 */
export function getAgent(role: AgentRole): Agent {
  return AgentFactory.getInstance().getAgent(role);
}

/**
 * Factory function to create an AgentFactory instance.
 */
export function createAgentFactory(): AgentFactory {
  return AgentFactory.getInstance();
}

/**
 * The 8 supported agent roles.
 * Exported for convenience.
 */
export const AGENT_ROLES: readonly AgentRole[] = [
  'coordinator',
  'architect',
  'planner',
  'developer',
  'reviewer',
  'qa',
  'devops',
  'memory',
] as const;
