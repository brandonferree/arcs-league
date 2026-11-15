# Phase 3 report: the Discord bot

Built 2026-11-15. The bot is an HTTP interactions endpoint inside the site (spec section 2): no gateway connection and no always-on process. It is switched off until its environment variables are set (`docs/SETUP.md` step 7).

## Built

- **Endpoint** `POST /api/discord/interactions`: checks Discord's Ed25519 signature (and rejects timestamps more than 5 minutes off), answers Discord's ping, and handles commands, buttons and autocomplete. Anything that touches the database is deferred: Discord gets an answer at once and the bot edits it when the work is done (Next.js `after`), so a cold start cannot miss Discord's 3-second deadline. Commands answer only in the league's server, in `#arcs` and its threads.
- **`/campaign start`** posts a lobby in `#arcs` with **Join**, **Leave** and **Start**. The opener is in it already. Join is disabled at 4 players, Start until 3. **Start** creates the campaign (same rules as the web form: 3–4 players, unique names, audit log, "Campaign #N" title), turns the lobby message into a thread, posts a welcome in it that mentions the players (adding them to the thread) with **Record Act I** and **Campaign page** links, and turns the lobby into a "has started" card. Lobby state is kept in `discord_lobbies` with row locks, so simultaneous presses cannot lose a join; leaving the last seat closes the lobby.
- **Members who never signed in** get a league player record the first time they use the bot (name and avatar from Discord; their name follows Discord when they press a button later).
- **Result cards**: after every act is saved (web form, a confirmed import, or a meeples push), the bot posts a card in the campaign's thread: each player's fate with tier letter, power, succeeded or failed (🏆 for winners in Act III), the date, the VOD link, and the override reason if the winner is not the top score. It has a **Campaign page** link and a **Record Act II/III** link while that act is still to do. Saving an act again (an edit within 24 hours, a moderator edit, or meeples resending it) **edits the same card** instead of posting another; if someone deleted the card in Discord, a new one is posted.
- **Closing announcement** in `#arcs` when Act III closes a campaign: the winner(s), each player's final power and three-act fate path, and a link to the thread. Edited in place if Act III is edited later.
- **Threads for every campaign**: a campaign made on the site gets its thread in `#arcs` straight away; one created by an import gets it with its first result card.
- **`/campaign status`**: campaigns in progress (stalled ones excluded), with players, acts recorded, the next act and a link to each thread.
- **`/stats player [member]`** (default: you) and **`/stats fate <name>`** (with autocomplete): short summaries from closed campaigns, linking to the player or fate page.
- **Bot setup page** for moderators (`/admin/discord`, "Bot" in the menu): which bot variables are missing (names only), the endpoint address to paste into Discord, an invite link with exactly the permissions the bot uses, and **Register slash commands**. Also `npm run discord:register` for local use.
- Migration `0008`: `discord_lobbies`, `acts.discord_message_id`, `campaigns.discord_announcement_id`.

## Decisions made (owner to confirm)

- **Who presses Start:** any player in the lobby, or a moderator. The opener does not have to.
- **A thread for every campaign**, including ones logged on the site or imported, so every result card has a home. Say if web-logged campaigns should stay out of Discord.
- **Cards are edited, not reposted**, when an act changes. No "edited" message is posted.
- **Messages are public** in the channel (lobby, status, stats); only error messages are private to the person who pressed.
- Lobbies do not expire; a stale one can simply be left or ignored.

## Not built (later)

- The import paths from `docs/FUTURE_BUILD.md`: `/campaign import` with a file and the "Send to ARCS League" message command. They need the owner's answers on screenshots (question 4 there) and TTS (question 2).
- Retrying a card that failed to post. Saving the act again posts it.
- Void, reopen and delete do not change anything in Discord.

## Verified

- 185 Vitest tests pass (18 new): signature checks (good, tampered, stale, wrong key), the permission number in the invite link, guild and channel gatekeeping, the whole lobby flow against PGlite with a fake Discord (open, join, double join, full lobby, too few to start, an outsider pressing Start, a moderator starting a lobby they are not in, leaving until closed, the campaign and its thread and welcome mentions), creating players for new members and following their name, result cards posted then edited, a deleted card replaced, the closing announcement posted then edited, a thread made for a site-created campaign, status, player and fate stats, fate autocomplete.
- Typecheck and production build pass.
- The real endpoint on a local server, with requests signed by a test key: ping answered, a bad signature refused with 401, wrong server and wrong channel refused privately, autocomplete answered. `/admin/discord` checked in the browser as a moderator, including at phone width.
- **Not verified against real Discord**: the bot's token, public key and channel are not set yet. The first live test is step 7 of `docs/SETUP.md`: Discord verifies the endpoint when the URL is saved, then `/campaign status` in `#arcs`, then a lobby with three people.
