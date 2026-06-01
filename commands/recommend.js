// commands/recommend.js
// /recommend [use-case] — AI picks the best model(s) for what you want to make

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getModels }           = require('../modelCache');
const { checkCooldown }       = require('../rateLimiter');
const { sanitizePromptInput } = require('../utils/sanitize');
const { userFacingError }     = require('../utils/errors');
const { fetchWithTimeout }    = require('../utils/fetch');
const { inferenceModel }      = require('../config');

const SYSTEM_PROMPT = `You are an expert on the Runware API model catalogue.
Your job is to recommend the best Runware model(s) for a user's use case.

You will be given a full list of available models (id, name, capabilities, status, creator) and the user's request.

Rules:
- Only recommend models with status "live" or "api-only".
- Recommend 1-3 models maximum. Fewer is better if one model clearly wins.
- For each recommendation return a JSON object in this exact shape:
  {
    "id": "model-id",
    "name": "Model Name",
    "reason": "One or two sentences explaining why this model fits the use case.",
    "bestFor": "Short phrase, e.g. 'Best overall' or 'Best if speed matters'"
  }
- Return ONLY a valid JSON array of these objects, no markdown fences, no explanation.
- If nothing in the catalogue fits at all, return an empty array [].`;

async function callRunware(prompt) {
  const response = await fetchWithTimeout('https://api.runware.ai/v1', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RUNWARE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{
      taskType: 'textInference',
      taskUUID: crypto.randomUUID(),
      model: inferenceModel,
      messages: [{ role: 'user', content: prompt }],
      settings: { systemPrompt: SYSTEM_PROMPT, maxTokens: 1024 },
    }]),
  }, 30_000);

  if (!response.ok) {
    console.error('[recommend] Runware API error:', response.status);
    throw new Error('Runware API error');
  }

  const data = await response.json();
  if (data?.errors?.length) {
    console.error('[recommend] Runware API-level error:', data.errors[0]);
    throw new Error('Runware API error');
  }
  const text = data?.data?.[0]?.text;
  if (!text) throw new Error('No text in response from Runware');
  return text;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recommend')
    .setDescription('Describe what you want to make and get the best model recommendation')
    .addStringOption(opt =>
      opt.setName('usecase')
        .setDescription('What do you want to make? (e.g. "animate a photo of my dog")')
        .setMaxLength(500)
        .setRequired(true)),

  async execute(interaction) {
    const wait = checkCooldown(interaction.user.id, 'recommend');
    if (wait) {
      return interaction.reply({
        content: `⏱️ Please wait **${wait}s** before using \`/recommend\` again.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const useCase  = sanitizePromptInput(interaction.options.getString('usecase'));
    const allModels = await getModels();

    const catalogue = allModels
      .filter(m => m.status === 'live' || m.status === 'api-only')
      .map(m => ({
        id: m.id,
        name: m.name,
        capabilities: m.capabilities,
        status: m.status,
        creator: m.creator || 'Runware',
      }));

    let recommendations;
    try {
      const prompt = `Model catalogue:\n${JSON.stringify(catalogue)}\n\nUser request: "${useCase}"\n\nRecommend the best model(s).`;
      const raw     = await callRunware(prompt);
      const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      recommendations = JSON.parse(cleaned);
    } catch (e) {
      console.error('[recommend] AI call / parse error:', e);
      return interaction.editReply(`❌ ${userFacingError(e)}`);
    }

    if (!recommendations.length) {
      return interaction.editReply(
        `😕 Couldn't find a model that fits *"${useCase}"*. Try rephrasing or use \`/search\` to browse manually.`
      );
    }

    const medals      = ['🥇', '🥈', '🥉'];
    const statusEmoji = { live: '🟢', 'api-only': '🔵' };

    const embed = new EmbedBuilder()
      .setColor(0x8B5CF6)
      .setTitle('✨ Model Recommendations')
      .setDescription(`Use case: *"${useCase}"*`);

    for (let i = 0; i < recommendations.length; i++) {
      const rec   = recommendations[i];
      const model = allModels.find(m => m.id === rec.id);
      const status = model ? (statusEmoji[model.status] || '') : '';

      embed.addFields({
        name: `${medals[i] || '▪️'} ${rec.bestFor}`,
        value: [
          `${status} **${rec.name}** \`${rec.id}\``,
          rec.reason,
          `> Use \`/info ${rec.id}\` for details or \`/build ${rec.id}\` to generate an API call.`,
        ].join('\n'),
        inline: false,
      });
    }

    embed.setFooter({ text: '🟢 Live  🔵 API Only' });
    await interaction.editReply({ embeds: [embed] });
  },
};
