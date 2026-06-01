// utils/errors.js
// Maps internal errors to safe user-facing messages so raw API details
// (status codes, Runware error bodies, file paths) never reach Discord users.
// Full errors are always logged server-side before calling this helper.

/**
 * Return a short, safe string suitable for sending to a Discord user.
 *
 * @param {Error|null} e
 * @returns {string}
 */
function userFacingError(e) {
  if (!e) return 'An unexpected error occurred. Please try again.';
  if (e.name === 'AbortError') return 'The request timed out — please try again.';

  const msg = String(e.message || '');
  if (msg.includes('Runware API error'))      return 'The Runware API returned an error. Try again in a moment.';
  if (msg.includes('Failed to fetch') ||
      msg.includes('fetch failed'))           return 'Could not reach an external service. Try again shortly.';
  if (msg.includes('Blocked fetch to'))       return 'An internal safety check blocked that request.';
  if (msg.includes('Invalid URL'))            return 'A malformed URL was encountered internally.';
  if (msg.includes('timed out') ||
      msg.includes('timeout'))                return 'The request timed out — please try again.';

  return 'Something went wrong. Please try again.';
}

module.exports = { userFacingError };
