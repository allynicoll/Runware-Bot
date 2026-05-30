// commands/build.js
// /build [model-id] [request] — AI-powered API call builder
// Uses Runware's textInference endpoint with Claude Sonnet 4.6

const { SlashCommandBuilder, EmbedBuilder, codeBlock } = require('discord.js');
const { getModels, fetchSchema } = require('../modelCache');

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

  // Check for API-level errors
  if (data?.errors?.length) {
    throw new Error(data.errors[0].message || 'Unknown API error');
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
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('request')
        .setDescription('What do you want to generate? (e.g. "a 16:9 photorealistic cat, high creativity")')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    const modelId = interaction.options.getString('model').toLowerCase().trim();
    const userRequest = interaction.options.getString('request') || 'a photorealistic image with default settings';

    const allModels = await getModels();
    let model = allModels.find(m => m.id === modelId);
    if (!model) model = allModels.find(m => m.id.includes(modelId) || m.name.toLowerCase().includes(modelId));

    if (!model) {
      return interaction.editReply(`❌ Couldn't find a model matching \`${modelId}\`. Try \`/search\` first.`);
    }

    let schema;
    try {
      schema = await fetchSchema(model.schema);
    } catch (e) {
      return interaction.editReply(`❌ Failed to fetch schema: ${e.message}`);
    }

    // Strip down the schema to just what Claude needs — keeps token usage low
    const schemaSlim = {
      model: model.id,
      air: model.air,
      capabilities: model.capabilities,
      requestSchema: schema?.components?.schemas?.RequestBody,
    };

    let payload;
    try {
      const prompt = `Model schema:\n${JSON.stringify(schemaSlim, null, 2)}\n\nUser request: "${userRequest}"\n\nGenerate the API request JSON array.`;
      const raw = await callClaude(prompt);
      // Strip any accidental markdown fences
      const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      payload = JSON.parse(cleaned);
    } catch (e) {
      return interaction.editReply(`❌ Failed to generate API call: ${e.message}`);
    }

    const formatted = JSON.stringify(payload, null, 2);

    const header = new EmbedBuilder()
      .setColor(0xF59E0B)
      .setTitle(`🔨 API Call — ${model.name}`)
      .setDescription(`Request: *"${userRequest}"*`)
      .addFields({
        name: 'Usage',
        value: 'POST this JSON array to `https://api.runware.ai/v1`\nAdd `Authorization: Bearer YOUR_API_KEY` header.',
        inline: false
      })
      .setFooter({ text: 'Review the payload before using — always double-check required fields!' });

    await interaction.editReply({ embeds: [header] });

    // Send the JSON as a follow-up code block
    // Split if over 1900 chars to stay safely under Discord's 2000 limit
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
  }
};
