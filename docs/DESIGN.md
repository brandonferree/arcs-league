# ARCS League: design spec

This is the agreed design for the site, settled in a 44-question interview with the owner on 2026-11-13. Nothing is built yet. Decisions here are final unless the owner changes them; items under "Open" are not decided.

## 1. What it is

A league site for **ARCS: The Blighted Reach** campaign games, for one Discord community (a general games server with an `#arcs` channel, about 40 members). Players log each campaign act by act; the site turns that into leaderboards, fate and card analytics, and records.

- The model for *how logging and stats are organised* is the Root Digital League site (`rootleague.pliskin.dev`): a bot opens the game in Discord, results are finished on the web, stats are filterable tables, light moderation.
- The *look* is ARCS's own (section 8). Do not copy Root League's parchment and gold.
- It replaces an older Streamlit tracker (`brandonferree/ARCS-Campaign`), which stays frozen. **Nothing is imported**: that site held only generated test data.
- Site title: "ARCS League: Blighted Reach Chronicle". Public repo. Free `vercel.app` address to start.

## 2. Stack

All on free tiers; the budget is $0 and there must be no always-on process.

- **Next.js** (App Router, TypeScript) on **Vercel**
- **Postgres on Neon**
- **Vercel Blob** for photos and, later, our copies of card images (text first; see Open)
- **Discord OAuth** for sign-in
- **Discord bot as an HTTP interactions endpoint** inside the same app (slash commands and buttons arrive as signed HTTP requests; results are posted with the bot token over REST). No gateway connection.

## 3. Game rules the site enforces

24 fates in three tiers of 8. Tier equals the act the fate card belongs to.

- **A (act 1):** Steward, Founder, Magnate, Advocate, Caretaker, Partisan, Admiral, Believer
- **B (act 2):** Pathfinder, Hegemon, Planet Breaker, Pirate, Blight Speaker, Pacifist, Peacekeeper, Warden
- **C (act 3):** Overlord, Survivalist, Redeemer, Guardian, Naturalist, Gate Wraith, Conspirator, Judge

Validation, checked live in the form as each act is entered:

1. Player names are unique within a campaign.
2. Act I fate must be tier A.
3. Act II fate cannot be tier C.
4. After Act I, an A fate is legal only as a continuation of that player's previous act.
5. A fate may be continued only if the player succeeded with it in the previous act; otherwise they must change.
6. A fate a player dropped cannot be picked up again.
7. A fate belongs to at most one player per campaign.
8. Tables are **3 or 4 players** only.

Winner: defaults to the highest Act III score (ties share), but is stored as an **explicit field** the submitter can override with a reason, because C fates can win on objectives regardless of points. Act III has no separate success flag; succeeding in Act III means winning.

The working Python implementation and its tests are in `docs/reference/legacy-rules/` (`domain.py`, `config.py`, `test_domain.py`). **Port the validator and all its tests to TypeScript**; the tests are the acceptance criteria for rules 1–7.

Fates are seed data in the database, editable by a moderator, not hard-coded.

## 4. Logging a campaign

1. A player runs `/campaign start` in `#arcs`. The bot posts a lobby with Join, Leave and Start buttons. Start (3–4 joined) creates a thread under `#arcs` and creates the campaign on the site, linked to that thread.
2. After each act is played, any player in the campaign opens the web form (link is in the thread) and records that act. The campaign stays "in progress" between acts.
3. Saving Act III with a winner closes the campaign.
4. The bot posts a result card in the thread after each act, and a final announcement in `#arcs` on close.

A campaign can also be created directly on the web without the lobby.

Per act, per player:

- **Required:** fate, score, success (Acts I and II only)
- **Optional:** seat/initiative order

Per act:

- **Required:** date played
- **Optional:** VOD link, free-text notes
- **Requested, not blocking:** one photo of the board and one photo of each player's tableau. A campaign with missing photos shows a "no photos" badge. Photos are downscaled in the browser before upload.

Per campaign: title (auto-generated if blank), season tag (optional), explicit winner plus override reason.

