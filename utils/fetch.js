// utils/fetch.js
// Thin wrapper around fetch() that enforces a timeout via AbortController.
// All outbound HTTP calls in this bot should go through fetchWithTimeout
// so a slow or hung upstream can never block a deferred interaction indefinitely.

/**
 * Fetch a URL, aborting if no response arrives within timeoutMs.
 * Throws an AbortError on timeout, which userFacingError() handles gracefully.
 *
 * @param {string} url
 * @param {RequestInit} options  - standard fetch options (method, headers, body…)
 * @param {number} timeoutMs     - abort after this many milliseconds (default 10 s)
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchWithTimeout };
