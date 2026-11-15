# Phase 5 report: cards

Built 2026-11-14 at the owner's request. It first shipped text-only (8dd491a); the same day the owner found the text clunky and asked for just the card images, so cards are now shown as images and the text is kept only for search.

## Built

- **Import** (`/admin/cards`, moderators): "Check Buried Giant for changes" fetches `cards.json` and shows what an import would add, change, remove or bring back; "Import these changes" applies it. The site never fetches on its own. 459 cards: every ARCS card except setup cards (tag `Setup`) and player aids (`ARCS-AID…`). Each card keeps its upstream record (`cards.source`) to detect changes. A card that disappears upstream is marked removed, not deleted, so tags on it survive. Fate complexity is filled from the fate cards. Every import is audit-logged with the Buried Giant data version.
- **Card images**: after an import, a moderator clicks **Copy card images** on the import page. It copies each image from Buried Giant's CDN once (only that host is accepted), keeps it as published (about 200 KB) plus a 240 px WebP thumbnail (about 16 KB), and runs in batches of 25 with a progress count so no request runs long. Failures stay waiting for the next run. Images are served from `/api/cards/<id>/full|thumb?v=<copy time>` with year-long public caching; a re-copied image gets a new URL. Only new, changed or returning cards are copied again.
- **Card reference** (`/cards`, `/cards/<id>`): a grid of card images; search by name, text or id; filter by type and fate. Each card page shows the card image, fate, act, keys, other side, a "View on Buried Giant" link, how often it was seen on tagged tableau photos and how many of those holders went on to win a closed campaign. If an image has not been copied yet, the text shows instead.
- **Fate pages**: the fate card image, complexity, and the fate's card set as images grouped by act.
- **Tagging** (`/campaigns/<id>/photos/<photoId>`): any signed-in member opens a tableau photo and adds the cards they can see. The picker shows card thumbnails and offers the player's fate cards for that act first (this act's first), then court cards (base and Blighted Reach), Lore, and other fates' Guild and Vox cards. Each card appears in one group; other fates' cards show the fate name, since several court cards exist in more than one version. Tags show under each tableau photo on the campaign page. Thumbnails now open this photo page.
- Replacing a tableau photo keeps its tags. All tag changes are audit-logged.
- **Cards** in the main navigation; the footer credit now links to Buried Giant's card site.

## Changed after launch (owner, 2026-11-14)

- **A photo is no longer needed to record cards.** Cards belong to a player's tableau for an act (`card_tags.act_id` + `campaign_player_id`), not to a photo. Each player's slot on the campaign page has **Add cards**, which opens `/campaigns/<id>/tableau/<act>/<player>`: the cards held, the picker and the photo if there is one. Old tableau photo links redirect there; replacing or removing a photo keeps the cards. Migration `0005` moved existing tags from their photos.
- **Base game court cards (`ARCS-BC01`–`31`) dropped.** The import skips them, and migration `0005` hides the ones already imported (kept, not deleted, so any tags on them survive). The picker's court group is Blighted Reach court cards only.

## Decisions made (owner to confirm)

- **Other fates' Guild and Vox cards are taggable** as well as the spec's list (court, Lore, the player's own fate cards): those cards enter the shared court, so any player can end up holding one.
- **Removing a tag:** whoever added it, the campaign's players, or a moderator.
- **"Holders won":** players in closed campaigns with the card tagged in any act, and how many of them won. Void campaigns never count; in-progress ones count toward "Seen" only.
- **The fate card and resolution cards are not offered for tagging** (the fate card sits beside the board, resolutions are read at the end of an act).

## Verified

- 132 Vitest tests pass (22 new, including image copying with thumbnails, the host check, batching and re-copying changed cards; upstream parsing and exclusions, import planning with changes, removals and restorations, card text markup, picker grouping, import against PGlite including fate complexity and audit, search and filters, the fetch with a fake server, tagging and removal permissions, sighting stats, tags surviving a photo replacement).
- Typecheck and production build pass.
- In the browser against demo data: a real import of 459 cards from Buried Giant, copying all 459 images (about 30 seconds locally), a second check reporting "up to date", card and fate pages, tagging, searching, removing a tag, the card's sighting count, the campaign page's tag list, signed-out views, and a 375 px phone layout.

## Production

- Import and image copy done by the owner on the live site (2026-11-14); images are served from the Blob store.

## How it was set up

- A moderator opens **Cards → Card import**, clicks **Check Buried Giant for changes**, **Import these changes**, then **Copy card images**.

## Lore and Guild card stats (owner, 2026-11-14)

The owner asked to "track stats on lore and guild cards at the end of each act for the players". Built on the cards recorded per tableau; calculations in `src/lib/card-stats.ts` (unit-tested), loader in `src/server/card-stats.ts` (PGlite-tested).

- **`/cards/stats`** (linked from `/cards`, `/records` and each player page): per act (I, II, III), the average Lore and Guild cards per player, then for the chosen act the most-held Lore cards and most-held Guild cards with thumbnails and how their holders did. Uses the stats filters (date range, season, player count).
- **Player pages**: a "Cards held" panel with the player's average Lore and Guild per act, the cards they held at the end of each act (with how many games), and one row per campaign linking to each tableau.

Definitions (confirmed by the owner, 2026-11-14):

- **Tableau**: one player at the end of one act. It counts as **recorded** once any card is added to it; an empty tableau cannot be told apart from one nobody filled in, so it is left out (including from the averages).
- **Lore card**: `type` is `Lore` (base Lore and the fates' own Lore cards).
- **Guild card**: `type` is `Guild` (a fate's own Guild cards) or `tags` include `Guild` (the Blighted Reach court Guild cards, whose type is `Blighted Reach Court`). Vox cards are neither.
- **Held**: recorded tableaux holding the card in that act, in campaigns that are not void. In-progress and stalled campaigns count, as for "Seen" on the card pages.
- **Won**: of the holders in closed campaigns, how many were the campaign's winner, shown as a % and "w of n". Under `CARD_WIN_RATE_MIN_HOLDERS` (3, a guess like the other minimums) the rate is greyed.
- **Averages**: Lore (Guild) cards per recorded tableau in that act.
- **Date filter**: compares the campaign's latest act date, which is the Act III date once closed, as on the other stats pages.
- Guests count, as for fate and card stats.

Also fixed: on phones, player pages could be panned sideways because screen-reader labels inside the Campaigns table escaped its scroll box; `.table-wrap` now contains them.

Verified: typecheck, 144 tests (12 new) and the production build pass; in the browser on demo data after adding cards through the tableau pages: per-act averages, Lore and Guild tables, act switching, filters carried through links, player page panel and tableau links, no sideways scroll at 375 px.

## Open

- 40 cards (the 24 fates and 16 leaders) are taller than the rest; grids fit them inside the common card shape.
- Phase 3 (the bot) and phase 6 (public API and CSV export) are not built.
