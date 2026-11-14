# Phase 5 report: cards (text first)

Built 2026-11-14 at the owner's request. Card images are left out on purpose: the owner decided to launch with names, text and links back to Buried Giant first, and add images once the permission's scope is confirmed (spec section 11).

## Built

- **Import** (`/admin/cards`, moderators): "Check Buried Giant for changes" fetches `cards.json` and shows what an import would add, change, remove or bring back; "Import these changes" applies it. The site never fetches on its own. 459 cards: every ARCS card except setup cards (tag `Setup`) and player aids (`ARCS-AID…`). Each card keeps its upstream record (`cards.source`) to detect changes. A card that disappears upstream is marked removed, not deleted, so tags on it survive. Fate complexity is filled from the fate cards. Every import is audit-logged with the Buried Giant data version.
- **Card reference** (`/cards`, `/cards/<id>`): search by name, text or id; filter by type and fate. Each card shows its rules text (Buried Giant's markup rendered safely: bold, italic, symbols such as the clock), fate, act, keys, other side, a "View on Buried Giant" link, and how often it was seen on tagged tableau photos and how many of those holders went on to win a closed campaign.
- **Fate pages**: the fate card's text (path to power per act), complexity, and the fate's card set grouped by act.
- **Tagging** (`/campaigns/<id>/photos/<photoId>`): any signed-in member opens a tableau photo and adds the cards they can see. The picker offers the player's fate cards for that act first (this act's first), then court cards (base and Blighted Reach), Lore, and other fates' Guild and Vox cards. Each card appears in one group; other fates' cards show the fate name, since several court cards exist in more than one version. Tags show under each tableau photo on the campaign page. Thumbnails now open this photo page.
- Replacing a tableau photo keeps its tags. All tag changes are audit-logged.
- **Cards** in the main navigation; the footer credit now links to Buried Giant's card site.

## Decisions made (owner to confirm)

- **Other fates' Guild and Vox cards are taggable** as well as the spec's list (court, Lore, the player's own fate cards): those cards enter the shared court, so any player can end up holding one.
- **Removing a tag:** whoever added it, the campaign's players, or a moderator.
- **"Holders won":** players in closed campaigns with the card tagged in any act, and how many of them won. Void campaigns never count; in-progress ones count toward "Seen" only.
- **The fate card and resolution cards are not offered for tagging** (the fate card sits beside the board, resolutions are read at the end of an act).

## Verified

- 131 Vitest tests pass (21 new: upstream parsing and exclusions, import planning with changes, removals and restorations, card text markup, picker grouping, import against PGlite including fate complexity and audit, search and filters, the fetch with a fake server, tagging and removal permissions, sighting stats, tags surviving a photo replacement).
- Typecheck and production build pass.
- In the browser against demo data: a real import of 459 cards from Buried Giant, a second check reporting "up to date", card and fate pages, tagging, searching, removing a tag, the card's sighting count, the campaign page's tag list, signed-out views, and a 375 px phone layout.

## To do on production

- A moderator opens **Cards → Card import**, clicks **Check Buried Giant for changes**, then **Import these changes**.

## Open

- Card images (Vercel Blob copies, thumbnail and full) once the permission covers public display.
- Phase 3 (the bot) and phase 6 (public API and CSV export) are not built.