**Card tagging.** Cards are not typed in at submission. Later, any signed-in member can open a tableau photo and tag the cards visible in it. Taggable cards: court cards (base and Blighted Reach), Lore, and the cards of the fate that player was on in that act. The picker should offer that fate's own cards first.

**Stalled.** A campaign with no new act for 60 days is flagged stalled and excluded from stats. A moderator can void or reopen it. In-progress and stalled campaigns never count in stats or the API.

## 5. People and trust

- Sign-in with Discord. Any member of the server can log games. Membership is checked at sign-in.
- **Guests:** the submitter can add a non-member by name. Guests appear in campaign records but not on the leaderboard. A moderator can later link a guest's history to a real account.
- Results are live immediately; there is no approval queue.
- A player in the campaign can edit an act for **24 hours** after it is saved. After that, only moderators.
- **Moderators** are whoever holds a named Discord role (default name `ARCS Mod`), checked at sign-in. They can edit, void and delete campaigns, manage fates, cards and seasons, and link guests.
- **Every change is audit-logged** (who, when, before and after).
- **Visibility:** stats, results and player pages are public. Photos are visible only to signed-in members, with a per-campaign switch to make them public.

## 6. Pages

- **Home:** latest results, open campaigns, reigning champion, headline numbers
- **Campaigns:** filterable list; detail page with the three-act fate progression per player, scores, photos, tagged cards, link to the Discord thread
- **Leaderboard:** win rate, games, wins, average and best Act III score. Minimum 5 games by default, adjustable. No rating system (the schema should keep enough to compute one retroactively).
- **Players:** one page each
- **Fates:** tier tables, plus one page per fate
- **Cards:** browsable reference, with stats where cards have been tagged
- **Records:** awards (below)
- **About / Rules / API**
- **Admin:** campaigns, fates, cards and card updates, seasons, guests, audit log

Filters that apply across stats pages: date range, season, player count (3 or 4).

### Statistics

Everything the old tracker computed, plus new dimensions.

- **Players:** games, wins, win %, average and best Act III, average Act III excluding C-fate finishes, share of Act III finishes by tier (A/B/C %)
- **Fates:** plays and success % per act, **Keep %** (how often a successful fate was continued), win %, average Act III, average Act I and Act II points, what players switched to and from, complexity (1–3, from the card data) as a dimension
- **Progression colour key** on campaign detail: started, kept, changed after success, changed after failure
- **Records:** champion, top Act III score and who set it, most improved (first half vs second half win rate, minimum 4 games), top win rate by class A/B/C (minimum 4 games), most played fate, best A and best B fate by Act III average (minimum 2 plays), deadliest fate (minimum 4 plays)
- **New:** seat order vs win rate, card win rates from tagging

Charts are wanted on player and fate pages (progression across acts, win rate over time). Tables everywhere else.

### Public API

Read-only JSON for campaigns, players and fates, closed campaigns only, plus CSV export buttons. This replaces the old site's SQL console; do not expose SQL.

## 7. Cards

Source: Buried Giant Studios' card database, used with their permission (the owner holds this; see Open).

- Built JSON: `https://cardcdn.buriedgiant.com/cards.json` (all games; filter `game == "arcs"`). Change detection: `https://cardcdn.buriedgiant.com/version.json`.
- Source repo: `github.com/buriedgiantstudios/cards` (`content/card-data/arcs/en-US/*.yml`)
- 529 ARCS cards: 65 base game, 22 Leaders & Lore, 442 Blighted Reach
- Record fields: `id`, `name`, `text` (Markdown-ish), `image` (full URL, WebP about 830×1420, about 190 KB), `tags[]`, `product`, optional `meta{act, keys, complexity}`, `flipSide`
- Every fate card is tagged `["Blighted Reach", <type>, <Fate name>]` with `meta.act`. The 24 fate cards are `ARCS-FATE01`–`24` and carry `meta.complexity` and the three-act objective text.

Rules for using it:

