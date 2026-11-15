# Handoff: ARCS League export for meeples

Put this file in the root of the meeples repo and tell Claude Code: "Read MEEPLES_HANDOFF.md and do it."

---

You are working in **meeples**, the owner's self-hosted fork of haunt-roll-fail (Scala.js game clients in `haunt-roll-fail/`, served from `cf-pages/` on Cloudflare Pages, with the online-play backend in `cf-pages/_worker.js` on D1, schema in `d1-sql/schema.sql`). Async games of **Arcs: The Blighted Reach** campaign are played here (`haunt-roll-fail/arcs/`, built to `cf-pages/arcs-br/hrf-arcs-fastopt.js`).

The owner also runs **ARCS League** (`github.com/brandonferree/arcs-league`), a public Next.js site that records campaigns act by act and turns them into leaderboards and fate and card stats. Your job is to make meeples hand each finished act to that site.

## The contract

Download the agreed format and save it in this repo as `docs/ACT_SUMMARY_FORMAT.md`:

```
https://raw.githubusercontent.com/brandonferree/arcs-league/main/docs/ACT_SUMMARY_FORMAT.md
```

Read it in full. It defines the JSON (one file per act), the push endpoint, the secret, the responses and the retry rules. Follow it exactly. If something in it cannot be done in meeples, stop and tell the owner rather than inventing a different shape; the format is changed in arcs-league first.

## What to build, in this order

Commit and push after each step works.

### 1. Find the data

In `haunt-roll-fail/arcs/` (start with `game.scala`, `game-fates-common.scala`, `game-lore.scala`, `game-guilds.scala`, `meta.scala` and the `fate-*.scala` files), find where an act ends and where the game holds, for each player at that moment:

- name (from the lobby `name` lines) and colour
- seat / initiative order
- fate (must map to one of the 24 names in the format doc, e.g. `"Planet Breaker"`, `"Gate Wraith"`)
- power (the act's score)
- whether the fate objective was met (Acts I and II)
- the winner(s) at the end of Act III, if the game decides it
- the cards in their tableau (Lore, Guild, Vox, court cards)

Also find out **whether a campaign is one game across all three acts, or whether Acts II and III start as new games** (the `SetupActTwo` "Continue from Act II" option suggests acts can be separate). If they can be separate, work out how to fill `source.campaignGameId` (the Act I game's id) so the league can join the acts; if that is impossible, tell the owner.

Report what you found before writing code if anything in the format cannot be filled.

### 2. Build the summary and a download button

- A pure function that turns the game state at the end of an act into the act summary JSON (`format: "arcs-league-act-summary"`, `version: 1`, `source.platform: "meeples"`, `source.gameId` = the game journal's id).
- Card ids: send the card's printed `name` always, and the Buried Giant id (`ARCS-…`, from `https://cardcdn.buriedgiant.com/cards.json`, filter `game == "arcs"`) where you can map it reliably. A hand-made mapping table is fine; do not fetch that URL at runtime.
- An **"Export for ARCS League"** button, shown when an act has ended, that downloads `arcs-<gameId>-act<N>.json` and copies the same text to the clipboard.
- Tests for the summary function if the project has a test setup; otherwise a sample produced from a real or replayed game.

**Done when** a player can finish an act and download a summary that matches the format doc. Save one real sample per act (I, II, III) as `docs/samples/arcs-act1.json` etc. and tell the owner where they are: they go into arcs-league's `docs/reference/` for its importer tests.

### 3. Push to the league

- **Relay through the worker, never from the browser.** The game runs in the player's browser, where a secret would be readable. When an act ends, the client posts the summary to a new route in `cf-pages/_worker.js` (for example `POST /arcs-league/push`), and the worker forwards it to `<ARCS_LEAGUE_URL>/api/import/act` with `Authorization: Bearer <ARCS_LEAGUE_SECRET>`.
- The worker must only relay for a caller who is a player in that game: check their (user, secret) pair against the game's `permissions` rows, the same way the existing journal routes authenticate.
- Configuration as Cloudflare environment variables / secrets: `ARCS_LEAGUE_URL` and `ARCS_LEAGUE_SECRET`. **Never commit their values.** If either is unset, skip the push silently (the download still works). Document both in this repo's README or setup notes.
- Send each act once, automatically, when it ends. Pushing the same act again is safe (the league replaces it), so a manual "Send again" is fine too.
- Retry on network errors and 5xx after about 1, 5 and 30 minutes, then give up; never retry 4xx. If Workers cannot hold a retry that long, retry what you can and leave the download as the fallback.
- Show the player the outcome from the league's response: saved (link to `actUrl`), waiting for confirmation (link to `confirmUrl`), or failed (point them to the download button).

The league's `/api/import/act` endpoint **does not exist yet**; it is being built in arcs-league to the same contract. Until it is live, test the worker route against a local stub that returns the documented responses, and say in your report that the end-to-end push has not been tested.

## Report back

When done, give the owner: what was built and pushed, the sample file paths, the answer on one game vs separate games per act, which fields could not be filled, which card names have no Buried Giant id mapping, and what was not tested.
