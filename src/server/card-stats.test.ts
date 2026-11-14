/**
 * The tableau loader for Lore and Guild card stats, against PGlite with the real migrations.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { connectPglite, type DB } from "@/db";
import { fates, players, seasons } from "@/db/schema";
import { loreGuildByAct, playerCards } from "@/lib/card-stats";
import { parseUpstream } from "@/lib/cards";
import { NO_FILTERS } from "@/lib/stats-filters";
import { createCampaign, getCampaign, saveAct, voidCampaign } from "./campaigns";
import { loadTableaux } from "./card-stats";
import { addCardTag, importCards } from "./cards";

const RAW: Record<string, unknown>[] = [
  { id: "ARCS-F103", name: "Dealmakers", tags: ["Blighted Reach", "Guild", "Psionic", "Steward"], meta: { act: 1 }, game: "arcs", product: "blightedreach" },
  { id: "ARCS-CC01", name: "Mining Interest", tags: ["Blighted Reach", "Blighted Reach Court", "Guild", "Material"], game: "arcs", product: "blightedreach" },
  { id: "ARCS-CC20", name: "Populist Demands", tags: ["Blighted Reach", "Blighted Reach Court", "Vox"], game: "arcs", product: "blightedreach" },
  { id: "ARCS-L01", name: "Tool-Priests", tags: ["Base", "Lore"], game: "arcs", product: "arcsbasegame" },
];

let db: DB;
let ids: Record<string, number>;
let fateId: Record<string, number>;
let seasonId: number;
const actor = (name: string, isModerator = false) => ({ playerId: ids[name], isModerator });

beforeEach(async () => {
  db = await connectPglite();
  const rows = await db
    .insert(players)
    .values(["Emma", "Chris", "Mark", "Mod"].map((n, i) => ({ displayName: n, discordId: `d${i}` })))
    .returning();
  ids = Object.fromEntries(rows.map((r) => [r.displayName, r.id]));
  fateId = Object.fromEntries((await db.select().from(fates)).map((f) => [f.name, f.id]));
  [{ id: seasonId }] = await db.insert(seasons).values({ name: "Season 1" }).returning();
  await importCards(db, actor("Mod", true), { ...parseUpstream(RAW), version: "v1" });
});

const PATH = [
  ["Steward", "Steward", "Steward"],
  ["Founder", "Pirate", "Judge"],
  ["Magnate", "Hegemon", "Overlord"],
];
const SCORES = [
  [5, 10, 60],
  [4, 9, 72], // Chris wins
  [6, 8, 41],
];

/** A 3-player campaign (Emma, Chris, Mark) played up to `acts`; dates are `${month}-0${act}`. */
async function campaign(month: string, acts: number, opts: { seasonId?: number } = {}) {
  const id = await createCampaign(db, actor("Emma"), {
    players: [{ playerId: ids.Emma }, { playerId: ids.Chris }, { playerId: ids.Mark }],
    seasonId: opts.seasonId ?? null,
  });
  for (let n = 1; n <= acts; n++) {
    const c = (await getCampaign(db, id))!;
    await saveAct(db, actor("Emma"), id, n as 1 | 2 | 3, {
      playedOn: `${month}-0${n}`,
      results: c.players.map((p, i) => ({
        campaignPlayerId: p.cpId,
        fateId: fateId[PATH[i][n - 1]],
        score: SCORES[i][n - 1],
        success: n < 3 ? true : null,
      })),
    });
  }
  const cp = Object.fromEntries((await getCampaign(db, id))!.players.map((p) => [p.name, p.cpId]));
  const tag = (name: string, actNo: number, ...cardIds: string[]) =>
    Promise.all(cardIds.map((cardId) => addCardTag(db, actor("Emma"), { campaignId: id, actNo, campaignPlayerId: cp[name] }, cardId)));
  return { id, tag };
}

describe("loadTableaux", () => {
  it("groups each player's cards per act, with campaign status and winner, and skips void campaigns", async () => {
    const closed = await campaign("2026-01", 3);
    await closed.tag("Chris", 1, "ARCS-L01", "ARCS-CC20");
    await closed.tag("Chris", 2, "ARCS-L01", "ARCS-CC01");
    await closed.tag("Emma", 2, "ARCS-F103");
    const open = await campaign("2026-02", 1);
    await open.tag("Mark", 1, "ARCS-L01", "ARCS-CC01");
    const voided = await campaign("2026-03", 3);
    await voided.tag("Emma", 1, "ARCS-L01");
    await voidCampaign(db, actor("Mod", true), voided.id, "Test game");

    const ts = await loadTableaux(db);
    expect(ts.map((t) => [t.campaignId, t.actNo, t.player, t.cards.map((c) => c.id)])).toEqual([
      [closed.id, 1, "Chris", ["ARCS-CC20", "ARCS-L01"]],
      [closed.id, 2, "Emma", ["ARCS-F103"]],
      [closed.id, 2, "Chris", ["ARCS-CC01", "ARCS-L01"]],
      [open.id, 1, "Mark", ["ARCS-CC01", "ARCS-L01"]],
    ]);
    expect(ts[0]).toMatchObject({ closed: true, isWinner: true, playedOn: "2026-01-03", isGuest: false });
    expect(ts[3]).toMatchObject({ closed: false, isWinner: false, playedOn: "2026-02-01" });
    expect(ts[0].cards.find((c) => c.id === "ARCS-CC20")).toMatchObject({ type: "Blighted Reach Court", imageV: null });

    // End to end with the pure calculations.
    const [a1, a2] = loreGuildByAct(ts);
    expect(a1.lore).toMatchObject([{ id: "ARCS-L01", held: 2, holders: 1, wins: 1 }]);
    expect(a1.guild).toMatchObject([{ id: "ARCS-CC01", held: 1, holders: 0 }]);
    expect(a2).toMatchObject({ tableaux: 2, avgLore: 0.5, avgGuild: 1 });

    const chris = await loadTableaux(db, NO_FILTERS, { playerId: ids.Chris });
    expect(chris).toHaveLength(2);
    expect(playerCards(chris, ids.Chris)?.byAct[1]).toMatchObject({ tableaux: 1, avgLore: 1, avgGuild: 1 });
  });

  it("filters by the campaign's latest act date, season and player count", async () => {
    const jan = await campaign("2026-01", 3, { seasonId });
    await jan.tag("Emma", 1, "ARCS-L01");
    const feb = await campaign("2026-02", 2);
    await feb.tag("Emma", 1, "ARCS-L01");

    const camps = async (f: Partial<typeof NO_FILTERS>) =>
      [...new Set((await loadTableaux(db, { ...NO_FILTERS, ...f })).map((t) => t.campaignId))];
    expect(await camps({})).toEqual([jan.id, feb.id]);
    expect(await camps({ seasonId })).toEqual([jan.id]);
    // January's latest act is 2026-01-03; February's (in progress) is 2026-02-02.
    expect(await camps({ to: "2026-01-03" })).toEqual([jan.id]);
    expect(await camps({ from: "2026-01-04" })).toEqual([feb.id]);
    expect(await camps({ from: "2026-02-03" })).toEqual([]);
    expect(await camps({ playerCount: 4 })).toEqual([]);
    expect(await camps({ playerCount: 3 })).toEqual([jan.id, feb.id]);
  });

  it("returns nothing when no cards are recorded", async () => {
    await campaign("2026-01", 3);
    expect(await loadTableaux(db)).toEqual([]);
  });
});