- **Copy, do not hotlink.** Import the data into Postgres and store resized copies of the images (thumbnail and full) in Blob.
- **Updates are manual.** A moderator presses "check for updates", sees a diff, and approves it. Never sync automatically; joke text was briefly committed upstream in October 2026.
- **Import everything except** cards tagged Setup and the player aids (`AID…`).
- **Credit** Buried Giant in the footer and link each card back to their database. State that this is an unofficial fan site.
- There is no cropped fate art or fate icon upstream, only full card scans.

Fate pages show the fate card, objective text per act, complexity, and the fate's card set grouped by act.

## 8. Theme: "Neon Reach"

Chosen from three mockups. The mockup is at `docs/reference/neon-reach-mockup.dc.html` (a design-tool file; read it for layout and exact values, do not ship it).

- Background `#05060f` with a star field, soft violet and cyan nebula glows, and a few outlined asteroids
- Panels: translucent navy `rgba(18,16,46,0.78)`, 1px border, 10px radius
- Violet `#a855f7` primary; cyan `#22d3ee` / `#67e8f9` for links and interactive elements; gold `#f5c451` reserved for winners, champions and records
- Text `#e7e9ff`, muted `#b3b8e6`
- Tier colours: A teal `#5eead4`, B amber `#fbbf24`, C pink `#f472b6`. Always pair the colour with the letter.
- Headings and nav: **Orbitron**, uppercase, letter-spaced. Body: **Inter**.

Two changes from the mockup, agreed with the owner:

1. **Numbers in stats tables are monospaced** (tabular), and **glow is limited to panel borders and headings**, never table rows.
2. **Fate progression chips are solid filled** in the tier colour with dark text, not outlined.

Motion: slow parallax drift on the background only, nothing pulsing, all of it disabled under `prefers-reduced-motion`. Dark theme only. Must work at phone width; wide tables scroll inside their own box.

## 9. Bot commands

- `/campaign start`: lobby with Join / Leave / Start
- `/campaign status`: open campaigns
- `/stats player`, `/stats fate`: short summary with a link to the site
- Result card in the thread after each act; final announcement in `#arcs` on close

Commands and threads are confined to `#arcs`. No scheduling features.

## 10. Build order

Each phase should be usable on its own.

1. Site skeleton with the theme, Discord sign-in, fates seeded, act-by-act campaign form with the ported validator, campaign list and detail
2. Leaderboard, player pages, fate pages, records
3. Bot: lobby, thread creation, result cards, stats commands
4. Photos
5. Card import, card reference, tagging from photos
6. Public API and CSV export

Phase 1 matters most: the league has no real games yet, and every later phase is better tested with real data.

### Decided after the interview

- **The owner's async-play bot (`brandonferree/ARCSdiscord`) stays separate** (owner, 2026-11-13). Games played there do not flow into this site, so there is no write API; campaigns are logged only through the web form and, from phase 3, this site's own bot.
- **Automatic campaign titles** are "Campaign #N" (owner, 2026-11-13).
- **Reigning champion** is the member with the most wins in closed campaigns, ties broken by win rate (owner, 2026-11-13).
- **Photos were built before the bot** (owner, 2026-11-14). Players in a campaign (and moderators) add, replace and remove its photos and switch them public, at any time except on a void campaign; to confirm with the owner. See `docs/PHASE4_REPORT.md`.

## 11. Open

- **Accounts the owner must set up or authorise:** a Discord application (client ID and secret, bot token, public key), a Neon database, and a Vercel project. None exist yet. Guild, channel and moderator-role IDs are configuration, supplied as environment variables; do not commit them.
- **Card permission:** the owner reports a yes from Buried Giant. Its exact scope (public display of card images) has not been seen in writing. Decided (owner, 2026-11-14): phase 5 launches with card names, text and links back to Buried Giant only; card images are added later, once the scope is confirmed.
- Free tiers are ample for 40 members; photo storage is the first limit that would ever be reached.
- Thresholds (5-game leaderboard minimum, award minimums) are guesses to revisit once real games exist.
