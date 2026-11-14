/**
 * Lore and Guild card statistics by act (owner request, 2026-11-14: "track
 * stats on lore and guild cards at the end of each act for the players").
 *
 * Pure functions over recorded tableaux loaded by `src/server/card-stats.ts`.
 *
 * Definitions:
 *  - A **tableau** is one player at the end of one act. It counts as
 *    **recorded** once at least one card has been added to it; a tableau with
 *    no cards cannot be told apart from one nobody has filled in, so it is
 *    left out of every number here.
 *  - **Lore** card: `type` is `Lore`.
 *  - **Guild** card: `type` is `Guild` (a fate's own Guild cards) or `tags`
 *    include `Guild` (the Blighted Reach court Guild cards, whose type is
 *    `Blighted Reach Court`). Vox and other court cards are neither.
 *  - **Held** = recorded tableaux holding the card in that act, in campaigns
 *    that are not void (in-progress and stalled campaigns count, as on the card
 *    pages).
 *  - **Holders won** = of the tableaux holding the card in that act in closed
 *    campaigns, how many belonged to the campaign's winner ("w of n"). Rates
 *    on fewer than `CARD_WIN_RATE_MIN_HOLDERS` holders are shown greyed.
 *  - **Average Lore / Guild** = mean number of Lore (Guild) cards per recorded
 *    tableau in that act.
 *  - Guests count, as they do for fate and card stats.
 */
import { rate } from "@/lib/stats";

// A guess to revisit once real games exist, like the thresholds in stats.ts.
export const CARD_WIN_RATE_MIN_HOLDERS = 3;

export type ActNo = 1 | 2 | 3;
export const ACT_NOS: readonly ActNo[] = [1, 2, 3];

export type CardKind = "lore" | "guild";

export function cardKind(c: { type: string; tags: readonly string[] }): CardKind | null {
  if (c.type === "Lore") return "lore";
  if (c.type === "Guild" || c.tags.includes("Guild")) return "guild";
  return null;
}

export interface TableauCard {
  id: string;
  name: string;
  type: string;
  tags: string[];
  imageV: number | null;
}

