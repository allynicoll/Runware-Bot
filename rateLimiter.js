// rateLimiter.js
// Simple in-memory per-user cooldown tracker for slash commands.
// Resets on bot restart — lightweight, no persistence needed.
// For multi-instance deployments, swap the Map for a Redis store.

const cooldowns = new Map(); // Map<userId, Map<commandName, lastUsedMs>>

// Cooldown windows in milliseconds per command.
// AI commands are longer because each call consumes paid Runware inference credits.
const COOLDOWNS_MS = {
  build:     30_000,   // 30 s — paid AI inference
  recommend: 20_000,   // 20 s — paid AI inference
  compare:   30_000,   // 30 s — 2 schema fetches + paid AI inference
  learn:     20_000,   // 20 s — doc fetch + paid AI inference (1–2 calls)
  search:     3_000,   // 3 s  — free, spam protection only
  info:       3_000,
  pricing:    5_000,
  new:       10_000,
  changelog: 10_000,
};

/**
 * Check whether userId is within their cooldown window for commandName.
 * Records the use if the user is allowed through.
 *
 * @param {string} userId
 * @param {string} commandName
 * @returns {number|null} Seconds remaining if on cooldown, or null if allowed.
 */
function checkCooldown(userId, commandName) {
  const limitMs = COOLDOWNS_MS[commandName];
  if (!limitMs) return null;

  if (!cooldowns.has(userId)) cooldowns.set(userId, new Map());
  const userMap = cooldowns.get(userId);
  const lastUsed = userMap.get(commandName) ?? 0;
  const elapsed = Date.now() - lastUsed;

  if (elapsed < limitMs) {
    return Math.ceil((limitMs - elapsed) / 1000);
  }

  userMap.set(commandName, Date.now());
  return null;
}

module.exports = { checkCooldown };
