// commands/compare.js
// /compare [model-a] [model-b] — diff two models of the same type

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { getModels, fetchSchema } = require('../modelCache');

// ── Schema parsing ────────────────────────────────────────────────────────────
function parseParams(schema) {
  const body = schema?.components?.schemas?.RequestBody;
  if (!body) return {};
  const itemProps = body?.items?.properties || {};
  const required = body?.items?.required || [];
  const SKIP = new Set(['taskType', 'taskUUID', 'model']);
  const result = {};
  for (const [name, def] of Object.entries(itemProps)) {
    if (SKIP.has(name)) continue;
    let typeStr = def.type || 'object';
    if (def.enum) typeStr += `: ${def.enum.map(v => `\`${v}\``).join(', ')}`;
    if (def.default !== undefined) typeStr += ` (default: \`${def.default}\`)`;
    if (def.minimum !== undefined || def.maximum !== undefined) {
      typeStr += ` [${def.minimum ?? ''}–${def.maximum ?? ''}]`;
    }
    result[name] = { typeStr, required: required.includes(name), description: def.description || '' };
  }
  return result;
}

// ── Diff logic ────────────────────────────────────────────────────────────────
function diffParams(paramsA, paramsB) {
  const allKeys = new Set([...Object.keys(paramsA), ...Object.keys(paramsB)]);
  const onlyA = [], onlyB = [], different = [], same = [];
  for (const key of allKeys) {
    if (paramsA[key] && !paramsB[key]) { onlyA.push(key); continue; }
    if (!paramsA[key] && paramsB[key]) { onlyB.push(key); continue; }
    if (paramsA[key].typeStr !== paramsB[key].typeStr) { different.push(key); continue; }
    same.push(key);
  }
  return { onlyA, onlyB, different, same };
}

// ── Format a diff field ───────────────────────────────────────────────────────
function formatDiffField(keys, paramsA, paramsB, nameA, nameB, mode) {
  if (!keys.length) return '_None_';
  return keys.map(key => {
    if (mode === 'onlyA') return `**\`${key}\`** — ${paramsA[key].typeStr}`;
    if (mode === 'onlyB') return `**\`${key}\`** — ${paramsB[key].typeStr}`;
    return `**\`${key}\`**\n  ${nameA}: ${paramsA[key].typeStr}\n  ${nameB}: ${paramsB[key].typeStr}`;
  }).join('\n').slice(0, 1020);
}