/** A recorded tableau: one player's cards at the end of one act. */
export interface StatTableau {
  campaignId: number;
  title: string;
  /** The campaign's date for filters: the latest act played (Act III once closed). */
  playedOn: string;
  closed: boolean;
  actNo: ActNo;
  campaignPlayerId: number;
  playerId: number;
  player: string;
  isGuest: boolean;
  isWinner: boolean;
  cards: TableauCard[];
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function countKinds(t: StatTableau) {
  let lore = 0;
  let guild = 0;
  for (const c of t.cards) {
    const k = cardKind(c);
    if (k === "lore") lore++;
    else if (k === "guild") guild++;
  }
  return { lore, guild };
}

/** Mean Lore and Guild cards per recorded tableau. */
export interface KindAverages {
  tableaux: number;
  avgLore: number | null;
  avgGuild: number | null;
}

function averages(ts: StatTableau[]): KindAverages {
  const counts = ts.map(countKinds);
  return {
    tableaux: ts.length,
    avgLore: mean(counts.map((c) => c.lore)),
    avgGuild: mean(counts.map((c) => c.guild)),
  };
}

// ---------------------------------------------------------------------------
// League-wide, by act

export interface CardActRow {
  id: string;
  name: string;
  type: string;
  imageV: number | null;
  /** Recorded tableaux holding the card in this act (campaigns not void). */
  held: number;
  /** Of those, tableaux in closed campaigns, and how many were the winner's. */
  holders: number;
  wins: number;
  winRate: number | null;
}

export interface ActCardStats extends KindAverages {
  actNo: ActNo;
  lore: CardActRow[];
  guild: CardActRow[];
}

const byHeld = (a: CardActRow, b: CardActRow) =>
  b.held - a.held || b.holders - a.holders || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** Most-held Lore and Guild cards, their holders' win rate, and average counts, for Acts I, II and III. */
export function loreGuildByAct(tableaux: StatTableau[]): [ActCardStats, ActCardStats, ActCardStats] {
  return ACT_NOS.map((actNo) => {
    const ts = tableaux.filter((t) => t.actNo === actNo);
    const rows = new Map<string, CardActRow & { kind: CardKind }>();
    for (const t of ts) {
      for (const c of t.cards) {
        const kind = cardKind(c);
        if (!kind) continue;
        let r = rows.get(c.id);
        if (!r) {
          r = { id: c.id, name: c.name, type: c.type, imageV: c.imageV, kind, held: 0, holders: 0, wins: 0, winRate: null };
          rows.set(c.id, r);
        }
        r.held++;
        if (t.closed) {
          r.holders++;
          if (t.isWinner) r.wins++;
        }
      }
    }
    const list = [...rows.values()].map(({ kind, ...r }) => ({ kind, row: { ...r, winRate: rate(r.wins, r.holders) } }));
    const of = (k: CardKind) => list.filter((x) => x.kind === k).map((x) => x.row).sort(byHeld);
    return { actNo, ...averages(ts), lore: of("lore"), guild: of("guild") };
  }) as [ActCardStats, ActCardStats, ActCardStats];
}

/** Whether a holders' win rate rests on enough holders to show at full strength. */
export function enoughHolders(holders: number, min = CARD_WIN_RATE_MIN_HOLDERS): boolean {
  return holders >= min;
}

// ---------------------------------------------------------------------------
// One player

export interface PlayerHeldCard {
  id: string;
  name: string;
  type: string;
  imageV: number | null;
  kind: CardKind | null;
  /** Tableaux of this player's holding the card in this act. */
  count: number;
}

export interface PlayerCardAct extends KindAverages {
  actNo: ActNo;
  /** Lore first, then Guild, then the rest; most often held first. */
  cards: PlayerHeldCard[];
}

export interface PlayerCardCampaign {
  campaignId: number;
  title: string;
  playedOn: string;
  closed: boolean;
  won: boolean;
  campaignPlayerId: number;
  /** Index 0..2 = Act I..III; null where that tableau has no cards recorded. */
  acts: [PlayerTableauCount | null, PlayerTableauCount | null, PlayerTableauCount | null];
}

export interface PlayerTableauCount {
  lore: number;
  guild: number;
  total: number;
}

export interface PlayerCards {
  byAct: [PlayerCardAct, PlayerCardAct, PlayerCardAct];
  /** Newest first. */
  campaigns: PlayerCardCampaign[];
}

const KIND_ORDER: Record<string, number> = { lore: 0, guild: 1, other: 2 };

/** The cards one player held at the end of each act, across their campaigns. Null if none recorded. */
export function playerCards(tableaux: StatTableau[], playerId: number): PlayerCards | null {
  const mine = tableaux.filter((t) => t.playerId === playerId);
  if (!mine.length) return null;

  const byAct = ACT_NOS.map((actNo) => {
    const ts = mine.filter((t) => t.actNo === actNo);
    const held = new Map<string, PlayerHeldCard>();
    for (const t of ts) {
      for (const c of t.cards) {
        const h = held.get(c.id);
        if (h) h.count++;
        else held.set(c.id, { id: c.id, name: c.name, type: c.type, imageV: c.imageV, kind: cardKind(c), count: 1 });
      }
    }
    const cards = [...held.values()].sort(
      (a, b) =>
        KIND_ORDER[a.kind ?? "other"] - KIND_ORDER[b.kind ?? "other"] ||
        b.count - a.count ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
    return { actNo, ...averages(ts), cards };
  }) as PlayerCards["byAct"];

  const camps = new Map<number, PlayerCardCampaign>();
  for (const t of mine) {
    let c = camps.get(t.campaignId);
    if (!c) {
      c = {
        campaignId: t.campaignId,
        title: t.title,
        playedOn: t.playedOn,
        closed: t.closed,
        won: t.closed && t.isWinner,
        campaignPlayerId: t.campaignPlayerId,
        acts: [null, null, null],
      };
      camps.set(t.campaignId, c);
    }
    const k = countKinds(t);
    c.acts[t.actNo - 1] = { ...k, total: t.cards.length };
  }
  const campaigns = [...camps.values()].sort(
    (a, b) => b.playedOn.localeCompare(a.playedOn) || b.campaignId - a.campaignId,
  );
  return { byAct, campaigns };
}
