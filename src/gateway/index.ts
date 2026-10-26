/**
 * Gateway Module
 * 
 * Discord bot and event normalization components.
 * The Gateway is a proxy without business logic - it captures events,
 * normalizes them, and forwards to the Orchestrator.
 */

// Discord Bot
export { DiscordBot, type Gateway, type EventHandler } from './discord-bot.js';

// Event Normalizer
export {
  normalizeMessageEvent,
  normalizeThreadCreateEvent,
  normalizeReactionAddEvent,
} from './event-normalizer.js';

// Slash Commands
export {
  buildAISlashCommand,
  registerSlashCommands,
  normalizeSlashCommandInteraction,
  getSlashCommandNames,
  isValidSlashCommand,
  type SlashCommandName,
} from './slash-commands.js';

// GitHub Webhook Handler
export {
  GitHubWebhookHandler,
  normalizeGitHubWebhook,
  processGitHubWebhook,
  calculateRetryDelay,
  type GitHubWebhook,
  type GitHubPullRequestWebhook,
  type GitHubPullRequestReviewWebhook,
  type WebhookProcessResult,
  type WebhookEventProcessor,
} from './github-webhook-handler.js';
