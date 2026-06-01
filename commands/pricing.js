// commands/pricing.js
// /pricing [model] — show pricing info for a specific model from its schema

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getModels, fetchSchema } = require('../modelCache');
const { checkCooldown }   = require('../rateLimiter');
const { userFacingError } = require('../utils/errors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pricing')
    .setDescription('Show pricing for a Runware model')
    .addStringOption(opt =>
      opt.setName('model')
        .setDescription('Model ID or AIR ID (e.g. bfl-flux-1-schnell, runware:100@1)')
        .setMaxLength(100)
        .setRequired(true)),

  async execute(interaction) {
    const wait = checkCooldown(interaction.user.id, 'pricing');
    if (wait) {
      return interaction.reply({
        content: `⏱️ Please wait **${wait}s** before using \`/pricing\` again.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    const query     = interaction.options.getString('model').toLowerCase().trim();
    const allModels = await getModels();

    const model =
      allModels.find(m => m.id === query) ||
      allModels.find(m => m.air?.toLowerCase() === query) ||
      allModels.find(m => m.id.includes(query) || m.name.toLowerCase().includes(query));

    if (!model) {
      return interaction.editReply(
        `❌ Couldn't find a model matching \`${query}\`. Try \`/search\` to find the exact ID.`
      );
    }

    let schema;
    try {
      schema = await fetchSchema(model.schema);
    } catch (e) {
      console.error('[pricing] Schema fetch error:', e);
      return interaction.editReply(`❌ ${userFacingError(e)}`);
    }

    const pricing     = schema?.info?.['x-pricing'];
    const statusEmoji = { live: '🟢', 'api-only': '🔵', 'coming-soon': '🟡', deprecated: '🔴' };

    const embed = new EmbedBuilder()
      .setColor(0x10B981)
      .setTitle(`💰 Pricing — ${model.name}`)
      .setURL(`https://runware.ai/models/${model.id}`)
      .addFields({
        name: '📋 Model',
        value: [
          `**ID:** \`${model.id}\``,
          model.air ? `**AIR:** \`${model.air}\`` : null,
          `**Status:** ${statusEmoji[model.status] || '⚪'} ${model.status}`,
          model.creator ? `**Creator:** ${model.creator}` : null,
        ].filter(Boolean).join('\n'),
        inline: false,
      });

    if (!pricing) {
      embed.addFields({
        name: '💲 Pricing',
        value: `Pricing details are not available in the schema for this model.\nCheck the [model page](https://runware.ai/models/${model.id}) or use \`includeCost: true\` in your API call to see the exact cost per request.`,
        inline: false,
      });
    } else {
      if (pricing.overview) {
        embed.addFields({ name: '💲 Pricing Overview', value: `**${pricing.overview}**`, inline: false });
      }
      if (pricing.examples?.length) {
        embed.addFields({
          name: '📊 Example Costs',
          value: pricing.examples.map(ex => `\`${ex.configuration}\` → **${ex.price}**`).join('\n').slice(0, 1020),
          inline: false,
        });
      }
      embed.addFields({
        name: '💡 Tips',
        value: [
          '• Add `"includeCost": true` to any API request to see the exact cost in the response.',
          '• Serverless model costs scale with resolution, steps, and LoRAs.',
          '• Failed requests are **not** charged.',
        ].join('\n'),
        inline: false,
      });
    }

    embed.setFooter({ text: 'Prices are estimates and may vary · runware.ai/docs/platform/pricing' });
    await interaction.editReply({ embeds: [embed] });
  },
};
