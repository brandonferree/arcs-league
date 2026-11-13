# Phase 1 report

Phase 1 of `docs/DESIGN.md` section 10, built per `docs/HANDOFF.md`, on 2026-11-13. Everything is on `main`. Account setup is in [`SETUP.md`](SETUP.md).

## What was built

| Handoff step | Where |
| --- | --- |
| 1. Next.js scaffold, test runner, `.env.example` | `package.json`, `next.config.ts`, `vitest.config.ts`, `.env.example` |
| 2. Validator and winner logic ported, all legacy tests ported, new rules tested | `src/lib/rules/` (`legacy.test.ts` is the port of `test_domain.py`; `rules.test.ts` covers 3–4 players, winner override, partial campaigns, progression key) |
| 3. Postgres schema with migrations, 24 fates seeded | `src/db/schema.ts`, `drizzle/0000_init.sql`, `drizzle/0001_seed_fates.sql` |
| 4. Neon Reach theme | `src/app/globals.css` (tokens on `:root`), `src/components/` |
| 5. Home, Campaigns list, Campaign detail, act form, 24-hour window, moderator edit, audit log | `src/app/`, `src/server/campaigns.ts`, `src/lib/permissions.ts` |
| 6. Discord OAuth with membership and moderator-role checks | `src/server/discord.ts`, `src/app/api/auth/` |

Design decisions worth knowing:

- **Database driver.** Drizzle ORM. Production uses `DATABASE_URL` (Neon, via node-postgres). With no `DATABASE_URL`, the app runs an embedded Postgres (PGlite) in `.pglite/` and migrates it on start, so local development needs no install. Migrations run on Neon as part of `npm run build`.
- **Fates are data.** The validator takes the tier of each fate from the database, so moderator edits to fates (a later admin page) flow through to validation. The seed's card ids (`ARCS-FATE01`–`24`) were checked against Buried Giant's `cards.json`; complexity is left empty until the phase 5 card import.
- **Winners are explicit.** `campaign_players.is_winner`, plus `winner_overridden` and a required reason on the campaign. Ties share the win by default.
- **Stalled is computed**, not stored: in progress with no activity for 60 days. A moderator "reopens" by resetting the clock. Void and stalled campaigns are excluded from home stats and open-campaign lists.
- **Who may record and edit.** Players at the table and whoever created the campaign may record the next act, and may edit an act for 24 hours after it was first saved. Moderators can always edit, and can void, reopen and delete. Every write is audit-logged with before and after snapshots; moderators see a campaign's history on its page.
- **Guests** are player rows with `is_guest`. A guest with the same name is reused across campaigns. The schema has `linked_player_id` for linking a guest to a real account later.
- **Progression key** uses a glyph plus a colour for each step (▸ started, = kept, ✓ changed after success, ✗ changed after failure), so it never relies on colour alone, and the fate chips stay solid tier colours as agreed.
- **Sessions** are signed JWT cookies (`SESSION_SECRET`), 30 days. Membership and moderator role are checked at sign-in, as the spec says.

## Verified

- **Tests: 66 pass** (`npm test`), including every legacy test, plus integration tests against a real in-memory Postgres with the real migrations: create a campaign, log three acts, close on Act III, winner override with reason, every rule violation refused on save, acts in order, success flags, seats, the 24-hour window (23h allowed, 25h refused, moderator allowed), outsiders refused, void/reopen/delete, stalled after 60 days, audit entries with before/after, seed of 24 fates.
- **Typecheck** (`npm run typecheck`) and **production build** (`npm run build`) pass.
- **In the browser** (local dev server, development sign-in):
  - Signed in as test users; header shows name and Mod/Dev badges.
  - New campaign: duplicate player shown live as an error; a guest added by name; campaign created and redirected to Act I.
  - Act I: a fate taken by another player is disabled in the dropdown with "taken by Emma".
  - Act II: options annotated live (`Founder (keep) (failed last act)`, `Magnate (taken by Gail)`, other A fates `(only as a continuation)`); forcing an illegal choice shows the rule message and Save is refused; a legal Act II saved with a VOD link.
  - Act III: winner override requires a reason (shown live); saved with a reason; campaign closed; detail shows the winner in gold, the reason, and the full progression grid with the colour key.
  - Edit within 24 hours by a participant: saved, shows "edited … by Emma", window still measured from the first save.
  - Outsider: no edit links, act page refuses. Moderator: moderator panel and change history with before/after.
  - Campaigns list and Home show the result, top Act III and champion.
  - Phone width (375px): no page-level horizontal scroll on Home, Campaigns, Campaign detail, new campaign and act form; the progression table scrolls inside its own box; the act form stacks.
  - The `prefers-reduced-motion` rule is in the served CSS and the background drift runs otherwise.
  - Discord sign-in with no credentials configured redirects to the sign-in page with a clear message.
  - The development sign-in refuses a non-localhost `Host` (404) and works on localhost.
- Bugs found and fixed during this check: the act "saved by" name was always blank (an unqualified column in a subquery); editing Act I did not block fates that would break a fate kept into Act II; the dev sign-in host check trusted the URL rather than the Host header.

## Not verified

- **Real Discord sign-in**, the membership check and the moderator-role check against Discord's API. The code follows Discord's documented OAuth2 flow and endpoints, but it cannot run until the application exists (see `SETUP.md`).
- **Neon and Vercel.** Never deployed; migrations have only run on PGlite. The same SQL runs on Neon's Postgres, but the first real deploy is the test.
- **Reduced motion with the OS setting actually on** (only the CSS rule was checked), and real phones (only an emulated 375px viewport).
- Screen readers and keyboard-only use were not tested beyond using labelled native controls.

## Not built (by design or later phases)

- Phases 2–6: leaderboard, player and fate pages, records, the bot, photos (and the "no photos" badge), card import and tagging, public API and CSV.
- Admin pages (fates, seasons, guests, audit log). Seasons can be stored and filtered on, but there is no page to create one yet; the season picker appears once a season exists. Linking a guest to an account has a schema column but no screen.
- Editing a campaign's title, season or player list after creation.

## Questions for the owner

1. **`ARCSdiscord`** (spec section 11): should games played on your async-play bot flow into this site automatically? If yes, the site needs a token-authenticated write API, and I would design it before phase 3. Nothing has been built for it.
2. Is "Campaign #N" a good automatic title, or would you like something else (for example the players' names and date)?
3. The reigning champion on Home is currently the member with the most wins (ties broken by win rate). Is that what you mean by champion, or should it be the winner of the latest campaign, or a season winner?

## Small notes

- `npm audit` reports a moderate advisory in an old esbuild bundled inside `drizzle-kit`. It affects the development tool only, not the deployed site.
- The repository lives in OneDrive, which makes the dev server slow to start while OneDrive syncs `node_modules`. Excluding the folder from sync, or moving the repo out of OneDrive, would help.
