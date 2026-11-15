# Future build: importing results from games

Owner's request (2026-11-14): fill in act results automatically instead of typing them.

- **meeples games** (the owner's HRF-based async site, private repo `brandonferree/meeples`): import a summary file produced by the game.
- **Tabletop Simulator games**: captured somehow; method not decided.
- **In-person games**: read a screenshot.

`brandonferree/ARCSdiscord` is not used for this; async games are played on meeples (owner, 2026-11-14).

Nothing here is built. The file format and push contract are in `docs/ACT_SUMMARY_FORMAT.md`; meeples builds its export first, from the prompt in `docs/handoff/MEEPLES_HANDOFF.md`.

## Findings so far

- The Discord bot (phase 3) has not been built, so the bot side of importing would be its first feature.
- meeples' Arcs code (`haunt-roll-fail/arcs/*.scala`) has no summary, download or JSON export today (searched 2026-11-14). It must be added in the meeples repo.
- `DESIGN.md` said async games never flow into this site. That was about ARCSdiscord; meeples and TTS games are now meant to be logged here.

## Recommended approach

**One JSON format for every source** (`docs/ACT_SUMMARY_FORMAT.md`). meeples writes it, a TTS mod could write it, and screenshot reading asks a vision model to return it. The league has one importer: parse with zod, match players and fates, run the fate validator, and show the result **for a player to confirm** (in Discord, or on the site's prefilled act form). Only a clean meeples push may skip confirmation (question 5).

### How the summary reaches the site

| Method | Pros | Cons |
|---|---|---|
| **A. Download a `.json` file**, upload it on the act form (or attach to a bot command) | Simplest on both sides; no network link between meeples and the league; works for any producer, including TTS | Manual step; awkward on phones; a file can be hand-edited (mitigated by the confirm step and the audit log) |
| **B. Copy to clipboard**, paste into the act form | No file handling, good on phones | Long tableau lists make big pastes; Discord messages cap at 2,000 characters, so pasting into Discord is unreliable |
| **C. Share link**: meeples serves `…/game/<id>/summary.json` publicly; a player pastes the link and the league fetches it | One paste works in the browser and in Discord; data comes straight from meeples so it cannot be edited in transit; Acts II and III re-use the same link | meeples needs a public read-only endpoint (Cloudflare Pages Function reading D1); league must fetch only from an allowlisted host; breaks if meeples is down or the game is deleted |
| **D. Push**: meeples POSTs results to a league API when an act ends | Fully automatic | Needs a write API and shared secret (the spec avoided one); couples the two sites; players must still be matched to members, so someone still confirms |

**Decided (owner, 2026-11-14): D, with A as a backup.** meeples pushes each act when it ends; an "Export for ARCS League" button downloads the same JSON (and copies it, which gives B) for when a push fails and for TTS and testing. C is not planned. The push contract (endpoint, secret, responses, retries) is in `docs/ACT_SUMMARY_FORMAT.md`.

What D costs, so it is not a surprise:

- meeples' game logic runs in the browser, so the push must go through a meeples Cloudflare Pages Function that holds the secret. That function does not exist yet.
- A shared secret in both Cloudflare and Vercel environment variables (`MEEPLES_IMPORT_SECRET` here).
- Player names still have to be matched to members, so the first import of a new name waits for a player to confirm. After that the alias is remembered and clean imports save directly.
- If the league is down, meeples retries; after that, the download is the fallback.

### Everything else comes in through Discord

Decided (2026-11-14, owner left the choice to Claude): **Discord is the front door for anything a person hands over** (in-person screenshots, TTS files or screenshots, a downloaded meeples JSON). **meeples is the one machine-to-machine path** and pushes straight to the site. Every path ends in the same importer, format, validator and audit log.

- **The bot cannot see ordinary messages.** It is an HTTP interactions endpoint with no gateway (`DESIGN.md` section 2), so Discord only calls it for commands and buttons. "Post a file and the bot notices" would need an always-on process; polling by cron is not viable (Vercel's free cron runs about daily). So a person triggers the import:
  - **`/campaign import`** with a file attached, in the campaign's thread.
  - **A message command, "Send to ARCS League"** (right-click a message → Apps): someone posts the screenshot or file normally, then anyone in the campaign sends it.
- **The thread identifies the campaign**, so Discord imports need no `leagueCampaign` link.
- **Confirm in Discord.** The bot replies privately with the parsed act (fates, scores, success, rule problems) and buttons **Confirm** and **Edit on site**. Most acts never need the website.
- **Discord's 3-second deadline:** the bot answers "Reading…" at once (deferred response) and posts the result as a follow-up; reading a screenshot happens after the reply.
- **Discord file links expire** (about a day), so the site copies each file into Blob immediately. A screenshot of the board doubles as the act's board photo.
- **meeples results still show in Discord:** after a push, the bot posts the act's result card in the campaign thread, as for any act.
- **Web upload on the act form is deferred**, added later as a fallback if needed.

## Open questions for the owner

1. ~~meeples sample file~~: done. meeples' export landed (meeples `95aa68a`); anonymised samples are in `docs/reference/meeples/`. Act scores may be negative (owner, 2026-11-14); the act form and server now accept −999 to 999.
2. **TTS.** Does the TTS mod save a file (it could write the same JSON from Lua), or are TTS games read from a screenshot like in-person ones? Send a sample.
3. **In-person screenshot.** What does it show: a score pad, a photo of the board, a companion app? Send a sample.
4. **Vision model and budget.** Reading screenshots needs a vision model, which breaks the $0 budget unless it fits in Vercel AI Gateway's monthly free credit. Accept that, or only store the screenshot with the act and keep typing numbers?
5. **Review step.** Proposed: a meeples push saves directly when every player matches a member or remembered alias and the fate rules pass; otherwise it is held for a player to confirm. Discord imports (screenshots especially, which can be misread) always ask for Confirm. Agree?
6. ~~Entry point for uploads~~: decided, Discord (see above).
7. **Leaderboard.** Do meeples and TTS games count on the same leaderboard as in-person games, or filterable / separate? Recommended: same leaderboard, with a "platform" filter alongside date, season and player count.
8. **Player matching.** Can meeples know each player's Discord id (e.g. sign-in with Discord on meeples), or does the league match by name and remember the alias?
9. **New campaigns from imports.** Proposed: an Act I push with no `leagueCampaign` creates a pending campaign that a player confirms (recording `source.gameId` so later acts attach). Or must the campaign always be created first via `/campaign start` or the web, and its link entered in meeples?

## League-side work, in build order

1. **Shared importer.** `source_platform` and `source_game_id` on campaigns/acts, a `pending_imports` table and a player-alias table (migration); `src/lib/import/act-summary.ts` with the zod schema, player/fate/card matching and unit tests against the samples; platform stats filter.
2. **meeples push** (needs no bot). `POST /api/import/act`: bearer secret check (`MEEPLES_IMPORT_SECRET`), idempotent on platform + game id + act, responses as in the format doc, audit-logged as the import. Confirm page on the site for held imports (prefilled `ActForm` with validator results).
3. **Bot (phase 3)** with the import paths: `/campaign import` with an attachment, the "Send to ARCS League" message command, the private Confirm / Edit on site reply, files copied to Blob, and result cards (including after meeples pushes).
4. **Screenshot reading**, behind the decision in question 4: a vision model returns the same act summary JSON.
5. Later, if needed: upload / paste on the web act form.
