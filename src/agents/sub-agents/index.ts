/**
 * Sub-Agents Module
 * 
 * Specialized sub-agents for each main agent role.
 */

export { 
  SubAgentRegistry, 
  subAgentRegistry, 
  SpecializedSubAgent, 
  createSubAgent, 
  getSubAgent,
  type SubAgentSpec 
} from './sub-agent.js';

export { registerArchitectSubAgents } from './architect-subs.js';
export { registerDeveloperSubAgents } from './developer-subs.js';

// Register all sub-agents on import
import { registerArchitectSubAgents } from './architect-subs.js';
import { registerDeveloperSubAgents } from './developer-subs.js';

registerArchitectSubAgents();
registerDeveloperSubAgents();

// Log registered sub-agents
import { subAgentRegistry } from './sub-agent.js';
console.log('[SubAgents] Registered:', subAgentRegistry.list().join(', '));
