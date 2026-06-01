# Runware API Helper Bot

A Discord bot for exploring the Runware model catalogue, understanding schemas, generating ready-to-use API calls, and staying up to date with new releases — all without leaving Discord.

## Commands

| Command | Description |
|---|---|
| `/search` | Filter models by capability, creator, or status |
| `/info [model]` | Show schema, parameters, and docs links for a specific model |
| `/build [model] [request]` | AI-generated, ready-to-use API request payload |
| `/recommend [usecase]` | Describe what you want to make; AI picks the best model |
| `/compare [model-a] [model-b]` | Side-by-side parameter diff for two models of the same type |
| `/pricing [model]` | Pricing info and cost examples from the model's schema |
| `/new` | Show models added or gone live since the last check |
| `/changelog` | Display the latest Runware platform changelog entries |

---

### `/search`

Filter the full Runware catalogue by any combination of:
- **capability** — 21 types including `text-to-image`, `image-to-video`, `upscale`, `remove-background`, `prompt-enhance`, and more
- **creator** — partial match, e.g. `Black Forest Labs`, `Google`
- **status** — `Live`, `API Only`, `Coming Soon`, or `Deprecated`

Results are grouped by creator with status indicators (🟢 Live · 🔵 API Only · 🟡 Coming Soon · 🔴 Deprecated). Capped at 20 embed fields.

---

### `/info [model]`

Accepts a model ID, partial ID, or partial name (fuzzy match). Returns:
- Model ID, AIR identifier, status, and creator
- Links to the model page and API docs on runware.ai
- All required and optional parameters with types, defaults, and value ranges
- Allowed image/video dimensions where applicable

---

### `/build [model] [request]`

Generates a complete, valid JSON array ready to POST to `https://api.runware.ai/v1`. Describe what you want in plain English (e.g. `"a 1920×1080 photorealistic cat, high creativity"`) and the bot fills in all required fields, picks valid dimensions, and assigns a task UUID. Uses Runware's `textInference` task with Claude Sonnet 4.6 under the hood.

---

### `/recommend [usecase]`

Tell the bot what you're trying to make and it returns up to 3 ranked model recommendations (live and API-only models only), each with a plain-English reason and a best-for label. Results include quick-access hints for `/info` and `/build`.

---

### `/compare [model-a] [model-b]`

Side-by-side schema diff, limited to models of the same primary capability type. Shows:
- Parameters unique to each model
- Parameters present in both but with different types, defaults, or ranges
- A count of identical shared parameters (expandable via interactive button, active for 2 minutes)
- An AI-generated 2–3 sentence plain-English summary of the tradeoffs

---

### `/pricing [model]`

Reads pricing from the model schema's `x-pricing` field. Shows an overview and example cost table where available. Also notes that adding `"includeCost": true` to any API call returns the exact per-request cost in the response.

---

### `/new`

On first run, snapshots all current models to disk (`.model-snapshot.json`). On subsequent runs, compares against the snapshot to show newly added models and models that transitioned from `coming-soon` to `live` or `api-only`. The snapshot survives bot restarts.

**Auto-announcements:** if `ANNOUNCE_CHANNEL_ID` is set in `.env`, the bot also checks for new models every hour in the background and automatically posts to that channel — no command needed.

---

### `/changelog`

Fetches the latest 3 entries from the Runware platform changelog RSS feed and displays them with dates and links.

---

## Setup

### 1. Create your Discord bot

1. Go to https://discord.com/developers/applications
2. Click **New Application** → give it a name
3. Go to **Bot** tab → click **Reset Token** → copy your **Bot Token**
4. No extra Privileged Gateway Intents are required
5. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot` and `applications.commands`
   - Bot Permissions: `Send Messages`, `Use Slash Commands`, `Embed Links`
   - Copy the generated URL and open it to invite the bot to your server

### 2. Get your IDs

Enable **Developer Mode** in Discord:
User Settings → Advanced → Developer Mode ✓

Then:
- **Client ID**: discord.com/developers/applications → your app → General Information → Application ID
- **Guild ID**: Right-click your server name in Discord → Copy Server ID
- **Bot Token**: Bot tab (see step 1)

### 3. Get your Runware API key

Sign up at [runware.ai](https://runware.ai) and grab an API key from your dashboard. This one key covers everything — model catalogue fetching, schema lookups, and the AI-powered commands (`/build`, `/recommend`, `/compare`).

### 4. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the values:

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_server_id
RUNWARE_API_KEY=your_runware_api_key

# Optional: post new-model announcements to this channel automatically
ANNOUNCE_CHANNEL_ID=
```

