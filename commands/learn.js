// commands/learn.js
// /learn [topic] [question] — Runware API documentation assistant
// Fetches official docs and answers questions or explains topics via AI.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { checkCooldown }       = require('../rateLimiter');
const { sanitizePromptInput } = require('../utils/sanitize');
const { userFacingError }     = require('../utils/errors');
const { fetchWithTimeout }    = require('../utils/fetch');
const { inferenceModel }      = require('../config');

// ── Topic registry ────────────────────────────────────────────────────────────
// Each entry maps a Discord choice to a live doc URL.
// .md files → served as clean markdown
// schema.json files → served as OpenAPI 3.1 JSON

const TOPICS = [
  // Platform
  { name: 'Introduction & Getting Started', value: 'introduction',   category: 'Platform',            url: 'https://runware.ai/docs/platform/introduction.md',                   description: 'Overview of the Runware API, core concepts, and making your first request.' },
  { name: 'Authentication',                 value: 'authentication', category: 'Platform',            url: 'https://runware.ai/docs/platform/authentication/schema.json',         description: 'API key auth, authorization headers, and connection setup.' },
  { name: 'Pricing',                        value: 'pricing',        category: 'Platform',            url: 'https://runware.ai/docs/platform/pricing.md',                        description: 'How billing works, serverless vs serverful pricing, and cost optimization.' },
  { name: 'Rate Limits',                    value: 'rate-limits',    category: 'Platform',            url: 'https://runware.ai/docs/platform/rate-limits.md',                    description: 'Request rate limits, throttling, and building resilient integrations.' },
  { name: 'Errors & Error Handling',        value: 'errors',         category: 'Platform',            url: 'https://runware.ai/docs/platform/errors.md',                         description: 'Error codes, error response format, and handling failures gracefully.' },
  { name: 'Webhooks',                       value: 'webhooks',       category: 'Platform',            url: 'https://runware.ai/docs/platform/webhooks.md',                       description: 'Async result delivery via webhooks, setup, payload structure, and security.' },
  { name: 'Streaming',                      value: 'streaming',      category: 'Platform',            url: 'https://runware.ai/docs/platform/streaming.md',                      description: 'Real-time streaming for progressive image and video results.' },
  { name: 'Task Polling',                   value: 'task-polling',   category: 'Platform',            url: 'https://runware.ai/docs/platform/task-polling.md',                   description: 'Polling for async task results when webhooks are not available.' },
  // SDKs & Integrations
  { name: 'JavaScript SDK',                 value: 'javascript',     category: 'SDKs & Integrations', url: 'https://runware.ai/docs/platform/javascript.md',                     description: 'Official JavaScript/Node.js SDK: installation, setup, and usage examples.' },
  { name: 'Python SDK',                     value: 'python',         category: 'SDKs & Integrations', url: 'https://runware.ai/docs/platform/python.md',                         description: 'Official Python SDK: installation, async support, and code examples.' },
  { name: 'ComfyUI Integration',            value: 'comfyui',        category: 'SDKs & Integrations', url: 'https://runware.ai/docs/platform/comfyui.md',                        description: 'Using Runware as a backend for ComfyUI workflows.' },
  { name: 'Vercel AI SDK',                  value: 'vercel-ai',      category: 'SDKs & Integrations', url: 'https://runware.ai/docs/platform/vercel-ai.md',                      description: 'Integrating Runware with Vercel\'s AI SDK in Next.js applications.' },
  { name: 'OpenAI Compatibility',           value: 'openai',         category: 'SDKs & Integrations', url: 'https://runware.ai/docs/platform/openai.md',                         description: 'Using Runware as an OpenAI-compatible drop-in replacement.' },
  // Utilities
  { name: 'Model Search API',               value: 'model-search',   category: 'Utilities',           url: 'https://runware.ai/docs/platform/model-search/schema.json',          description: 'Searching and filtering the model catalogue programmatically.' },
  { name: 'Model Upload',                   value: 'model-upload',   category: 'Utilities',           url: 'https://runware.ai/docs/platform/model-upload/schema.json',          description: 'Uploading custom models to use in your Runware pipelines.' },
  { name: 'Account Management',             value: 'account',        category: 'Utilities',           url: 'https://runware.ai/docs/platform/account-management/schema.json',    description: 'Fetching account details, balance, usage statistics, and API keys.' },
  { name: 'Image Upload',                   value: 'image-upload',   category: 'Utilities',           url: 'https://runware.ai/docs/platform/image-upload/schema.json',          description: 'Uploading images to use as inputs for image-to-image and editing tasks.' },
  { name: 'Task Details',                   value: 'task-details',   category: 'Utilities',           url: 'https://runware.ai/docs/platform/task-details.md',                   description: 'Retrieving details and status of previously submitted tasks.' },
];

