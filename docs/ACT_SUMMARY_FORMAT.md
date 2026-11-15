# Act summary format (v1)

The contract between the games that produce results (the owner's **meeples** site, Tabletop Simulator, screenshot reading) and this league site, which imports them. One file describes **one act** of one campaign. Copy this file into the meeples repo as the spec for its export; change it here first and bump `version` if it changes.

Status: proposed 2026-11-14, not yet built on either side. See `docs/FUTURE_BUILD.md`.

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

## Rules the producer does not need to enforce

The league runs its own fate-legality validator on import and shows problems to the player before saving. Producers should export what happened, not what the league would allow.

## Card ids

meeples uses its own internal names for cards. Map them to Buried Giant ids (`ARCS-…`, as in `https://cardcdn.buriedgiant.com/cards.json`, filter `game == "arcs"`) inside meeples where practical; otherwise send the card's printed `name` and the league will match by name.
