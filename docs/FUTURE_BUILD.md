# Future build: importing results from games

Owner's request (2026-11-14): fill in act results automatically instead of typing them.

- **meeples games** (the owner's HRF-based async site, private repo `brandonferree/meeples`): import a summary file produced by the game.
- **Tabletop Simulator games**: captured somehow; method not decided.
- **In-person games**: read a screenshot.

`brandonferree/ARCSdiscord` is not used for this; async games are played on meeples (owner, 2026-11-14).

Nothing here is built. The file format is proposed in `docs/ACT_SUMMARY_FORMAT.md`; meeples builds its export first.

## Findings so far

- The Discord bot (phase 3) has not been built, so the bot side of importing would be its first feature.
- meeples' Arcs code (`haunt-roll-fail/arcs/*.scala`) has no summary, download or JSON export today (searched 2026-11-14). It must be added in the meeples repo.
- `DESIGN.md` said async games never flow into this site. That was about ARCSdiscord; meeples and TTS games are now meant to be logged here.

## Recommended approach

**One JSON format for every source** (`docs/ACT_SUMMARY_FORMAT.md`). meeples writes it, a TTS mod could write it, and screenshot reading asks a vision model to return it. The league has one importer: parse with zod, match players and fates, run the fate validator, and open the act form **prefilled for a player to confirm**. Nothing is saved unseen.

### How the summary reaches the site

| Method | Pros | Cons |
|---|---|---|
| **A. Download a `.json` file**, upload it on the act form (or attach to a bot command) | Simplest on both sides; no network link between meeples and the league; works for any producer, including TTS | Manual step; awkward on phones; a file can be hand-edited (mitigated by the confirm step and the audit log) |
| **B. Copy to clipboard**, paste into the act form | No file handling, good on phones | Long tableau lists make big pastes; Discord messages cap at 2,000 characters, so pasting into Discord is unreliable |
| **C. Share link**: meeples serves `…/game/<id>/summary.json` publicly; a player pastes the link and the league fetches it | One paste works in the browser and in Discord; data comes straight from meeples so it cannot be edited in transit; Acts II and III re-use the same link | meeples needs a public read-only endpoint (Cloudflare Pages Function reading D1); league must fetch only from an allowlisted host; breaks if meeples is down or the game is deleted |
| **D. Push**: meeples POSTs results to a league API when an act ends | Fully automatic | Needs a write API and shared secret (the spec avoided one); couples the two sites; players must still be matched to members, so someone still confirms |

**Recommendation:** build **A first** (meeples adds an "Export for ARCS League" button that downloads the JSON and also copies it, which gives B for free), then **C** once meeples hosts games publicly. Skip D.

## Open questions for the owner

1. **meeples sample file.** Once meeples has its export, commit a real sample to `docs/reference/` here for the importer tests.
2. **TTS.** Does the TTS mod save a file (it could write the same JSON from Lua), or are TTS games read from a screenshot like in-person ones? Send a sample.
3. **In-person screenshot.** What does it show: a score pad, a photo of the board, a companion app? Send a sample.
4. **Vision model and budget.** Reading screenshots needs a vision model, which breaks the $0 budget unless it fits in Vercel AI Gateway's monthly free credit. Accept that, or only store the screenshot with the act and keep typing numbers?
5. **Review step.** Recommended: the import prefills the act form and a player confirms. Or save directly when it parses and passes the fate rules?
6. **Entry point.** Recommended: both a `/campaign import` bot command with an attachment in the campaign thread and an upload on the act form. Or only one?
7. **Leaderboard.** Do meeples and TTS games count on the same leaderboard as in-person games, or filterable / separate? Recommended: same leaderboard, with a "platform" filter alongside date, season and player count.
8. **Player matching.** Can meeples know each player's Discord id (e.g. sign-in with Discord on meeples), or does the league match by name and remember the alias?
9. **New campaigns from imports.** May an Act I import create the campaign on the site (recording `source.gameId` so later acts attach), or must the campaign be created first via `/campaign start` or the web?

## League-side work once answered

- `source_platform` and `source_game_id` on campaigns/acts (migration), platform stats filter.
- `src/lib/import/act-summary.ts`: zod schema, player/fate/card matching, unit tests against the samples.
- Import entry on the act form (file, paste, and later link), prefilling `ActForm`.
- Bot `/campaign import` once phase 3 exists.
- Screenshot reading behind the decision in question 4.
