// commands/search.js
// /search — filter models by capability, creator, or status

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getModels } = require('../modelCache');

const CAPABILITY_CHOICES = [
  'text-to-image', 'image-to-image', 'text-to-video', 'image-to-video',
  'video-to-video', 'text-to-audio', 'audio-to-video', 'image-to-text',
  'video-to-text', 'text-to-text', 'text-to-3d', 'image-to-3d',
  'remove-background', 'upscale', 'edit', 'caption', 'mask',
  'preprocess', 'prompt-enhance', 'train', 'extend',
].map(c => ({ name: c, value: c }));

const STATUS_CHOICES = [
  { name: 'Live', value: 'live' },
  { name: 'API Only', value: 'api-only' },
  { name: 'Coming Soon', value: 'coming-soon' },
  { name: 'Deprecated', value: 'deprecated' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search Runware models by capability, creator, or status')
    .addStringOption(opt =>
      opt.setName('capability')
        .setDescription('Filter by what the model can do')
        .setRequired(false)
        .addChoices(...CAPABILITY_CHOICES))
    .addStringOption(opt =>
      opt.setName('creator')
        .setDescription('Filter by creator (e.g. "Black Forest Labs", "Google")')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('status')
        .setDescription('Filter by availability status')
        .setRequired(false)
        .addChoices(...STATUS_CHOICES)),

  async execute(interaction) {
    await interaction.deferReply();

    const capability = interaction.options.getString('capability');
    const creatorQuery = interaction.options.getString('creator')?.toLowerCase();
    const status = interaction.options.getString('status');

    const allModels = await getModels();

    const results = allModels.filter(m => {
      if (capability && !m.capabilities?.includes(capability)) return false;
      if (creatorQuery && !m.creator?.toLowerCase().includes(creatorQuery)) return false;
      if (status && m.status !== status) return false;
      return true;
    });

    if (results.length === 0) {
      return interaction.editReply('No models found matching those filters. Try different options!');
    }

    // Group by creator
    const grouped = {};
    for (const model of results) {
      const key = model.creator || 'Runware';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(model);
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🔍 Model Search Results')
      .setFooter({ text: `${results.length} model${results.length === 1 ? '' : 's'} found • Use /info [id] for details • 🟢 Live  🔵 API Only  🟡 Coming Soon  🔴 Deprecated  ⚪ Unknown` });

    const filterParts = [];
    if (capability) filterParts.push(`capability: \`${capability}\``);
    if (creatorQuery) filterParts.push(`creator: \`${creatorQuery}\``);
    if (status) filterParts.push(`status: \`${status}\``);
    if (filterParts.length) embed.setDescription(`Filters: ${filterParts.join(' · ')}`);

    const statusEmoji = { live: '🟢', 'api-only': '🔵', 'coming-soon': '🟡', deprecated: '🔴' };

    let fieldCount = 0;
    for (const [creator, models] of Object.entries(grouped)) {
      if (fieldCount >= 20) break;

      // Auto-chunk lines to stay under Discord's 1024-char field limit
      const allLines = models.map(m => {
        const emoji = statusEmoji[m.status] || '⚪';
        return emoji + ' **' + m.name + '** `' + m.id + '`';
      });

      let chunk = '';
      let chunkIndex = 0;
      for (const line of allLines) {
        if (fieldCount >= 20) break;
        const candidate = chunk ? chunk + '\n' + line : line;
        if (candidate.length > 1020) {
          embed.addFields({ name: chunkIndex === 0 ? creator : creator + ' (cont.)', value: chunk, inline: false });
          fieldCount++;
          chunk = line;
          chunkIndex++;
        } else {
          chunk = candidate;
        }
      }
      if (chunk && fieldCount < 20) {
        embed.addFields({ name: chunkIndex === 0 ? creator : creator + ' (cont.)', value: chunk, inline: false });
        fieldCount++;
      }
    }

    await interaction.editReply({ embeds: [embed] });
  }
};
