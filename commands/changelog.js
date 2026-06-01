// commands/changelog.js
// /changelog — fetch and display the latest Runware platform changelog entries

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { checkCooldown }   = require('../rateLimiter');
const { userFacingError } = require('../utils/errors');
const { fetchWithTimeout } = require('../utils/fetch');

const CHANGELOG_RSS = 'https://runware.ai/docs/changelog/rss.xml';

async function fetchChangelog() {
  const res = await fetchWithTimeout(CHANGELOG_RSS, {}, 10_000);
  if (!res.ok) throw new Error(`Failed to fetch changelog RSS: ${res.status}`);
  const xml = await res.text();

  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const title = (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                   block.match(/<title>([\s\S]*?)<\/title>/))?.[1]?.trim() ?? 'Untitled';

    const link    = (block.match(/<link>([\s\S]*?)<\/link>/))?.[1]?.trim()    ?? '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/))?.[1]?.trim() ?? '';

    const rawDesc = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                     block.match(/<description>([\s\S]*?)<\/description>/))?.[1] ?? '';
    const plainDesc = rawDesc
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 300);

    items.push({ title, link, pubDate, description: plainDesc });
    if (items.length >= 3) break;
  }

  return items;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('changelog')
    .setDescription('Show the latest Runware platform changelog entries'),

  async execute(interaction) {
    const wait = checkCooldown(interaction.user.id, 'changelog');
    if (wait) {
      return interaction.reply({
        content: `⏱️ Please wait **${wait}s** before using \`/changelog\` again.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    let entries;
    try {
      entries = await fetchChangelog();
    } catch (e) {
      console.error('[changelog] Fetch error:', e);
      return interaction.editReply(`❌ ${userFacingError(e)}`);
    }

    if (!entries.length) {
      return interaction.editReply('⚠️ No changelog entries found right now. Try again later.');
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📋 Runware Changelog')
      .setURL('https://runware.ai/docs/changelog')
      .setDescription('The latest updates and improvements to the Runware platform.')
      .setFooter({ text: 'Source: runware.ai/docs/changelog' });

    for (const entry of entries) {
      const parsedDate = entry.pubDate ? new Date(entry.pubDate) : null;
      const dateStr = (parsedDate && !isNaN(parsedDate))
        ? parsedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : '';

      const value = [
        entry.description ? entry.description + (entry.description.length === 300 ? '…' : '') : '',
        entry.link ? `[Read more →](${entry.link})` : '',
      ].filter(Boolean).join('\n') || 'No description available.';

      embed.addFields({
        name: `${dateStr ? `📅 ${dateStr} — ` : ''}${entry.title}`,
        value: value.slice(0, 1020),
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
