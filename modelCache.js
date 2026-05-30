// modelCache.js
// Fetches the Runware model index and caches it in memory.
// Refreshes every hour automatically.
// On load, enriches video models with schema-derived features (e.g. "audio").

const INDEX_URL = 'https://runware.ai/docs/models/index.json';
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let cachedModels = [];
let lastFetched = null;

// ─── Schema feature extraction ────────────────────────────────────────────────

/**
 * Walk a JSON Schema object and return a Set of feature strings.
 * Currently detects: "audio"
 * Easy to extend — just add more checks below.
 */
function extractFeatures(schema) {
  const features = new Set();
  const text = JSON.stringify(schema).toLowerCase();

  // Audio: look for any audio-related field names or descriptions anywhere in schema
  const audioSignals = [
    'generateaudio', 'includeaudio', 'hasaudio', 'audioenabled',
    'audio_output', 'withaudio', 'audiosettings', '"native audio"',
    '"with audio"', '"audio output"',
  ];
  if (audioSignals.some(sig => text.includes(sig))) {
    features.add('audio');
  }

  return features;
}

/**
 * Fetch schemas for video-capable models and attach a `features` array.
 * Runs concurrently with a concurrency cap to avoid hammering the CDN.
 */
async function enrichVideoModels(models) {
  const VIDEO_CAPS = ['text-to-video', 'image-to-video', 'video-to-video', 'audio-to-video'];
  const videoModels = models.filter(m =>
    m.capabilities?.some(c => VIDEO_CAPS.includes(c)) && m.schemaUrl
  );

  console.log(`[Cache] Enriching ${videoModels.length} video models with schema features...`);

  const CONCURRENCY = 8;
  let index = 0;

  async function worker() {
    while (index < videoModels.length) {
      const model = videoModels[index++];
      try {
        const res = await fetch(model.schemaUrl);
        if (!res.ok) continue;
        const schema = await res.json();
        const features = extractFeatures(schema);
        model.features = [...features];
      } catch {
        // Schema fetch failed — leave features undefined, not a fatal error
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const enriched = videoModels.filter(m => m.features?.length > 0);
  console.log(`[Cache] ${enriched.length} video models have detected features.`);
}

// ─── Core cache logic ─────────────────────────────────────────────────────────

async function fetchModels() {
  console.log('[Cache] Fetching model index from Runware...');
  const res = await fetch(INDEX_URL);
  if (!res.ok) throw new Error(`Failed to fetch model index: ${res.status}`);
  const data = await res.json();
  await enrichVideoModels(data);   // mutates video models in-place, adds .features
  cachedModels = data;
  lastFetched = Date.now();
  console.log(`[Cache] Loaded ${cachedModels.length} models.`);
  return cachedModels;
}

async function getModels() {
  if (!lastFetched || Date.now() - lastFetched > REFRESH_INTERVAL_MS) {
    await fetchModels();
  }
  return cachedModels;
}

async function fetchSchema(schemaUrl) {
  const res = await fetch(schemaUrl);
  if (!res.ok) throw new Error(`Failed to fetch schema: ${res.status}`);
  return res.json();
}

// Start background refresh
setInterval(async () => {
  try { await fetchModels(); }
  catch (e) { console.error('[Cache] Background refresh failed:', e.message); }
}, REFRESH_INTERVAL_MS);

module.exports = { getModels, fetchSchema };