const TOPIC_BY_VALUE = Object.fromEntries(TOPICS.map(t => [t.value, t]));

// ── In-memory doc cache ───────────────────────────────────────────────────────
// Docs are fetched on first use per topic and cached for 1 hour.
// Avoids hammering Runware's CDN on every command, keeps responses fast.

const docCache   = new Map(); // value -> { content: string, fetchedAt: number }
const CACHE_TTL  = 60 * 60 * 1000; // 1 hour
const MAX_CHARS  = 40_000;          // safety cap before sending to AI

async function fetchDoc(topic) {
  const cached = docCache.get(topic.value);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.content;

  const res = await fetchWithTimeout(topic.url, {}, 10_000);
  if (!res.ok) throw new Error(`Failed to fetch documentation for "${topic.name}"`);
  const content = (await res.text()).slice(0, MAX_CHARS);

  docCache.set(topic.value, { content, fetchedAt: Date.now() });
  return content;
}

// ── AI helpers ────────────────────────────────────────────────────────────────

const EXPLAIN_SYSTEM = `You are a friendly Runware API documentation assistant inside a Discord bot.
Explain the provided Runware API topic clearly to developers.

Formatting (strictly follow these):
- Use Discord markdown: **bold** for key terms, \`code\` for parameter names, \`\`\`json code blocks for examples
- Write in short paragraphs — no long walls of text
- Do NOT use markdown headers (no ##) — use **Bold label:** instead
- Aim for 700–1200 characters total
- Do not reproduce the entire doc — summarise, explain what matters, give one concrete example
- End with a single "💡 **Tip:**" line highlighting a gotcha or best practice`;

const ANSWER_SYSTEM = `You are a helpful Runware API documentation assistant inside a Discord bot.
Answer the user's question using only the documentation provided.

Formatting (strictly follow these):
- Use Discord markdown: **bold** for key terms, \`code\` for parameter names, \`\`\`json code blocks for short examples
- Answer the question directly first, then add context if needed
- Do NOT use markdown headers (no ##) — use **Bold label:** instead
- Aim for 400–1000 characters
- If the docs don't cover the question, say so clearly rather than guessing`;

const ROUTE_SYSTEM = `You are a documentation topic router for the Runware API.
Given a user's question and a list of topics, return a JSON array of 1–3 topic "value" strings most relevant to answering the question.
Return ONLY a valid JSON array of strings, nothing else. Example: ["errors","rate-limits"]`;

async function callRunware(systemPrompt, userPrompt, maxTokens = 1024) {
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
      messages: [{ role: 'user', content: userPrompt }],
      settings: { systemPrompt, maxTokens },
    }]),
  }, 30_000);

  if (!response.ok) {
    console.error('[learn] Runware API error:', response.status);
    throw new Error('Runware API error');
  }

  const data = await response.json();
  if (data?.errors?.length) {
    console.error('[learn] Runware API-level error:', data.errors[0]);
    throw new Error('Runware API error');
  }
  const text = data?.data?.[0]?.text;
  if (!text) throw new Error('No text in response from Runware');
  return text.trim();
}

// Stage 1 of question mode: ask AI which topics are relevant
async function routeQuestion(question) {
  const topicList = TOPICS.map(t => `"${t.value}": ${t.description}`).join('\n');
  const prompt = `User question: "${question}"\n\nAvailable topics:\n${topicList}\n\nReturn a JSON array of 1–3 most relevant topic values.`;

  try {
    const raw     = await callRunware(ROUTE_SYSTEM, prompt, 80);
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed  = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(v => TOPIC_BY_VALUE[v]).slice(0, 3);
  } catch (e) {
    console.error('[learn] Routing error:', e.message);
    return [];
  }
}

// ── Index embed ───────────────────────────────────────────────────────────────

