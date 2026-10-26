// Orchestrator module - Event routing and agent execution
export { DefaultEventRouter, createEventRouter } from './event-router.js';
export { DefaultContextLoader, createContextLoader } from './context-loader.js';
export { 
  DefaultPromptBuilder, 
  createPromptBuilder, 
  GLOBAL_PROMPT, 
  STEERING_RULES 
} from './prompt-builder.js';
export {
  DefaultAgentExecutor,
  createAgentExecutor,
  type Logger,
  type DiscordNotifier,
  type AgentExecutorConfig,
  type ExecutionResult,
} from './agent-executor.js';
export {
  DefaultResponseManager,
  createResponseManager,
  type ResponseManagerConfig,
  type ResponseManagerLogger,
  type ErrorNotification,
} from './response-manager.js';
export {
  DefaultOrchestrator,
  createOrchestrator,
  type OrchestratorConfig,
  type OrchestratorLogger,
} from './orchestrator.js';
export {
  DefaultReactionHandler,
  createReactionHandler,
  mapReactionToAgent,
  type ReactionHandler,
  type ReactionMapping,
  type ReactionContext,
} from './reaction-handler.js';
export {
  DefaultThreadHandler,
  createThreadHandler,
  classifyThread,
  type ThreadHandler,
  type ThreadClassification,
} from './thread-handler.js';
export {
  DefaultSlashCommandHandler,
  createSlashCommandHandler,
  mapCommandToAgents,
  createPlanFromCommand,
  type SlashCommandHandler,
  type CommandMapping,
} from './slash-command-handler.js';
export {
  DefaultAutoSummaryHandler,
  createAutoSummaryHandler,
  shouldTriggerSummary,
  AUTO_SUMMARY_THRESHOLD,
  type AutoSummaryHandler,
  type AutoSummaryConfig,
  type AutoSummaryResult,
} from './auto-summary.js';
export {
  DefaultErrorDetectorHandler,
  createErrorDetectorHandler,
  detectError,
  type ErrorDetectorHandler,
  type ErrorDetectionResult,
} from './error-detector.js';
export {
  DefaultDebateManager,
  createDebateManager,
  DEBATE_MAX_TURNS,
  type DebateManager,
  type DebateConfig,
  type DebateTurn,
  type DebateResult,
} from './debate-manager.js';
