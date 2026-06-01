// index.js — Main bot entry point

require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { getModels } = require('./modelCache');

// Load commands
const searchCmd    = require('./commands/search');
const infoCmd      = require('./commands/info');
const buildCmd     = require('./commands/build');
const recommendCmd = require('./commands/recommend');
const newCmd       = require('./commands/new');
const changelogCmd = require('./commands/changelog');
const pricingCmd   = require('./commands/pricing');
const compareCmd   = require('./commands/compare');
const { startNewModelWatcher } = require('./commands/new');

const commands = new Collection();
commands.set(searchCmd.data.name,    searchCmd);
commands.set(infoCmd.data.name,      infoCmd);
commands.set(buildCmd.data.name,     buildCmd);
commands.set(recommendCmd.data.name, recommendCmd);
commands.set(newCmd.data.name,       newCmd);
commands.set(changelogCmd.data.name, changelogCmd);
commands.set(pricingCmd.data.name,   pricingCmd);
commands.set(compareCmd.data.name,   compareCmd);

// Commands that consume paid Runware inference credits.
// These are gated behind AI_COMMAND_ROLE_ID when that env var is set.
const AI_COMMANDS = new Set(['build', 'recommend', 'compare']);
const AI_COMMAND_ROLE_ID = process.env.AI_COMMAND_ROLE_ID || null;

// ── Global error handlers ─────────────────────────────────────────────────────
// Catches async errors that escape try/catch blocks so they don't silently
// swallow or crash the process unexpectedly.

process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Fatal] Uncaught exception:', err);
  process.exit(1);
});

// ── Register slash commands with Discord ──────────────────────────────────────

async function registerCommands() {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  const commandData = [
    searchCmd, infoCmd, buildCmd, recommendCmd,
    newCmd, changelogCmd, pricingCmd, compareCmd,
  ].map(c => c.data.toJSON());

  console.log('[Commands] Registering slash commands to guild...');
  await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
    { body: commandData }
  );
  console.log('[Commands] Slash commands registered!');
}

// ── Create Discord client ─────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`\n✅ Logged in as ${client.user.tag}`);
  console.log(`   Serving guild: ${process.env.DISCORD_GUILD_ID}`);

  if (AI_COMMAND_ROLE_ID) {
    console.log(`   AI commands restricted to role ID: ${AI_COMMAND_ROLE_ID}`);
  } else {
    console.log('   AI commands: open to all members (set AI_COMMAND_ROLE_ID to restrict)');
  }

  try {
    const models = await getModels();
    console.log(`   Model cache ready: ${models.length} models loaded\n`);
  } catch (e) {
    console.warn('[Cache] Pre-warm failed, will retry on first command:', e.message);
  }

  if (process.env.ANNOUNCE_CHANNEL_ID) {
    startNewModelWatcher(client, process.env.ANNOUNCE_CHANNEL_ID);
  } else {
    console.log('[Watcher] No ANNOUNCE_CHANNEL_ID set — automatic announcements disabled.');
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  // Audit log — one line per invocation for debugging and abuse tracking
  console.log(
    `[Cmd] /${interaction.commandName} | ${interaction.user.tag} (${interaction.user.id}) | guild: ${interaction.guildId}`
  );

  // Role-based access control for paid AI commands
  if (AI_COMMAND_ROLE_ID && AI_COMMANDS.has(interaction.commandName)) {
    const hasRole = interaction.member?.roles?.cache?.has(AI_COMMAND_ROLE_ID);
    if (!hasRole) {
      return interaction.reply({
        content: '❌ You don\'t have permission to use this command.',
        ephemeral: true,
      });
    }
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[Error] Command /${interaction.commandName}:`, error);
    const msg = { content: '❌ Something went wrong. Please try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

(async () => {
  const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'RUNWARE_API_KEY'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('   Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }

  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
})();
