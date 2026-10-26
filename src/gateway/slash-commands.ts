/**
 * Slash Commands Registration and Normalization
 * 
 * Registers the 7 AI commands as subcommands of /ai:
 * - /ai start - Start full flow (architect + planner)
 * - /ai plan - Generate task plan
 * - /ai code - Generate code for current task
 * - /ai review - Review existing code
 * - /ai test - Generate test cases
 * - /ai deploy - Start deployment flow
 * - /ai summary - Generate thread summary
 * 
 * @see Requirements 7.1
 */

import {
  Client,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import { config } from '../config/index.js';
import type { NormalizedEvent, SlashCommandPayload } from '../types/events.js';

/**
 * Valid slash command names
 */
export type SlashCommandName = 'start' | 'plan' | 'code' | 'review' | 'test' | 'deploy' | 'summary';

/**
 * Slash command definitions with descriptions
 */
const SLASH_COMMAND_DEFINITIONS: Record<SlashCommandName, string> = {
  start: 'Start the full AI flow (architect + planner) for this thread',
  plan: 'Generate a task plan for this thread',
  code: 'Generate code for the current task',
  review: 'Review the existing code in this thread',
  test: 'Generate test cases for the code',
  deploy: 'Start the deployment flow',
  summary: 'Generate a summary of the current thread state',
};

/**
 * Builds the /ai slash command with all 7 subcommands
 */
export function buildAISlashCommand(): SlashCommandBuilder {
  const command = new SlashCommandBuilder()
    .setName('ai')
    .setDescription('AI DevOS commands for development workflow');

  // Add each subcommand
  for (const [name, description] of Object.entries(SLASH_COMMAND_DEFINITIONS)) {
    command.addSubcommand((subcommand) =>
      subcommand
        .setName(name)
        .setDescription(description)
    );
  }

  return command;
}

/**
 * Registers slash commands with Discord
 * 
 * @param client - Discord.js client (must be logged in)
 * @param guildId - Optional guild ID for guild-specific commands (faster updates during development)
 */
export async function registerSlashCommands(
  client: Client,
  guildId?: string
): Promise<void> {
  const token = config.DISCORD_TOKEN();
  const clientId = client.user?.id;

  if (!clientId) {
    throw new Error('Client must be logged in before registering slash commands');
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const commands = [buildAISlashCommand().toJSON()];

  try {
    console.log('[SlashCommands] Registering slash commands...');

    if (guildId) {
      // Guild-specific commands (instant update, good for development)
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      console.log(`[SlashCommands] Registered commands for guild ${guildId}`);
    } else {
      // Global commands (can take up to 1 hour to propagate)
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
      console.log('[SlashCommands] Registered global commands');
    }
  } catch (error) {
    console.error('[SlashCommands] Failed to register commands:', error);
    throw error;
  }
}

/**
 * Extracts the subcommand name from a slash command interaction
 */
function extractSubcommandName(interaction: ChatInputCommandInteraction): SlashCommandName | null {
  const subcommand = interaction.options.getSubcommand(false);
  
  if (!subcommand) {
    return null;
  }

  // Validate it's one of our known commands
  if (subcommand in SLASH_COMMAND_DEFINITIONS) {
    return subcommand as SlashCommandName;
  }

  return null;
}

/**
 * Extracts options from a slash command interaction
 */
function extractOptions(interaction: ChatInputCommandInteraction): Record<string, string> {
  const options: Record<string, string> = {};
  
  // Get all string options from the interaction
  for (const option of interaction.options.data) {
    if (option.type === 1 && option.options) { // Subcommand type
      for (const subOption of option.options) {
        if (subOption.value !== undefined) {
          options[subOption.name] = String(subOption.value);
        }
      }
    }
  }

  return options;
}

/**
 * Normalizes a slash command interaction to a NormalizedEvent
 * 
 * @param interaction - Discord.js ChatInputCommandInteraction
 * @returns NormalizedEvent of type 'slash_command' or null if invalid
 */
export function normalizeSlashCommandInteraction(
  interaction: ChatInputCommandInteraction
): NormalizedEvent | null {
  // Only handle /ai commands
  if (interaction.commandName !== 'ai') {
    return null;
  }

  const subcommand = extractSubcommandName(interaction);
  if (!subcommand) {
    console.warn('[SlashCommands] Invalid or missing subcommand');
    return null;
  }

  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  const userId = interaction.user.id;

  if (!guildId) {
    console.warn('[SlashCommands] Slash command used outside of a guild');
    return null;
  }

  // Determine threadId - if in a thread, use thread ID; otherwise undefined
  const threadId = interaction.channel?.isThread() ? interaction.channelId : undefined;

  const payload: SlashCommandPayload = {
    command: subcommand,
    options: extractOptions(interaction),
  };

  const event: NormalizedEvent = {
    id: interaction.id,
    type: 'slash_command',
    guildId,
    channelId,
    threadId,
    userId,
    timestamp: interaction.createdTimestamp,
    payload,
  };

  return event;
}

/**
 * Gets the list of all registered slash command names
 */
export function getSlashCommandNames(): SlashCommandName[] {
  return Object.keys(SLASH_COMMAND_DEFINITIONS) as SlashCommandName[];
}

/**
 * Checks if a command name is a valid slash command
 */
export function isValidSlashCommand(name: string): name is SlashCommandName {
  return name in SLASH_COMMAND_DEFINITIONS;
}