### 5. Install and run

```bash
npm install
node index.js
```

Expected startup output:

```
[Commands] Registering slash commands to guild...
[Commands] Slash commands registered!
✅ Logged in as YourBot#1234
   Serving guild: 123456789012345678
   Model cache ready: 300+ models loaded
```

Slash commands are guild-scoped and appear within seconds. Try `/search` in your server.

---

## Architecture

| Component | Detail |
|---|---|
| Framework | discord.js v14 |
| API | Runware REST API (`https://api.runware.ai/v1`) |
| LLM | Claude Sonnet 4.6 via Runware `textInference` task |
| Model catalogue | `runware.ai/docs/models/index.json`, refreshed hourly in memory |
| Schemas | Fetched on-demand per model from Runware's CDN |
| Persistence | `.model-snapshot.json` for `/new` diff tracking |

All AI inference goes through the Runware API using the `RUNWARE_API_KEY` — no separate Anthropic key is needed.

---

## Keeping it running

The bot runs as long as the terminal is open. To keep it alive in the background:

```bash
npm install -g pm2
pm2 start index.js --name runware-bot
pm2 save
pm2 startup    # follow the printed command to auto-start on reboot
```

---

## Troubleshooting

**"Missing required environment variables"** → Check your `.env` has all four required values with no spaces around `=`.

**Commands not showing in Discord** → They're guild-scoped and should appear within seconds of startup. Try restarting the bot.

**"Failed to fetch schema"** → Runware's CDN may be temporarily unreachable. Try the command again in a moment.

**AI commands return an error** → Verify your `RUNWARE_API_KEY` is valid and your account has sufficient credits. `/build`, `/recommend`, and the `/compare` AI summary all consume inference credits.

**`/new` shows nothing** → Either no models have changed since the last snapshot, or this is the bot's first run (snapshot was just created — check back after the next hourly cycle).

**Watcher not posting to the channel** → Confirm `ANNOUNCE_CHANNEL_ID` is set and the bot has `Send Messages` and `Embed Links` permissions in that channel.

---

## Limitations & Future Work

### Current limitations

- **No per-user rate limiting** — Any server member can trigger AI commands (`/build`, `/recommend`, `/compare`), which consume Runware inference credits. There are no cooldowns or per-user caps, so heavy or abusive use could drain your API balance.

- **Schemas are not cached** — Every `/info`, `/build`, `/pricing`, and `/compare` call fetches the model schema fresh from Runware's CDN. Under concurrent use this means repeated outbound requests for the same schemas.

- **Search results are truncated** — Discord embeds are capped at 25 fields. Very broad `/search` queries silently cut off at 20 results with no pagination.

- **Guild-only command registration** — Slash commands are registered to a single guild. Multi-server support would require switching to global registration (with up to 1 hour propagation delay on changes) or separate bot instances.

- **Watcher interval is hardcoded** — The 1-hour new-model check cycle is not configurable without editing the source.

- **No input sanitisation beyond Discord** — Model IDs are resolved via fuzzy match against the cached catalogue but not otherwise validated before being sent to the Runware API.

- **No error monitoring** — Failures are written to `console.error` only. There is no alerting, structured logging, or crash reporting.

### Potential improvements

- **Per-user cooldowns** — An in-memory map (or Redis for persistence across restarts) on AI commands to prevent runaway credit consumption.

- **Schema caching** — Cache schema JSON with a TTL alongside the model catalogue to avoid redundant CDN hits.

- **Paginated search** — Next/prev buttons for result sets that exceed the embed field limit.

- **Configurable watcher interval** — Expose `WATCHER_INTERVAL_MINUTES` as an `.env` variable.

- **Global command registration** — Switch from guild-scoped to global slash commands for multi-server deployments.

- **Ephemeral error replies** — Make error responses ephemeral so they don't clutter shared channels.

- **Security hardening** — Role-based restrictions on AI commands (e.g. require a specific role to use `/build`), command audit logging, and allowlist/denylist support for model IDs or users.

- **Structured logging** — Replace `console.log` with a proper logger (e.g. `pino`) for easier filtering and monitoring.

- **Health check endpoint** — A lightweight HTTP server for uptime monitoring, useful with pm2 or container deployments.

- **Extended feature detection** — Expand the schema feature-extraction in `modelCache.js` beyond audio to surface additional model capabilities automatically.
