# Roadmap

Planned features, ideas under consideration, and work that is blocked pending external changes.
See [CHANGELOG.md](./CHANGELOG.md) for everything already shipped.

---

## 🔜 Up next

### `/status`
Check the live Runware platform status from within Discord — incidents, degraded services, and uptime history sourced directly from the status feed.

> ⏸️ **On hold.** Runware is currently migrating status providers. Implementation will follow once the new status page and its RSS/API surface are confirmed. The existing `/changelog` command's RSS approach already proves the pattern — this is purely a timing dependency.

---

## 💭 Under consideration

Roughly in priority order. Nothing here is committed.

### Real inference — `/generate`, `/upscale`, `/remove-bg`, `/animate`
The bot currently builds API payloads and hands them back to the user. The natural next step is closing the loop: run the inference, get the result, post it directly into Discord as an attachment.

- `/generate [model] [prompt]` — text-to-image, post result in channel
- `/upscale [attach image]` — upscale an attached image
- `/remove-bg [attach image]` — strip the background
- `/animate [attach image] [prompt]` — image-to-video

Everything needed is already in the bot (model resolution, schema parsing, parameter building). This is mainly a matter of adding the actual API call and Discord attachment handling. Needs careful thought around per-user credit limits before opening to a wider audience.

### Multi-language code output for `/build`
Currently outputs a raw JSON array. Adding a `language` option to `/build` would let users get a ready-to-paste Python snippet, `curl` command, or JavaScript `fetch` call instead. Prompt change only — no new infrastructure.

### `/estimate [model] [params]`
Calculate approximate cost before committing to a run, using the schema's `x-pricing` data and user-supplied parameters. Already have the pricing data in `/pricing` — this extends it to calculate rather than just display.

### Schema change detection in `/new`
The watcher currently snapshots which models exist and their status. Extending the snapshot to include schema hashes would let the bot detect when Runware changes a parameter range, adds a field, or deprecates an option — and post those changes to the announcement channel alongside new model alerts.

### Saved presets
Let users save a model + parameter combination under a name and recall it later:
- `/preset save [name] [model] [params]`
- `/preset use [name]` — generates a `/build`-style payload instantly
- `/preset list` — shows saved presets

Needs a lightweight persistence layer (JSON file or SQLite).

### `/stats`
Show usage information for the server: which commands are used most, which models are most popular, how many `/build` calls have been made. Purely internal tracking, no Runware API calls needed. Useful once real inference is live.

### `/agent [goal]`
A multi-step pipeline mode where the bot plans and executes a sequence of Runware operations to reach a goal: "make a product photo with the background removed and upscaled to 4K" would orchestrate three separate API calls rather than requiring the user to run each step manually. Depends on real inference being in place first.

### `/learn` guide topics
Extend the learning hub (`/learn`) beyond platform and SDK docs to include Runware's hands-on workflow guides: text-to-image, image inpainting, outpainting, ControlNet, LoRA usage, etc.

---

## ✅ Shipped

| Version | What shipped |
|---|---|
| 1.2.0 | `/learn` — AI-powered documentation assistant with topic browsing and free-form Q&A |
| 1.1.0 | Security hardening: rate limiting, prompt sanitisation, error sanitisation, request timeouts, SSRF protection, RBAC, input length limits, snapshot validation, audit logging, global error handlers |
| 1.0.0 | Initial release: `/search`, `/info`, `/build`, `/recommend`, `/compare`, `/pricing`, `/new`, `/changelog` |
