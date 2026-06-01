// commands/new.js
// /new — show models added since the bot last checked
// Also exports startNewModelWatcher() for automatic channel announcements

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getModels }     = require('../modelCache');
const { checkCooldown } = require('../rateLimiter');
const fs   = require('fs');
const path = require('path');

const SNAPSHOT_FILE = path.join(__dirname, '..', '.model-snapshot.json');

function loadSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
      // Validate shape: must be a plain object (id -> status strings)
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        console.warn('[Watcher] Snapshot has unexpected shape — discarding');
        return null;
      }
      return raw;
    }
  } catch (e) {
    console.warn('[Watcher] Could not load snapshot:', e.message);
  }
  return null;
}

function saveSnapshot(models) {
  try {
    const snap = {};
    for (const m of models) snap[m.id] = m.status;
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap), 'utf8');
    return snap;
  } catch (e) {
    console.warn('[Watcher] Could not save snapshot:', e.message);
    return null;
  }
}

function diffModels(oldSnap, newModels) {
  const brandNew = [];
  const wentLive = [];

  for (const m of newModels) {
    if (!oldSnap[m.id]) {
      brandNew.push(m);
    } else if (
      oldSnap[m.id] === 'coming-soon' &&
      (m.status === 'live' || m.status === 'api-only')
    ) {
      wentLive.push(m);
    }
  }
  return { brandNew, wentLive };
}

function buildEmbeds(brandNew, wentLive) {
  const statusEmoji = { live: '🟢', 'api-only': '🔵', 'coming-soon': '🟡', deprecated: '🔴' };
  const embeds = [];

  if (brandNew.length) {
    const embed = new EmbedBuilder()
      .setColor(0x22C55E)
      .setTitle(`🆕 ${brandNew.length} New Model${brandNew.length > 1 ? 's' : ''} Added`)
      .setFooter({ text: '🟢 Live  🔵 API Only  🟡 Coming Soon  🔴 Deprecated  ⚪ Unknown' })
      .setTimestamp();
    const lines = brandNew.map(m => {
      const emoji = statusEmoji[m.status] || '⚪';
      return emoji + ' **' + m.name + '** `' + m.id + '`\n> ' + (m.capabilities?.join(', ') || '');
    });
    for (let i = 0; i < lines.length; i += 5) {
      embed.addFields({ name: i === 0 ? 'Models' : '​', value: lines.slice(i, i + 5).join('\n\n'), inline: false });
    }
    embeds.push(embed);
  }

  if (wentLive.length) {
    const embed = new EmbedBuilder()
      .setColor(0x3B82F6)
      .setTitle(`✅ ${wentLive.length} Model${wentLive.length > 1 ? 's' : ''} Now Live`)
      .setFooter({ text: '🟢 Live  🔵 API Only  🟡 Coming Soon  🔴 Deprecated  ⚪ Unknown' })
      .setTimestamp();
    const lines = wentLive.map(m => {
      const emoji = statusEmoji[m.status] || '⚪';
      return emoji + ' **' + m.name + '** `' + m.id + '`\n> ' + (m.capabilities?.join(', ') || '');
    });
    for (let i = 0; i < lines.length; i += 5) {
      embed.addFields({ name: i === 0 ? 'Models' : '​', value: lines.slice(i, i + 5).join('\n\n'), inline: false });
    }
    embeds.push(embed);
  }

  return embeds;
}

function startNewModelWatcher(client, channelId, intervalMs = 60 * 60 * 1000) {
  console.log(`[Watcher] Starting — checking every ${intervalMs / 60000}min, posting to channel ${channelId}`);

  getModels().then(models => {
    const existing = loadSnapshot();
    if (!existing) {
      saveSnapshot(models);
      console.log(`[Watcher] First run — snapshot saved (${models.length} models).`);
    } else {
      console.log(`[Watcher] Snapshot loaded (${Object.keys(existing).length} models tracked).`);
    }
  }).catch(e => console.error('[Watcher] Startup failed:', e.message));

  setInterval(async () => {
    try {
      const models  = await getModels();
      const oldSnap = loadSnapshot();
      if (!oldSnap) { saveSnapshot(models); return; }

      const { brandNew, wentLive } = diffModels(oldSnap, models);
      saveSnapshot(models);
      if (!brandNew.length && !wentLive.length) return;

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) { console.warn('[Watcher] Announcement channel not found:', channelId); return; }

      for (const embed of buildEmbeds(brandNew, wentLive)) {
        await channel.send({ embeds: [embed] });
      }
    } catch (e) {
      console.error('[Watcher] Check failed:', e.message);
    }
  }, intervalMs);
}

module.exports = {
  startNewModelWatcher,

  data: new SlashCommandBuilder()
    .setName('new')
    .setDescription('Show models added or gone live since the bot last checked'),

  async execute(interaction) {
    const wait = checkCooldown(interaction.user.id, 'new');
    if (wait) {
      return interaction.reply({
        content: `⏱️ Please wait **${wait}s** before using \`/new\` again.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const models  = await getModels();
    const oldSnap = loadSnapshot();

    if (!oldSnap) {
      saveSnapshot(models);
      return interaction.editReply(
        "📸 I've taken a snapshot of all current models. Run `/new` again after the next check (hourly) to see what's been added since!"
      );
    }

    const { brandNew, wentLive } = diffModels(oldSnap, models);

    if (!brandNew.length && !wentLive.length) {
      return interaction.editReply('✅ No new models or status changes since the last check. Check back later!');
    }

    const embeds = buildEmbeds(brandNew, wentLive);
    await interaction.editReply({ embeds: [embeds[0]] });
    for (const embed of embeds.slice(1)) {
      await interaction.followUp({ embeds: [embed] });
    }
  },
};