function buildIndexEmbed() {
  const byCategory = {};
  for (const t of TOPICS) {
    if (!byCategory[t.category]) byCategory[t.category] = [];
    byCategory[t.category].push(t);
  }

  const emoji = { 'Platform': '⚙️', 'SDKs & Integrations': '🔌', 'Utilities': '🛠️' };

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📚 Runware API — Learning Hub')
    .setDescription(
      'Pick a topic with `/learn topic:[name]` for an explanation, or ask anything with `/learn question:[your question]` and the right docs are found automatically.'
    );

  for (const [cat, topics] of Object.entries(byCategory)) {
    embed.addFields({
      name: `${emoji[cat] || '📄'} ${cat}`,
      value: topics.map(t => `\`${t.name}\``).join('  ·  '),
      inline: false,
    });
  }

  embed.setFooter({ text: 'Sourced from official Runware documentation · runware.ai/docs' });
  return embed;
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('learn')
    .setDescription('Explore Runware API docs or ask a question — answered from official documentation')
    .addStringOption(opt =>
      opt.setName('topic')
        .setDescription('Browse a specific documentation topic')
        .setRequired(false)
        .addChoices(...TOPICS.map(t => ({ name: t.name, value: t.value }))))
    .addStringOption(opt =>
      opt.setName('question')
        .setDescription('Ask anything about the Runware API')
        .setMaxLength(500)
        .setRequired(false)),

  async execute(interaction) {
    const topicValue = interaction.options.getString('topic');
    const rawQuestion = interaction.options.getString('question');
    const question = rawQuestion ? sanitizePromptInput(rawQuestion) : null;

    // No args → show the topic index (no cooldown needed, no AI call)
    if (!topicValue && !question) {
      return interaction.reply({ embeds: [buildIndexEmbed()] });
    }

    // AI-powered path — apply cooldown before deferring
    const wait = checkCooldown(interaction.user.id, 'learn');
    if (wait) {
      return interaction.reply({
        content: `⏱️ Please wait **${wait}s** before using \`/learn\` again.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    // ── Path A: topic selected (with optional question scoped to that topic) ──
    if (topicValue) {
      const topic = TOPIC_BY_VALUE[topicValue];
      if (!topic) return interaction.editReply('❌ Unknown topic. Use `/learn` to see all available topics.');

      let docContent;
      try {
        docContent = await fetchDoc(topic);
      } catch (e) {
        console.error('[learn] Doc fetch error:', e);
        return interaction.editReply(`❌ ${userFacingError(e)}`);
      }

      let aiResponse;
      try {
        if (question) {
          // Answer a specific question scoped to this topic's doc
          const prompt = `Documentation — ${topic.name}:\n\n${docContent}\n\n---\n\nUser question: "${question}"\n\nAnswer the question using only the documentation above.`;
          aiResponse = await callRunware(ANSWER_SYSTEM, prompt, 1024);
        } else {
          // Explain the topic from scratch
          const prompt = `Documentation — ${topic.name}:\n\n${docContent}\n\n---\n\nExplain this topic clearly for a developer integrating with the Runware API.`;
          aiResponse = await callRunware(EXPLAIN_SYSTEM, prompt, 1200);
        }
      } catch (e) {
        console.error('[learn] AI call error:', e);
        return interaction.editReply(`❌ ${userFacingError(e)}`);
      }

      const docPath = topic.url.replace('https://runware.ai', 'runware.ai');
      const embed   = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle(question ? `❓ ${topic.name}` : `📖 ${topic.name}`)
        .setFooter({ text: `Source: ${docPath}` });

      const description = question
        ? `*"${question}"*\n\n${aiResponse}`
        : aiResponse;

      embed.setDescription(description.slice(0, 4000));
      return interaction.editReply({ embeds: [embed] });
    }

    // ── Path B: question only — route to relevant docs automatically ──────────
    const relevantValues = await routeQuestion(question);

    if (!relevantValues.length) {
      return interaction.editReply(
        `😕 Couldn't find relevant docs for *"${question}"*. Try \`/learn\` to browse topics manually, or rephrase your question.`
      );
    }

    // Fetch all relevant docs concurrently
    let combinedDoc;
    try {
      const results = await Promise.all(relevantValues.map(v => fetchDoc(TOPIC_BY_VALUE[v])));
      combinedDoc = results
        .map((content, i) => `=== ${TOPIC_BY_VALUE[relevantValues[i]].name} ===\n\n${content}`)
        .join('\n\n---\n\n')
        .slice(0, 40_000);
    } catch (e) {
      console.error('[learn] Doc fetch error (question path):', e);
      return interaction.editReply(`❌ ${userFacingError(e)}`);
    }

    let aiResponse;
    try {
      const prompt = `Documentation:\n\n${combinedDoc}\n\n---\n\nUser question: "${question}"\n\nAnswer the question using only the documentation above.`;
      aiResponse = await callRunware(ANSWER_SYSTEM, prompt, 1024);
    } catch (e) {
      console.error('[learn] AI answer error:', e);
      return interaction.editReply(`❌ ${userFacingError(e)}`);
    }

    const sourceNames = relevantValues.map(v => TOPIC_BY_VALUE[v].name).join(' · ');
    const embed = new EmbedBuilder()
      .setColor(0x8B5CF6)
      .setTitle('❓ Question')
      .setDescription(`*"${question}"*\n\n${aiResponse}`.slice(0, 4000))
      .setFooter({ text: `Sources: ${sourceNames} · runware.ai/docs` });

    return interaction.editReply({ embeds: [embed] });
  },
};
