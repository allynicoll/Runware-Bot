// commands/build.js
// /build [model-id] [request] — AI-powered API call builder

const { SlashCommandBuilder, EmbedBuilder, codeBlock } = require('discord.js');
const { getModels, fetchSchema } = require('../modelCache');
const { checkCooldown }       = require('../rateLimiter');
const { sanitizePromptInput } = require('../utils/sanitize');
const { userFacingError }     = require('../utils/errors');
const { fetchWithTimeout }    = require('../utils/fetch');
const { inferenceModel }      = require('../config');

const SYSTEM_PROMPT = `You are an expert on the Runware API.
Your job is to generate valid JSON API request payloads for Runware models.

Rules:
- Always return ONLY a valid JSON array (the request body), no explanation, no markdown fences.
- Fill in all required fields correctly based on the schema.
- Generate a random UUID v4 for taskUUID.
- Use sensible defaults for optional fields unless the user specifies otherwise.
- For dimensions, pick the closest valid option from the schema's allowed dimensions.
- Do not invent parameters that aren't in the schema.
- If the user asks for something the model doesn't support, use the closest supported equivalent.`;

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
    // Log full error server-side only — never forward to Discord
    console.error('[build] Runware API error:', response.status, await response.text());
    throw new Error('Runware API error');
  }

  const data = await response.json();
  if (data?.errors?.length) {
    console.error('[build] Runware API-level error:', data.errors[0]);
    throw new Error('Runware API error');
  }

  const text = data?.data?.[0]?.text;
  if (!text) throw new Error('No text in response from Runware');
  return text;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('build')
    .setDescription('Generate a ready-to-use Runware API call for a model')
    .addStringOption(opt =>
      opt.setName('model')
        .setDescription('Model ID (e.g. krea-2-large)')
        .setMaxLength(100)
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('request')
        .setDescription('What do you want to generate? (e.g. "a 16:9 photorealistic cat, high creativity")')
        .setMaxLength(500)
        .setRequired(false)),

  async execute(interaction) {
    // Rate limit check — before deferReply so we can reply ephemerally
    const wait = checkCooldown(interaction.user.id, 'build');
    if (wait) {
      return interaction.reply({
        content: `⏱️ Please wait **${wait}s** before using \`/build\` again.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const modelId     = interaction.options.getString('model').toLowerCase().trim();
    const userRequest = sanitizePromptInput(
      interaction.options.getString('request') || 'a photorealistic image with default settings'
    );

    const allModels = await getModels();
    let model = allModels.find(m => m.id === modelId)
             || allModels.find(m => m.id.includes(modelId) || m.name.toLowerCase().includes(modelId));

    if (!model) {
      return interaction.editReply(`❌ Couldn't find a model matching \`${modelId}\`. Try \`/search\` first.`);
    }

    let schema;
    try {
      schema = await fetchSchema(model.schema);
    } catch (e) {
      console.error('[build] Schema fetch error:', e);
      return interaction.editReply(`❌ ${userFacingError(e)}`);
    }

    const schemaSlim = {
      model: model.id,
      air: model.air,
      capabilities: model.capabilities,
      requestSchema: schema?.components?.schemas?.RequestBody,
    };

    let payload;
    try {
      const prompt = `Model schema:\n${JSON.stringify(schemaSlim, null, 2)}\n\nUser request: "${userRequest}"\n\nGenerate the API request JSON array.`;
      const raw     = await callRunware(prompt);
      const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      payload = JSON.parse(cleaned);
    } catch (e) {
      console.error('[build] AI call / parse error:', e);
      return interaction.editReply(`❌ ${userFacingError(e)}`);
    }

    const formatted = JSON.stringify(payload, null, 2);

    const header = new EmbedBuilder()
      .setColor(0xF59E0B)
      .setTitle(`🔨 API Call — ${model.name}`)
      .setDescription(`Request: *"${userRequest}"*`)
      .addFields({
        name: 'Usage',
        value: 'POST this JSON array to `https://api.runware.ai/v1`\nAdd `Authorization: Bearer YOUR_API_KEY` header.',
        inline: false,
      })
      .setFooter({ text: 'Review the payload before using — always double-check required fields!' });

    await interaction.editReply({ embeds: [header] });

    // Split if over 1900 chars to stay safely under Discord's 2000-char limit
    if (formatted.length <= 1900) {
      await interaction.followUp(codeBlock('json', formatted));
    } else {
      const lines = formatted.split('\n');
      let chunk = '';
      let isFirst = true;
      for (const line of lines) {
        if ((chunk + line + '\n').length > 1800) {
          await interaction.followUp(codeBlock('json', (isFirst ? '' : '// ...continued\n') + chunk));
          chunk = '';
          isFirst = false;
        }
        chunk += line + '\n';
      }
      if (chunk) await interaction.followUp(codeBlock('json', '// ...continued\n' + chunk));
    }
  },
};
