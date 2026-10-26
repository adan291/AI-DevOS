/**
 * Adapters Module
 * 
 * Multi-platform chat adapters and VCS adapters.
 * Allows AI DevOS to work with any chat platform and version control system.
 */

// Chat Adapter Interface
export type {
  ChatPlatform,
  AdapterCapabilities,
  AdapterEmbed,
  AdapterEmbedField,
  AdapterEventHandler,
  AdapterChannel,
  AdapterThread,
  AdapterProjectStructure,
  AdapterProjectResult,
  AdapterTaskThreadResult,
  ChatAdapter,
} from './chat-adapter.js';

// Platform Adapters
export { DiscordAdapter } from './discord-adapter.js';
export { SlackAdapter } from './slack-adapter.js';
export { TelegramAdapter } from './telegram-adapter.js';
export { WebhookAdapter } from './webhook-adapter.js';

// Adapter Manager
export { AdapterManager, createAdapterManager } from './adapter-manager.js';

// VCS Adapters
export type { VCSPlatform, VCSCapabilities, VCSAdapter, VCSRepository, VCSPullRequest, VCSReview, VCSComment, VCSBranch } from './vcs-adapter.js';
export { GitHubVCSAdapter } from './github-vcs-adapter.js';
export { GitLabVCSAdapter } from './gitlab-vcs-adapter.js';
export { VCSManager, createVCSManager } from './vcs-manager.js';
