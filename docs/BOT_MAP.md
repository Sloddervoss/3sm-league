# BOT_MAP

## Package

- Bot directory: `bot/`
- Package file: `bot/package.json`
- Module type: ESM (`"type": "module"`)
- Scripts:
  - `npm start` -> `node index.js`
  - `npm test` -> `node --test *.test.js`
- Main dependencies:
  - `discord.js`
  - `@supabase/supabase-js`
  - `dotenv`
  - `node-cron`
  - `sharp`

## Main files

| File | Purpose |
|---|---|
| `bot/index.js` | Main Discord bot entrypoint, slash commands, scheduled jobs, Supabase/Discord integration |
| `bot/logging.js` | Safe log formatting and secret redaction helpers |
| `bot/network.js` | Timeout fetch wrapper, transient error detection, health tracker |
| `bot/streamers.js` | Streamer profile validation/storage and Twitch/Kick/YouTube live checks |
| `bot/racePoster.js` | Optional race reminder poster image generation with `sharp` |
| `bot/resultPoster.js` | Optional result poster image generation with `sharp` |
| `bot/setup.sh` | Installs dependencies and writes/enables `3sm-bot.service` |
| `bot/.env.example` | Documented bot env var names without real secrets |

## Tests

Bot-local tests:

- `bot/logging.test.js`
- `bot/network.test.js`
- `bot/streamers.test.js`

Frontend/root tests related to bot hardening:

- `src/test/botLogRedactionHardening.test.ts`
- `src/test/botSupabaseKeyHardening.test.ts`
- `src/test/botAdminCommandRuntimeGuard.test.ts`
- `src/test/botChannelConfigHardening.test.ts`
- `src/test/botJsonStateHardening.test.ts`
- `src/test/resultPosterDesign.test.ts`

## Environment variables

From `bot/.env.example` and `bot/index.js` usage:

Required:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CHANNEL_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `SITE_URL`

Optional channel overrides:

- `DISCORD_AANKONDIGINGEN_CHANNEL_ID`
- `DISCORD_STEWARD_DECISIONS_CHANNEL_ID`
- `DISCORD_LIVE_CHANNEL_ID`

Feature toggles:

- `DISCORD_RACE_POSTERS`
- `DISCORD_RESULT_POSTERS`

Network/third-party:

- `SUPABASE_FETCH_TIMEOUT_MS`
- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `YOUTUBE_API_KEY`

Do not commit real `.env` values.

## State files

These files are used as bot runtime state/config:

- `bot/config.json`
  - Stores guild/channel/role IDs and managed Discord artifacts.
  - Keys found in code include `guild_id`, channel IDs, role IDs, and managed team role/category IDs.
- `bot/sent_notifications.json`
  - Dedupes race reminders, result notices, protests, link notices and registration notices.
- `bot/streamers.json`
  - Streamer profiles created by `/setprofile` and used by live-stream checks.
- `bot/.cache/race-posters/`
  - Temporary/cache race poster output.
- `bot/.cache/result-posters/`
  - Temporary/cache result poster output.

Important: production `bot/streamers.json` can contain live runtime data and should not be deleted during deploy cleanup.

## Slash commands

Registered in `bot/index.js` per guild on ready:

| Command | Purpose |
|---|---|
| `/koppel` | Creates a `discord_link_tokens` row and returns `${SITE_URL}/koppel?token=...` |
| `/races` | Shows upcoming races and registration status for linked user |
| `/site` | Replies with site URL |
| `/aanmelden` | Registers for next race via RPC `discord_register_race` |
| `/afmelden` | Unregisters for next race via RPC `discord_register_race` |
| `/setup-server` | Admin-only setup of roles/channels/categories/messages/team sync |
| `/setprofile` | Admin-only create/update stream profile |
| `/deleteprofile` | Admin-only delete stream profile |
| `/invite` | Creates a Discord invite from a suitable channel |

## Button interactions

- `aanmelden_<raceId>` -> race registration.
- `afmelden_<raceId>` -> race unregistration.

## Discord client events

Registered in `bot/index.js`:

- `client.once('clientReady', ...)`
  - registers slash commands per guild;
  - calls `ensureLiveChannelPermissions`;
  - schedules recurring jobs;
  - runs initial `checkRaces`, `processDiscordSyncQueue`, `checkStreams`, `updateCalendarEmbed`, `syncTeamRoles`.
- `client.on('guildMemberAdd', ...)`
  - kicks accounts younger than 7 days;
  - adds configured `Rijder` role;
  - if Discord is already linked, sets nickname and team roles.
- `client.on('interactionCreate', ...)`
  - handles slash commands and registration buttons.
- `client.on('error', ...)`, `client.on('warn', ...)`, `client.on('shardError', ...)`, `client.on('shardDisconnect', ...)`
  - logs Discord client warnings/errors/disconnects.

## Scheduled/background jobs

The bot schedules recurring tasks in `bot/index.js`.

Every minute or staggered near every minute:

- `checkRaces`
  - race reminders (`24h`, `1h`, `15m`)
  - live race notices
  - cancelled race notices
  - completed race podium/result posts
- `checkAnnouncements`
  - sends unsent DB announcements with optional mentions
- `checkNewRegistrations`
  - logs new race registrations
- `checkNewLinks`
  - logs newly used Discord link tokens
- `discordSyncQueue`
  - processes `discord_sync_queue`
- `checkProtests`
  - notifies steward channel and posts decisions
- `checkAbandonPenalties`
- `checkAbandonCorrections`
- `checkStewardPenalties`
- `checkStewardCorrections`

Every 2 minutes:

- `checkStreams`
  - checks Twitch/Kick/YouTube live status
  - only notifies when title contains contiguous/case-insensitive `3stripe` according to existing behavior/tests

Every 5 minutes:

- `syncTeamRoles`
  - team roles/categories/channels
  - member roles/nicknames
  - admin/steward role sync

Hourly:

- Calendar embed update.
- Cleanup of used/expired `discord_link_tokens`.

Startup also registers commands and runs initial checks/syncs.

## Supabase access

- The bot uses `SUPABASE_SERVICE_KEY`, so it bypasses RLS for DB writes.
- Important tables/RPCs used include:
  - `discord_link_tokens`
  - `discord_sync_queue`
  - `races`
  - `race_registrations`
  - `race_results`
  - `profiles`
  - `teams`
  - `team_memberships`
  - `protests`
  - `penalties`
  - `announcements`
  - RPC `discord_register_race`

## Deployment

- `bot/setup.sh` assumes `/opt/3sm/bot`.
- It creates `/etc/systemd/system/3sm-bot.service` with:
  - `WorkingDirectory=/opt/3sm/bot`
  - `ExecStart=/usr/bin/node index.js`
  - `Restart=always`
  - `User=root`
- On a real server, confirm live systemd unit before changing. Repo file is the setup template/source, not absolute proof of current production unit.

## Risk notes

- `bot/index.js` is large and central; small changes can affect many jobs.
- Bot uses service key. Any logging/error handling around Supabase calls must avoid leaking credentials.
- JSON state files can be corrupted by concurrent writes if patterns change incorrectly.
- Discord channel/role IDs in `bot/config.json` are environment-specific.
- `/setup-server` has broad Discord side effects; do not run casually.

## Unzeker

- Exact live Discord channel/role IDs are environment state, not derivable safely from repo alone.
- Exact live service status/logs require production inspection; this doc maps repo behavior.