// ── AI summary via Runware textInference (same as build.js) ───────────────────
async function getAISummary(modelA, modelB, schemaA, schemaB, paramsA, paramsB, diff) {
  const infoA = schemaA?.info || {};
  const infoB = schemaB?.info || {};
  const descA = infoA.description || infoA.summary || 'No description available.';
  const descB = infoB.description || infoB.summary || 'No description available.';

  const paramDetail = (params) =>
    Object.entries(params)
      .map(([k, v]) => `  ${k}: ${v.typeStr}${v.description ? ' — ' + v.description : ''}`)
      .join('\n') || '  (none)';

  const prompt = `You are a concise technical writer for an API docs Discord bot.

Compare these two Runware AI models and write 2-3 sentences of plain-English guidance for a developer choosing between them. Be specific — mention actual parameter names, ranges, or capabilities where relevant. Do not use markdown headers or bullet points.

=== ${modelA.name} (${modelA.id}) ===
Description: ${descA}
Parameters:
${paramDetail(paramsA)}

=== ${modelB.name} (${modelB.id}) ===
Description: ${descB}
Parameters:
${paramDetail(paramsB)}

=== Diff summary ===
Only in ${modelA.name}: ${diff.onlyA.join(', ') || 'none'}
Only in ${modelB.name}: ${diff.onlyB.join(', ') || 'none'}
Different values: ${diff.different.map(k => `${k} (A: ${paramsA[k]?.typeStr} | B: ${paramsB[k]?.typeStr})`).join('; ') || 'none'}
Shared: ${diff.same.length} identical parameters`;

  const res = await fetch('https://api.runware.ai/v1', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RUNWARE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{
      taskType: 'textInference',
      taskUUID: crypto.randomUUID(),
      model: 'anthropic:claude@sonnet-4.6',
      messages: [{ role: 'user', content: prompt }],
      settings: { maxTokens: 400 },
    }])
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Runware API ${res.status}: ${err}`);
  }

  const data = await res.json();
  if (data?.errors?.length) throw new Error(data.errors[0].message || 'Unknown API error');

  const text = data?.data?.[0]?.text;
  if (!text) throw new Error('No text in response from Runware');
  return text.trim();
}

// ── Command ───────────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('compare')
    .setDescription('Compare two Runware models side by side (same type only)')
    .addStringOption(opt =>
      opt.setName('model-a')
        .setDescription('First model ID (e.g. bfl-flux-1-schnell)')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('model-b')
        .setDescription('Second model ID (e.g. bfl-flux-1-dev)')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();

    const idA = interaction.options.getString('model-a').toLowerCase().trim();
    const idB = interaction.options.getString('model-b').toLowerCase().trim();
    const allModels = await getModels();

    const resolve = id =>
      allModels.find(m => m.id === id) ||
      allModels.find(m => m.id.includes(id) || m.name.toLowerCase().includes(id));

    const modelA = resolve(idA);
    const modelB = resolve(idB);

    if (!modelA) return interaction.editReply(`❌ Couldn't find a model matching \`${idA}\`. Try \`/search\` first.`);
    if (!modelB) return interaction.editReply(`❌ Couldn't find a model matching \`${idB}\`. Try \`/search\` first.`);
    if (modelA.id === modelB.id) return interaction.editReply(`❌ Both model IDs resolved to the same model (\`${modelA.id}\`).`);

    const typeA = modelA.capabilities?.[0];
    const typeB = modelB.capabilities?.[0];
    if (typeA && typeB && typeA !== typeB) {
      return interaction.editReply(
        `❌ Can't compare models of different types.\n` +
        `**${modelA.name}** is \`${typeA}\` — **${modelB.name}** is \`${typeB}\`.\n` +
        `Use \`/search capability:${typeA}\` to find comparable models.`
      );
    }

    let schemaA, schemaB;
    try {
      [schemaA, schemaB] = await Promise.all([fetchSchema(modelA.schema), fetchSchema(modelB.schema)]);
    } catch (e) {
      return interaction.editReply(`❌ Failed to fetch schema: ${e.message}`);
    }

    const paramsA = parseParams(schemaA);
    const paramsB = parseParams(schemaB);
    const diff = diffParams(paramsA, paramsB);

    let summary = '';
    try {
      summary = await getAISummary(modelA, modelB, schemaA, schemaB, paramsA, paramsB, diff);
      if (!summary) summary = '_No summary returned._';
    } catch (e) {
      console.error('[Compare] AI summary error:', e.message);
      summary = `_AI summary failed: ${e.message}_`;
    }

    const statusEmoji = { live: '🟢', 'api-only': '🔵', 'coming-soon': '🟡', deprecated: '🔴' };

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`⚖️ ${modelA.name}  vs  ${modelB.name}`)
      .setDescription(summary)
      .addFields({
        name: '📋 Overview',
        value: [
          `**${modelA.name}** ${statusEmoji[modelA.status] || '⚪'} \`${modelA.id}\``,
          `**${modelB.name}** ${statusEmoji[modelB.status] || '⚪'} \`${modelB.id}\``,
          `**Type:** ${typeA || 'unknown'}`,
          `**Shared params:** ${diff.same.length} identical  |  **Differences:** ${diff.different.length + diff.onlyA.length + diff.onlyB.length}`,
        ].join('\n'),
        inline: false
      });

    if (diff.different.length) {
      embed.addFields({
        name: `🔀 Different values (${diff.different.length})`,
        value: formatDiffField(diff.different, paramsA, paramsB, modelA.name, modelB.name, 'different'),
        inline: false
      });
    }

    if (diff.onlyA.length) {
      embed.addFields({
        name: `🅰️ Only in ${modelA.name} (${diff.onlyA.length})`,
        value: formatDiffField(diff.onlyA, paramsA, paramsB, modelA.name, modelB.name, 'onlyA'),
        inline: false
      });
    }

    if (diff.onlyB.length) {
      embed.addFields({
        name: `🅱️ Only in ${modelB.name} (${diff.onlyB.length})`,
        value: formatDiffField(diff.onlyB, paramsA, paramsB, modelA.name, modelB.name, 'onlyB'),
        inline: false
      });
    }

    if (!diff.different.length && !diff.onlyA.length && !diff.onlyB.length) {
      embed.addFields({ name: '✅ Identical parameters', value: 'Both models share the exact same parameter set.', inline: false });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('show_all_params')
        .setLabel(`Show all ${diff.same.length} shared params`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(diff.same.length === 0)
    );

    const reply = await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000
    });

    collector.on('collect', async btn => {
      if (btn.customId !== 'show_all_params') return;
      await btn.deferUpdate();

      const sharedLines = diff.same.map(k => `**\`${k}\`** — ${paramsA[k].typeStr}`).join('\n');
      const chunks = [];
      let chunk = '';
      for (const line of sharedLines.split('\n')) {
        if ((chunk + '\n' + line).length > 1020) { chunks.push(chunk); chunk = line; }
        else chunk = chunk ? chunk + '\n' + line : line;
      }
      if (chunk) chunks.push(chunk);

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('show_all_params')
          .setLabel(`${diff.same.length} shared params`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
      await interaction.editReply({ embeds: [embed], components: [disabledRow] });

      for (let i = 0; i < Math.min(chunks.length, 5); i++) {
        const sharedEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .addFields({ name: i === 0 ? '🟰 Shared parameters' : '🟰 Shared (cont.)', value: chunks[i], inline: false });
        await interaction.followUp({ embeds: [sharedEmbed] });
      }
    });

    collector.on('end', async () => {
      const expiredRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('show_all_params')
          .setLabel('Show all shared params')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
      await interaction.editReply({ components: [expiredRow] }).catch(() => {});
    });
  }
};
