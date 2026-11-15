/**
 * Loads closed campaigns for the stats pages. The calculations themselves are
 * pure and live in `src/lib/stats.ts`; this module only reads the database.
 */
import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/db";
import { actResults, acts, campaignPlayers, campaigns, fates, players } from "@/db/schema";
import type { StatAct, StatFate, StatGame } from "@/lib/stats";
import { NO_FILTERS, platformCondition, type StatsFilters } from "@/lib/stats-filters";

/**
 * Closed campaigns matching the filters, oldest first. In-progress, stalled and
 * void campaigns are never returned. The date filter applies to Act III's date.
 */
export async function loadStatGames(db: DbOrTx, f: StatsFilters = NO_FILTERS): Promise<StatGame[]> {
  const act3 = alias(acts, "act3");
  const conds = [eq(campaigns.status, "closed")];
  if (f.seasonId) conds.push(eq(campaigns.seasonId, f.seasonId));
  if (f.playerCount) conds.push(eq(campaigns.playerCount, f.playerCount));
  const played = platformCondition(f, {
    isNull: () => isNull(campaigns.sourcePlatform),
    eq: (v) => eq(campaigns.sourcePlatform, v),
  });
  if (played) conds.push(played);
  if (f.from) conds.push(gte(act3.playedOn, f.from));
  if (f.to) conds.push(lte(act3.playedOn, f.to));

  const rows = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      playerCount: campaigns.playerCount,
      seasonId: campaigns.seasonId,
      playedOn: act3.playedOn,
    })
    .from(campaigns)
    .innerJoin(act3, and(eq(act3.campaignId, campaigns.id), eq(act3.actNo, 3)))
    .where(and(...conds))
    .orderBy(asc(act3.playedOn), asc(campaigns.id));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);

  const seats = await db
    .select({
      cpId: campaignPlayers.id,
      campaignId: campaignPlayers.campaignId,
      playerId: players.id,
      name: players.displayName,
      isGuest: players.isGuest,
      isWinner: campaignPlayers.isWinner,
    })
    .from(campaignPlayers)
    .innerJoin(players, eq(players.id, campaignPlayers.playerId))
    .where(inArray(campaignPlayers.campaignId, ids))
    .orderBy(asc(campaignPlayers.position));

  const results = await db
    .select({
      cpId: actResults.campaignPlayerId,
      actNo: acts.actNo,
      fateId: fates.id,
      fate: fates.name,
      tier: fates.tier,
      score: actResults.score,
      success: actResults.success,
      seat: actResults.seat,
    })
    .from(actResults)
    .innerJoin(acts, eq(acts.id, actResults.actId))
    .innerJoin(fates, eq(fates.id, actResults.fateId))
    .where(inArray(acts.campaignId, ids));

  const byCp = new Map<number, [StatAct | null, StatAct | null, StatAct | null]>();
  for (const r of results) {
    let a = byCp.get(r.cpId);
    if (!a) byCp.set(r.cpId, (a = [null, null, null]));
    a[r.actNo - 1] = {
      fateId: r.fateId,
      fate: r.fate,
      tier: r.tier,
      score: r.score,
      success: r.success,
      seat: r.seat,
    };
  }

  return rows.map((c) => ({
    campaignId: c.id,
    title: c.title,
    playedOn: c.playedOn,
    playerCount: c.playerCount,
    seasonId: c.seasonId,
    entries: seats
      .filter((s) => s.campaignId === c.id)
      .map((s) => ({
        playerId: s.playerId,
        name: s.name,
        isGuest: s.isGuest,
        isWinner: s.isWinner,
        acts: byCp.get(s.cpId) ?? [null, null, null],
      })),
  }));
}

export interface FateRecord extends StatFate {
  cardId: string | null;
}

export async function listStatFates(db: DbOrTx): Promise<FateRecord[]> {
  return db
    .select({ id: fates.id, name: fates.name, tier: fates.tier, complexity: fates.complexity, cardId: fates.cardId })
    .from(fates)
    .orderBy(asc(fates.sortOrder), asc(fates.name));
}

export async function getPlayer(db: DbOrTx, id: number) {
  const [p] = await db
    .select({
      id: players.id,
      name: players.displayName,
      avatarUrl: players.avatarUrl,
      isGuest: players.isGuest,
      isModerator: players.isModerator,
      linkedPlayerId: players.linkedPlayerId,
    })
    .from(players)
    .where(eq(players.id, id));
  return p ?? null;
}
