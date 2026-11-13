/**
 * The stats loader against a real (in-memory) Postgres with the real migrations.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connectPglite, type DB } from "@/db";
import { campaigns, fates, players, seasons } from "@/db/schema";
import { NO_FILTERS } from "@/lib/stats-filters";
import { createCampaign, getCampaign, homeStats, saveAct, voidCampaign } from "./campaigns";
import { getPlayer, listStatFates, loadStatGames } from "./stats";

let db: DB;
let fateId: Record<string, number>;
let ids: Record<string, number>;
let seasonId: number;
const actor = (name: string, isModerator = false) => ({ playerId: ids[name], isModerator });

beforeEach(async () => {
  db = await connectPglite();
  fateId = Object.fromEntries((await db.select().from(fates)).map((f) => [f.name, f.id]));
  const rows = await db
    .insert(players)
    .values(["Emma", "Chris", "Mark", "Mod"].map((n, i) => ({ displayName: n, discordId: `d${i}` })))
    .returning();
  ids = Object.fromEntries(rows.map((r) => [r.displayName, r.id]));
  [{ id: seasonId }] = await db.insert(seasons).values({ name: "Season 1" }).returning();
});

type Row = [fate: string, score: number, success?: boolean];

async function playCampaign(
  who: ({ playerId: number } | { guestName: string })[],
  dates: [string, string, string],
  acts: [Row[], Row[], Row[]],
  opts: { seasonId?: number; stopAfter?: number } = {},
) {
  const id = await createCampaign(db, actor("Emma"), { players: who, seasonId: opts.seasonId ?? null });
  for (let n = 1; n <= (opts.stopAfter ?? 3); n++) {
    const c = (await getCampaign(db, id))!;
    await saveAct(db, actor("Emma"), id, n as 1 | 2 | 3, {
      playedOn: dates[n - 1],
      results: c.players.map((p, i) => ({
        campaignPlayerId: p.cpId,
        fateId: fateId[acts[n - 1][i][0]],
        score: acts[n - 1][i][1],
        success: n < 3 ? (acts[n - 1][i][2] ?? false) : null,
        seat: n === 1 ? i + 1 : null,
      })),
    });
  }
  return id;
}

const THREE = (): [Row[], Row[], Row[]] => [
  [["Steward", 5, true], ["Founder", 4, false], ["Magnate", 6, true]],
  [["Steward", 10, true], ["Pirate", 9, true], ["Hegemon", 8, false]],
  [["Steward", 60], ["Judge", 72], ["Overlord", 41]],
];

describe("loadStatGames", () => {
  it("returns only closed campaigns, with every act, seat and the winner flag", async () => {
    const closed = await playCampaign(
      [{ playerId: ids.Emma }, { playerId: ids.Chris }, { guestName: "Gail" }],
      ["2026-01-01", "2026-01-02", "2026-01-03"],
      THREE(),
    );
    await playCampaign([{ playerId: ids.Emma }, { playerId: ids.Chris }, { playerId: ids.Mark }], ["2026-02-01", "2026-02-02", "2026-02-03"], THREE(), {
      stopAfter: 2,
    });
    const voided = await playCampaign([{ playerId: ids.Emma }, { playerId: ids.Chris }, { playerId: ids.Mark }], ["2026-03-01", "2026-03-02", "2026-03-03"], THREE());
    await voidCampaign(db, actor("Mod", true), voided, "Test game");

    const games = await loadStatGames(db);
    expect(games.map((g) => g.campaignId)).toEqual([closed]);
    const g = games[0];
    expect(g).toMatchObject({ playedOn: "2026-01-03", playerCount: 3 });
    expect(g.entries.map((e) => [e.name, e.isGuest, e.isWinner])).toEqual([
      ["Emma", false, false],
      ["Chris", false, true],
      ["Gail", true, false],
    ]);
    expect(g.entries[1].acts.map((a) => a?.fate)).toEqual(["Founder", "Pirate", "Judge"]);
    expect(g.entries[1].acts.map((a) => a?.success)).toEqual([false, true, null]);
    expect(g.entries[1].acts.map((a) => a?.seat)).toEqual([2, null, null]);
    expect(g.entries[1].acts[2]).toMatchObject({ tier: "C", score: 72 });
  });

  it("filters by Act III date, season and player count", async () => {
    const jan = await playCampaign([{ playerId: ids.Emma }, { playerId: ids.Chris }, { playerId: ids.Mark }], ["2026-01-01", "2026-01-02", "2026-01-31"], THREE(), {
      seasonId,
    });
    const four = await playCampaign(
      [{ playerId: ids.Emma }, { playerId: ids.Chris }, { playerId: ids.Mark }, { guestName: "Gail" }],
      ["2026-01-20", "2026-01-25", "2026-02-01"],
      [
        [...THREE()[0], ["Advocate", 3, true]],
        [...THREE()[1], ["Advocate", 6, true]],
        [...THREE()[2], ["Advocate", 30]],
      ],
    );

    const ids_ = async (f: Partial<typeof NO_FILTERS>) => (await loadStatGames(db, { ...NO_FILTERS, ...f })).map((g) => g.campaignId);
    expect(await ids_({})).toEqual([jan, four]);
    expect(await ids_({ from: "2026-02-01" })).toEqual([four]);
    expect(await ids_({ to: "2026-01-31" })).toEqual([jan]);
    expect(await ids_({ seasonId })).toEqual([jan]);
    expect(await ids_({ playerCount: 4 })).toEqual([four]);
    expect(await ids_({ playerCount: 3, from: "2026-02-01" })).toEqual([]);
  });

  it("returns nothing when there are no closed campaigns", async () => {
    expect(await loadStatGames(db)).toEqual([]);
  });
});

describe("reference reads", () => {
  it("lists fates with tier, complexity and card id", async () => {
    const all = await listStatFates(db);
    expect(all).toHaveLength(24);
    expect(all.find((f) => f.name === "Judge")).toMatchObject({ tier: "C", complexity: null });
    expect(all.every((f) => f.cardId?.startsWith("ARCS-FATE"))).toBe(true);
  });

  it("reads a player, including guests", async () => {
    await playCampaign([{ playerId: ids.Emma }, { playerId: ids.Chris }, { guestName: "Gail" }], ["2026-01-01", "2026-01-02", "2026-01-03"], THREE());
    const [gail] = await db.select().from(players).where(eq(players.displayName, "Gail"));
    expect(await getPlayer(db, gail.id)).toMatchObject({ name: "Gail", isGuest: true });
    expect(await getPlayer(db, 99999)).toBeNull();
  });
});

describe("home stats champion", () => {
  it("still uses most wins, ties broken by win rate", async () => {
    const who = [{ playerId: ids.Emma }, { playerId: ids.Chris }, { playerId: ids.Mark }];
    await playCampaign(who, ["2026-01-01", "2026-01-02", "2026-01-03"], THREE()); // Chris wins
    const second = THREE();
    second[2] = [["Steward", 90], ["Judge", 10], ["Overlord", 11]]; // Emma wins
    await playCampaign(who, ["2026-02-01", "2026-02-02", "2026-02-03"], second);
    await playCampaign([{ playerId: ids.Chris }, { playerId: ids.Emma }, { playerId: ids.Mark }], ["2026-03-01", "2026-03-02", "2026-03-03"], second); // Chris wins
    expect((await homeStats(db)).champion).toMatchObject({ name: "Chris", wins: 2, games: 3 });
    expect(await db.$count(campaigns)).toBe(3);
  });
});
