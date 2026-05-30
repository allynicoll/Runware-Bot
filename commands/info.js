// commands/info.js
// /info [model-id] — show details and parameters for a specific model

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getModels, fetchSchema } = require('../modelCache');

// Parse an OpenAPI schema into something human-readable
function summariseSchema(schema) {
  const body = schema?.components?.schemas?.RequestBody;
  if (!body) return null;

  const itemProps = body?.items?.properties || {};
  const required = body?.items?.required || [];

  const params = [];
  for (const [name, def] of Object.entries(itemProps)) {
    if (['taskType', 'taskUUID', 'model'].includes(name)) continue; // internal plumbing

    const isRequired = required.includes(name);
    let typeStr = def.type || 'object';
    if (def.enum) typeStr += `: ${def.enum.map(v => `\`${v}\``).join(', ')}`;
    if (def.default !== undefined) typeStr += ` (default: \`${def.default}\`)`;
    if (def.minimum !== undefined || def.maximum !== undefined) {
      typeStr += ` [${def.minimum ?? ''}–${def.maximum ?? ''}]`;
    }

    params.push({ name, typeStr, required: isRequired, description: def.description });
  }

  return params;
}

// Extract allowed dimensions from allOf constraints
function extractDimensions(schema) {
  const body = schema?.components?.schemas?.RequestBody;
  const allOf = body?.items?.allOf || [];
  const dims = [];

  for (const rule of allOf) {
    if (rule.oneOf) {
      for (const opt of rule.oneOf) {
        const w = opt.properties?.width?.const;
        const h = opt.properties?.height?.const;
        const title = opt.title || '';
        if (w && h) dims.push(`${title ? `**${title}**: ` : ''}${w}×${h}`);
      }
    }
  }
  return dims;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Show details and parameters for a specific Runware model')
    .addStringOption(opt =>
      opt.setName('model')
        .setDescription('Model ID (e.g. krea-2-large, bfl-flux-1-schnell)')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();

    const modelId = interaction.options.getString('model').toLowerCase().trim();
    const allModels = await getModels();

    // Fuzzy-ish match: exact id first, then name contains
    let model = allModels.find(m => m.id === modelId);
    if (!model) model = allModels.find(m => m.id.includes(modelId) || m.name.toLowerCase().includes(modelId));

    if (!model) {
      return interaction.editReply(`❌ Couldn't find a model matching \`${modelId}\`. Try \`/search\` first to find the exact ID.`);
    }

    // Fetch schema
    let schema;
    try {
      schema = await fetchSchema(model.schema);
    } catch (e) {
      return interaction.editReply(`❌ Failed to fetch schema for \`${model.id}\`: ${e.message}`);
    }

    const info = schema?.info || {};
    const statusEmoji = { live: '🟢', 'api-only': '🔵', 'coming-soon': '🟡', deprecated: '🔴' };
    const params = summariseSchema(schema) || [];
    const dimensions = extractDimensions(schema);

    const embed = new EmbedBuilder()
      .setColor(0x00AE86)
      .setTitle(`${statusEmoji[model.status] || '⚪'} ${model.name}`)
      .setURL(`https://runware.ai/models/${model.id}`)
      .setDescription(info.summary || info.description?.slice(0, 300) || 'No description available.')
      .addFields(
        {
          name: '📋 Details',
          value: [
            `**ID:** \`${model.id}\``,
            model.air ? `**AIR:** \`${model.air}\`` : null,
            `**Status:** ${model.status}`,
            model.creator ? `**Creator:** ${model.creator}` : null,
            `**Model Page:** [runware.ai/models/${model.id}](https://runware.ai/models/${model.id})`,
            `**API Docs:** [runware.ai/docs/models/${model.id}](https://runware.ai/docs/models/${model.id})`,
            `**Capabilities:** ${model.capabilities?.join(', ') || 'unknown'}`,
          ].filter(Boolean).join('\n'),
          inline: false
        }
      );

    if (dimensions.length) {
      embed.addFields({
        name: '📐 Allowed Dimensions',
        value: dimensions.slice(0, 10).join('\n') || 'See schema',
        inline: false
      });
    }

    const required = params.filter(p => p.required);
    const optional = params.filter(p => !p.required);

    if (required.length) {
      embed.addFields({
        name: '🔴 Required Parameters',
        value: required.map(p => `**\`${p.name}\`** — ${p.typeStr}`).join('\n').slice(0, 1020),
        inline: false
      });
    }

    if (optional.length) {
      embed.addFields({
        name: '🔵 Optional Parameters',
        value: optional.map(p => `**\`${p.name}\`** — ${p.typeStr}`).join('\n').slice(0, 1020),
        inline: false
      });
    }

    embed.addFields({
      name: '💡 Next step',
      value: `Use \`/build ${model.id}\` to generate a ready-to-use API call for this model.`,
      inline: false
    });

    embed.setFooter({ text: `Schema: ${model.schema}` });

    await interaction.editReply({ embeds: [embed] });
  }
};
