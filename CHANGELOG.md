# Changelog

All notable changes to this project will be documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.1.0] — Security hardening release

### Security

- **Rate limiting** (`rateLimiter.js`) — Added per-user in-memory cooldowns for every
  command. AI commands have 20–30 s cooldowns (each call costs Runware inference
  credits); catalogue commands have 3–10 s cooldowns for spam protection. Cooldown
  replies are ephemeral so they don't clutter the channel.

- **Prompt injection hardening** (`utils/sanitize.js`) — User-supplied strings in
  `/build` and `/recommend` are now passed through `sanitizePromptInput()` before
  interpolation into AI prompts. Strips control characters and common injection vectors
  (backticks, backslashes) and hard-caps input at 500 characters.

- **Error message sanitization** (`utils/errors.js`) — Raw Runware API error bodies,
  HTTP status codes, and internal exception messages no longer reach Discord users.
  `userFacingError()` maps all internal errors to safe generic strings. Full errors
  continue to be logged server-side via `console.error`.

- **Request timeouts** (`utils/fetch.js`) — All outbound `fetch()` calls are now
  wrapped in `fetchWithTimeout()` with an `AbortController`. Timeouts: 10 s for schema
  and catalogue fetches, 15 s for the model index, 30 s for AI inference calls. A
  hanging upstream service can no longer block a deferred interaction indefinitely.

- **SSRF protection** (`modelCache.js`) — `fetchSchema()` and video-model enrichment
  now call `assertSafeUrl()` before making any request. URLs are checked against an
  allowlist of trusted Runware origins (`runware.ai`, `cdn.runware.ai`,
  `assets.runware.ai`). A tampered model index cannot cause the bot to fetch arbitrary
  internal or external URLs.

- **Role-based access control** (`index.js`) — New optional `AI_COMMAND_ROLE_ID`
  environment variable. When set, `/build`, `/recommend`, and `/compare` are restricted
  to Discord members holding that role. The check happens in `interactionCreate` before
  the command handler runs. Rejection replies are ephemeral.

- **Input length limits** (all commands) — `setMaxLength(100)` added to model ID
  options; `setMaxLength(500)` added to free-text options (`request`, `usecase`).
  Limits are enforced by Discord before the payload reaches the bot.

- **Snapshot validation** (`commands/new.js`) — `loadSnapshot()` now validates that the
  parsed JSON is a plain object before passing it to `diffModels()`. A corrupted or
  hand-edited snapshot file is discarded and logged rather than causing a silent crash.

- **Global error handlers** (`index.js`) — Added `process.on('unhandledRejection')` and
  `process.on('uncaughtException')` so async errors that escape `try/catch` blocks are
  logged to the console rather than silently swallowed or crashing the process
  without a trace.

- **Audit logging** (`index.js`) — Every slash command invocation now writes a single
  log line containing the command name, user tag, user ID, and guild ID. Provides a
  basic paper trail for debugging and abuse investigation.

- **Button collector cleanup** (`commands/compare.js`) — The `/compare` collector's
  `end` handler now removes all components from the reply (`components: []`) rather
  than leaving a permanently disabled button row.

### Changed

- **`callClaude` renamed to `callRunware`** in `commands/build.js` and
  `commands/recommend.js`. The function name now reflects that calls go through
  Runware's `textInference` endpoint rather than the Anthropic SDK directly.

- **Hardcoded AI model string centralised** — `anthropic:claude@sonnet-4.6` has been
  removed from `commands/build.js`, `commands/recommend.js`, and `commands/compare.js`
  and moved to `config.js` as `inferenceModel`. Override at runtime with the
  `INFERENCE_MODEL` environment variable.

- **Generic catch-all error reply** (`index.js`) — The fallback error message shown
  when a command throws an uncaught exception now uses `ephemeral: true`.

### Added

- `rateLimiter.js` — Per-user in-memory cooldown tracker (resets on restart).
- `config.js` — Shared configuration (`inferenceModel`; extensible for future values).
- `utils/sanitize.js` — `sanitizePromptInput()` helper.
- `utils/errors.js` — `userFacingError()` helper.
- `utils/fetch.js` — `fetchWithTimeout()` AbortController wrapper.
- `modelCache.js` — Race condition fix: concurrent cold-start calls now share a single
  in-flight `fetchPromise` instead of launching parallel requests.
- `.env.example` — Added `AI_COMMAND_ROLE_ID`, `ANNOUNCE_CHANNEL_ID`, and
  `INFERENCE_MODEL` entries with inline documentation.

---

## [1.0.0] — Initial release

- Eight slash commands: `/search`, `/info`, `/build`, `/recommend`, `/compare`,
  `/pricing`, `/new`, `/changelog`.
- In-memory model catalogue cache refreshed hourly from Runware's model index.
- AI-powered commands (`/build`, `/recommend`, `/compare`) using Runware
  `textInference` with Claude Sonnet 4.6.
- Automatic new-model announcements via background watcher when `ANNOUNCE_CHANNEL_ID`
  is configured.
- Persistent model snapshot for `/new` diff tracking across bot restarts.
