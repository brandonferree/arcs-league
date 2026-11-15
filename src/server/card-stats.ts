/**
 * Loads recorded tableaux (a player's cards at the end of an act) for the Lore
 * and Guild card stats. The calculations are pure and live in
 * `src/lib/card-stats.ts`; this module only reads the database.
 */
import { and, asc, eq, gte, inArray, isNull, lte, max, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { acts, campaignPlayers, campaigns, cards, cardTags, players } from "@/db/schema";
import type { ActNo, StatTableau } from "@/lib/card-stats";
import { NO_FILTERS, platformCondition, type StatsFilters } from "@/lib/stats-filters";

/**
 * Every tableau with at least one card recorded, in campaigns that are not void
 * and match the filters. The date filter applies to the campaign's latest act
 * (Act III once closed, as on the other stats pages). With `playerId`, only
 * that player's tableaux.
 */
export async function loadTableaux(
  db: DbOrTx,
  f: StatsFilters = NO_FILTERS,
  { playerId }: { playerId?: number } = {},
): Promise<StatTableau[]> {
  const conds = [ne(campaigns.status, "void")];
  if (f.seasonId) conds.push(eq(campaigns.seasonId, f.seasonId));
  if (f.playerCount) conds.push(eq(campaigns.playerCount, f.playerCount));
  const played = platformCondition(f, {
    isNull: () => isNull(campaigns.sourcePlatform),
    eq: (v) => eq(campaigns.sourcePlatform, v),
  });
  if (played) conds.push(played);
  const lastPlayed = max(acts.playedOn);
  const dateConds = [];
  if (f.from) dateConds.push(gte(lastPlayed, f.from));
  if (f.to) dateConds.push(lte(lastPlayed, f.to));

  const camps = await db
    .select({ id: campaigns.id, title: campaigns.title, status: campaigns.status, playedOn: lastPlayed })
    .from(campaigns)
    .innerJoin(acts, eq(acts.campaignId, campaigns.id))
    .where(and(...conds))
    .groupBy(campaigns.id)
    .having(dateConds.length ? and(...dateConds) : undefined);
  if (!camps.length) return [];
  const byId = new Map(camps.map((c) => [c.id, c]));

  const rows = await db
    .select({
      campaignId: acts.campaignId,
      actNo: acts.actNo,
      campaignPlayerId: campaignPlayers.id,
      playerId: players.id,
      player: players.displayName,
      isGuest: players.isGuest,
      isWinner: campaignPlayers.isWinner,
      cardId: cards.id,
      name: cards.name,
      type: cards.type,
      tags: cards.tags,
      imageV: sql<number | null>`case when ${cards.imageKey} is not null then floor(extract(epoch from ${cards.imageCopiedAt}))::int end`,
    })
    .from(cardTags)
    .innerJoin(acts, eq(acts.id, cardTags.actId))
    .innerJoin(campaignPlayers, eq(campaignPlayers.id, cardTags.campaignPlayerId))
    .innerJoin(players, eq(players.id, campaignPlayers.playerId))
    .innerJoin(cards, eq(cards.id, cardTags.cardId))
    .where(
      and(
        inArray(
          acts.campaignId,
          camps.map((c) => c.id),
        ),
        playerId ? eq(players.id, playerId) : undefined,
      ),
    )
    .orderBy(asc(acts.campaignId), asc(acts.actNo), asc(campaignPlayers.position), asc(cards.name), asc(cards.id));

  const tableaux = new Map<string, StatTableau>();
  for (const r of rows) {
    const key = `${r.actNo}:${r.campaignPlayerId}`;
    let t = tableaux.get(key);
    if (!t) {
      const c = byId.get(r.campaignId)!;
      t = {
        campaignId: r.campaignId,
        title: c.title,
        playedOn: c.playedOn ?? "",
        closed: c.status === "closed",
        actNo: r.actNo as ActNo,
        campaignPlayerId: r.campaignPlayerId,
        playerId: r.playerId,
        player: r.player,
        isGuest: r.isGuest,
        isWinner: r.isWinner,
        cards: [],
      };
      tableaux.set(key, t);
    }
    t.cards.push({ id: r.cardId, name: r.name, type: r.type, tags: r.tags, imageV: r.imageV });
  }
  return [...tableaux.values()];
}
