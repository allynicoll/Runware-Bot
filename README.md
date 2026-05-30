# Runware API Helper Bot

A Discord bot that helps you find Runware models, explore their schemas, and build API calls.

## Commands

| Command | Description |
|---|---|
| `/search` | Filter models by capability, creator, or status |
| `/info [model-id]` | Show parameters and details for a specific model |
| `/build [model-id] [request]` | AI-powered API call builder |

## Setup

### 1. Create your Discord bot

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it "Runware API Helper"
3. Go to **Bot** tab → click **Add Bot** → copy your **Bot Token**
4. Go to **Bot** tab → enable **"applications.commands"** scope
5. Go to **OAuth2 → URL Generator**:
   - Scopes: check `bot` and `applications.commands`
   - Bot Permissions: `Send Messages`, `Use Slash Commands`, `Embed Links`
   - Copy the generated URL and open it to invite the bot to your server

### 2. Get your IDs

You'll need **Developer Mode** on in Discord:  
User Settings → Advanced → Developer Mode ✓

Then:
- **Client ID**: discord.com/developers/applications → your app → General Information → Application ID
- **Guild ID**: Right-click your server name in Discord → Copy Server ID
- **Bot Token**: Bot tab (see above)

### 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in all four values:
```
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
ANTHROPIC_API_KEY=...
```

### 4. Install and run

```bash
npm install
node index.js
```

You should see:
```
[Commands] Registering slash commands to guild...
[Commands] Slash commands registered!
✅ Logged in as Runware API Helper#1234
   Model cache ready: 300+ models loaded
```

The bot is now online! Try `/search capability:text-to-image` in your server.

## Keeping it running

For a local machine, the bot runs as long as the terminal window is open.  
Close the terminal → bot goes offline.

To run it in the background on Windows, you can use:
```bash
npm install -g pm2
pm2 start index.js --name runware-bot
pm2 save
```

## Troubleshooting

**"Missing required environment variables"** → Check your `.env` file has all four values with no spaces around the `=`

**Commands not showing up in Discord** → They're registered to your specific guild and should appear within seconds. Try typing `/` in your test channel.

**"Failed to fetch schema"** → Runware's API might be temporarily unreachable. Try again in a moment.
