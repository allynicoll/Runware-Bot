// config.js
// Central home for configuration values that are referenced across multiple files.
// Keeps magic strings out of individual commands and makes future changes a one-liner.

module.exports = {
  // Runware textInference model used by /build, /recommend, and /compare.
  // Override with INFERENCE_MODEL in .env if Runware changes the model identifier.
  inferenceModel: process.env.INFERENCE_MODEL || 'anthropic:claude@sonnet-4.6',
};
