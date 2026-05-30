// index.js — Main bot entry point

require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { getModels } = require('./modelCache');

// Load commands
const searchCmd = require('./commands/search');
const infoCmd = require('./commands/info');
const buildCmd = require('./commands/build');
const recommendCmd = require('./commands/recommend');
const newCmd = require('./commands/new');
const changelogCmd = require('./commands/changelog');
const pricingCmd = require('./commands/pricing');
const compareCmd = require('./commands/compare');
const { startNewModelWatcher } = require('./commands/new');

const commands = new Collection();
commands.set(searchCmd.data.name, searchCmd);
commands.set(infoCmd.data.name, infoCmd);
commands.set(buildCmd.data.name, buildCmd);
commands.set(recommendCmd.data.name, recommendCmd);
commands.set(newCmd.data.name, newCmd);
commands.set(changelogCmd.data.name, changelogCmd);
commands.set(pricingCmd.data.name, pricingCmd);
commands.set(compareCmd.data.name, compareCmd);

// ── Register slash commands with Discord ─────────────────────────────────────
async function registerCommands() {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  const commandData = [searchCmd, infoCmd, buildCmd, recommendCmd, newCmd, changelogCmd, pricingCmd, compareCmd].map(c => c.data.toJSON());

  console.log('[Commands] Registering slash commands to guild...');
  await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
    { body: commandData }
  );
  console.log('[Commands] Slash commands registered!');
}

// ── Create Discord client ────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`\n✅ Logged in as ${client.user.tag}`);
  console.log(`   Serving guild: ${process.env.DISCORD_GUILD_ID}`);

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
    console.log('          Add it to .env to enable automatic new model posts.');
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[Error] Command /${interaction.commandName}:`, error);
    const msg = { content: '❌ Something went wrong running that command. Check the bot console for details.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
(async () => {
  const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'RUNWARE_API_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('   Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }

  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
})();
