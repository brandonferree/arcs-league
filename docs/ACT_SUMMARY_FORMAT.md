# Act summary format (v1)

The contract between the games that produce results (the owner's **meeples** site, Tabletop Simulator, screenshot reading) and this league site, which imports them. One file describes **one act** of one campaign. Copy this file into the meeples repo as the spec for its export; change it here first and bump `version` if it changes.

Status: agreed 2026-11-14, not yet built on either side. Build order in meeples: produce the JSON and the download button first, then the push. See `docs/FUTURE_BUILD.md`.

## Why JSON, one act per file

- The league logs campaigns act by act (`docs/DESIGN.md` section 4), so one act per file maps straight onto the act form.
- Every producer emits the same shape. The league has one importer and one validation path; meeples, TTS and screenshot reading (a vision model asked for this exact schema) are just different producers.
- JSON is what meeples (Scala.js in the browser, Cloudflare D1 behind it) and TTS (Lua `JSON.encode`) can both write without extra libraries, and the league parses it with a zod schema.

## Example

```json
{
  "format": "arcs-league-act-summary",
  "version": 1,
  "source": {
    "platform": "meeples",
    "gameId": "a1b2c3",
    "url": "https://meeples.example/arcs-br/game/a1b2c3",
    "exportedAt": "2026-11-14T21:03:00Z"
  },
  "leagueCampaign": "https://<league-site>/campaigns/42",
  "act": 2,
  "datePlayed": "2026-11-14",
  "players": [
    {
      "name": "brandon",
      "discordId": null,
      "color": "Red",
      "seat": 1,
      "fate": { "name": "Pirate", "cardId": "ARCS-FATE12" },
      "score": 31,
      "success": true,
      "winner": null,
      "tableau": [
        { "cardId": "ARCS-L07", "name": "Example Lore" },
        { "cardId": null, "name": "Some Guild Card" }
      ]
    }
  ],
  "notes": "optional free text"
}
```

## Fields

| Field | Required | Notes |
|---|---|---|
| `format` | yes | Always `"arcs-league-act-summary"`. Lets the importer reject other JSON. |
| `version` | yes | Integer, `1`. |
| `source.platform` | yes | `"meeples"`, `"tts"` or `"screenshot"`. Stored on the act for filtering and audit. |
| `source.gameId` | meeples, TTS | The game's id on that platform. The league stores it on the campaign so Acts II and III attach to the same campaign. |
| `source.url` | no | Link back to the game or replay. |
| `source.exportedAt` | yes | ISO 8601 UTC. |
| `leagueCampaign` | no | The league campaign's URL (or its numeric id), entered in meeples when the game is set up. If absent, the league matches Acts II and III by `source.gameId`, and an Act I with no match starts a new campaign once a player confirms it. |
| `act` | yes | 1, 2 or 3. |
| `datePlayed` | yes | `YYYY-MM-DD`, the day the act ended. |
| `players` | yes | 3 or 4 entries (league rule 8). |
| `players[].name` | yes | Name on the platform. The league matches it to a member or guest and the submitter confirms. |
| `players[].discordId` | no | Discord user id if the platform knows it; makes matching exact. |
| `players[].color` | no | Player colour (Red, Yellow, Blue, White). |
| `players[].seat` | no | 1-based seat / initiative order at the end of the act. |
| `players[].fate.name` | yes | Exact fate name as in `DESIGN.md` section 3 (e.g. `"Planet Breaker"`, `"Gate Wraith"`). |
| `players[].fate.cardId` | no | Buried Giant id `ARCS-FATE01`–`24`. Preferred when known. |
| `players[].score` | yes | Power at the end of the act, integer. |
| `players[].success` | Acts I, II | Did the player meet their fate's objective. Omit or `null` in Act III. |
| `players[].winner` | no | Act III only: `true` for the winner(s) when the game knows it (a C fate can win on its objective regardless of points). `null` lets the league default to highest score. |
| `players[].tableau` | no | Cards the player held at the end of the act (Lore, Guild, Vox, court). Each item has `cardId` (Buried Giant id, preferred) and/or `name`; the league matches by id, then by name. Fills the card-tagging data. |
| `notes` | no | Free text copied into the act's notes. |

Unknown extra fields are ignored, so producers can add data the league does not use yet.

## Delivery

Decided (owner, 2026-11-14): **meeples pushes** each act to the league when it ends, and also offers a **download** of the same JSON as a backup. Everything a person hands over (TTS files, screenshots, a downloaded meeples JSON) goes through the league's Discord bot in the campaign thread: `/campaign import` with the file attached, or the "Send to ARCS League" message command on a message that has it. See `docs/FUTURE_BUILD.md`.

### Push (meeples only)

```
POST <LEAGUE_URL>/api/import/act
Authorization: Bearer <secret>
Content-Type: application/json

<the act summary JSON, at most 64 KB>
```

- **Send it from the server, never the browser.** meeples' game logic runs in the player's browser, where any secret is readable. The browser hands the summary to a meeples Cloudflare Pages Function, which adds the `Authorization` header and forwards it. The secret lives in Cloudflare (meeples) and Vercel (league) environment variables only, never in either repo.
- **Idempotent.** The league keys an import on `source.platform` + `source.gameId` + `act`. Sending the same act again replaces a pending import; it never creates a duplicate.
- **Retry** on network errors and 5xx, with backoff (for example 1 min, 5 min, 30 min, then give up). Do not retry 4xx.

Responses (JSON body):

| Status | Body | Meaning |
|---|---|---|
| `202` | `{ "status": "pending", "confirmUrl": "…" }` | Received; a player must confirm on the site (first time a name is seen, or a rule problem). meeples can show the link. |
| `201` | `{ "status": "saved", "actUrl": "…" }` | Saved directly: every player matched a known member or remembered alias and the fate rules passed. |
| `400` | `{ "status": "invalid", "errors": [ … ] }` | Not a valid v1 summary. |
| `401` | `{ "status": "unauthorized" }` | Missing or wrong secret. |
| `409` | `{ "status": "conflict", "actUrl": "…" }` | That act is already saved with different results; a moderator must sort it out on the site. |

### Download (backup, and any producer)

An "Export for ARCS League" button that downloads `arcs-<gameId>-act<N>.json` and copies the same text to the clipboard. A player posts the file in the campaign's Discord thread and sends it to the league with the bot. Use it when a push fails, and to test the export before the push exists.

TTS cannot hold a secret either (the mod is shared with players), so TTS goes through Discord, not push.

## Rules the producer does not need to enforce

The league runs its own fate-legality validator on import and shows problems to the player before saving. Producers should export what happened, not what the league would allow.

## Card ids

meeples uses its own internal names for cards. Map them to Buried Giant ids (`ARCS-…`, as in `https://cardcdn.buriedgiant.com/cards.json`, filter `game == "arcs"`) inside meeples where practical; otherwise send the card's printed `name` and the league will match by name.
