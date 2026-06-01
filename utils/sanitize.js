// utils/sanitize.js
// Cleans user-supplied strings before they are interpolated into AI prompts.
// Not a silver bullet against prompt injection — defence in depth alongside
// system-prompt framing and JSON output parsing — but removes the easiest vectors.

const MAX_PROMPT_INPUT = 500;

/**
 * Strip control characters and characters commonly used in prompt-injection
 * attempts (backticks, backslashes), then truncate to maxLength.
 *
 * @param {string} raw
 * @param {number} maxLength  - defaults to MAX_PROMPT_INPUT (500)
 * @returns {string}
 */
function sanitizePromptInput(raw, maxLength = MAX_PROMPT_INPUT) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\x00-\x1F\x7F]/g, ' ')   // control characters → space
    .replace(/[`\\]/g, ' ')              // backticks and backslashes → space
    .slice(0, maxLength)
    .trim();
}

module.exports = { sanitizePromptInput };
