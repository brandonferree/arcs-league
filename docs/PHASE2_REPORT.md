# Phase 2 report: leaderboard, players, fates, records

## Built

- `/leaderboard`: members only, ranked by win rate then wins; minimum games (default 5) adjustable with `?min=`. The champion is badged.
- `/players` and `/players/[id]`: summary numbers, win rate over time, progression across acts, Act III class share, success by act, fates played, campaign history. Guests get pages but never rank. A linked guest redirects to the real account.
- `/fates` (tier tables) and `/fates/[slug]`: plays, success and average score by act, Keep %, win %, switched from/to, progression and win-rate charts. The card panel is a placeholder until the phase 5 card import; complexity shows "–" until then.
- `/records`: champion, top Act III, most improved, most played fate, best A and B fates, deadliest fate, top win rate by class, seat order.
- Filters on every stats page: date range (Act III date), season (shown once seasons exist), player count. Links between stats pages keep the filters.

- `/admin/seasons` (moderators; added at the owner's request): create, rename and re-date seasons, delete them (their campaigns keep their results and lose the tag), and "Tag campaigns", which tags every untagged campaign whose Act I falls within the season's dates. All changes are audit-logged. A link to a season that no longer exists shows "Unknown season" in the filter.

## Definitions (also documented in `src/lib/stats.ts`)

- Only closed campaigns count. Plays are act appearances. Keep % = successful Act I/II plays kept into the next act. Fate win % = wins / Act III finishes on that fate.
- Champion: most wins, then win rate (shared with the home page via `pickChampion`).
- Most improved: later-half minus earlier-half win rate (middle game dropped when odd).
- Deadliest: highest failure rate over Act I and II plays.
- Player awards are members only; single-game records and fate stats include guests.
- Thresholds are named constants at the top of `src/lib/stats.ts`.

## Verified

- 96 Vitest tests pass (30 new, including seasons: pure stats on fixtures, loader against PGlite with filters and exclusion of in-progress and void).
- Typecheck and production build pass.
- All pages checked in the browser against demo data, including filters and phone width.

## Not done / open

- A single campaign's season can only be set when it is logged or by "Tag campaigns"; there is no per-campaign season editor yet.
- Card content on fate pages and card win rates wait for phase 5.

## Demo data

`npm run db:seed-demo` writes 24 made-up closed campaigns (plus one in progress and one void) to `./.pglite-demo`. The `dev-demo` launch config runs a second dev server on port 3005 against it, with its own build folder (`.next-demo`) so it can run beside the normal dev server.
