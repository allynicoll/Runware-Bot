// commands/recommend.js
// /recommend [use-case] — AI picks the best model(s) for what you want to make

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getModels } = require('../modelCache');

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

async function callClaude(prompt) {
  const response = await fetch('https://api.runware.ai/v1', {
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
      settings: {
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: 1024,
      },
    }])
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Runware API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  if (data?.errors?.length) throw new Error(data.errors[0].message || 'Unknown API error');
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
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();

    const useCase = interaction.options.getString('usecase');
    const allModels = await getModels();

    // Send a slim version of the catalogue to keep tokens low
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
      const raw = await callClaude(prompt);
      const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      recommendations = JSON.parse(cleaned);
    } catch (e) {
      return interaction.editReply(`❌ Failed to get recommendations: ${e.message}`);
    }

    if (!recommendations.length) {
      return interaction.editReply(`😕 Couldn't find a model that fits *"${useCase}"*. Try rephrasing or use \`/search\` to browse manually.`);
    }

    const medals = ['🥇', '🥈', '🥉'];
    const statusEmoji = { live: '🟢', 'api-only': '🔵' };

    const embed = new EmbedBuilder()
      .setColor(0x8B5CF6)
      .setTitle('✨ Model Recommendations')
      .setDescription(`Use case: *"${useCase}"*`);

    for (let i = 0; i < recommendations.length; i++) {
      const rec = recommendations[i];
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

    embed.setFooter({ text: '🟢 Live  🔵 API Only  🟡 Coming Soon  🔴 Deprecated' });
    await interaction.editReply({ embeds: [embed] });
  }
};
