/**
 * Integration tests against a real (in-memory) Postgres via PGlite, with the
 * real migrations applied.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connectPglite, type DB } from "@/db";
import { auditLog, fates, players } from "@/db/schema";
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  homeStats,
  listCampaigns,
  PermissionError,
  reopenCampaign,
  RuleError,
  saveAct,
  voidCampaign,
} from "./campaigns";

let db: DB;
let fateId: Record<string, number>;
let ids: Record<string, number>;
const actor = (name: string, isModerator = false) => ({ playerId: ids[name], isModerator });

beforeEach(async () => {
  db = await connectPglite();
  fateId = Object.fromEntries((await db.select().from(fates)).map((f) => [f.name, f.id]));
  const rows = await db
    .insert(players)
    .values(["Emma", "Chris", "Mark", "Outsider", "Mod"].map((n, i) => ({ displayName: n, discordId: `d${i}` })))
    .returning();
  ids = Object.fromEntries(rows.map((r) => [r.displayName, r.id]));
});

async function newCampaign() {
  return createCampaign(db, actor("Emma"), {
    players: [{ playerId: ids.Emma }, { playerId: ids.Chris }, { guestName: "Guest Gail" }],
  });
}

function results(
  detail: NonNullable<Awaited<ReturnType<typeof getCampaign>>>,
  rows: [fate: string, score: number, success?: boolean][],
) {
  return detail.players.map((p, i) => ({
    campaignPlayerId: p.cpId,
    fateId: fateId[rows[i][0]],
    score: rows[i][1],
    success: rows[i][2] ?? null,
  }));
}

async function expectRuleError(p: Promise<unknown>, fragment: string) {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(RuleError);
  expect((err as RuleError).errors.join("\n")).toContain(fragment);
}

describe("migrations and seed", () => {
  it("seeds the 24 fates with tier and act", async () => {
    const all = await db.select().from(fates);
    expect(all).toHaveLength(24);
    expect(all.find((f) => f.name === "Planet Breaker")).toMatchObject({ tier: "B", act: 2, cardId: "ARCS-FATE11" });
  });
});

describe("creating a campaign", () => {
  it("creates players, a guest and an auto title", async () => {
    const id = await newCampaign();
    const c = (await getCampaign(db, id))!;
    expect(c.title).toBe(`Campaign #${id}`);
    expect(c.players.map((p) => p.name)).toEqual(["Emma", "Chris", "Guest Gail"]);
    expect(c.players[2].isGuest).toBe(true);
    expect(c.status).toBe("in_progress");
  });

  it("reuses an existing guest with the same name", async () => {
    await newCampaign();
    const id2 = await createCampaign(db, actor("Chris"), {
      players: [{ playerId: ids.Mark }, { playerId: ids.Chris }, { guestName: "guest gail" }],
    });
    const guests = await db.select().from(players).where(eq(players.isGuest, true));
    expect(guests).toHaveLength(1);
    expect((await getCampaign(db, id2))!.players[2].playerId).toBe(guests[0].id);
  });

  it("rejects 2 or 5 players", async () => {
    await expectRuleError(createCampaign(db, actor("Emma"), { players: [{ playerId: ids.Emma }, { playerId: ids.Chris }] }), "3 or 4 players");
    await expectRuleError(
      createCampaign(db, actor("Emma"), {
        players: ["Emma", "Chris", "Mark", "Outsider", "Mod"].map((n) => ({ playerId: ids[n] })),
      }),
      "3 or 4 players",
    );
  });

  it("rejects duplicate players and a guest named like a member", async () => {
    await expectRuleError(
      createCampaign(db, actor("Emma"), { players: [{ playerId: ids.Emma }, { playerId: ids.Emma }, { playerId: ids.Mark }] }),
      "more than once",
    );
    await expectRuleError(
      createCampaign(db, actor("Emma"), { players: [{ playerId: ids.Emma }, { guestName: "emma" }, { playerId: ids.Mark }] }),
      "more than once",
    );
  });
});

describe("logging all three acts", () => {
  it("records acts in order, closes on Act III and picks the winner", async () => {
    const id = await newCampaign();
    let c = (await getCampaign(db, id))!;

    await saveAct(db, actor("Chris"), id, 1, {
      playedOn: "2026-11-01",
      results: results(c, [["Steward", 5, true], ["Founder", 4, false], ["Magnate", 6, true]]),
    });
    c = (await getCampaign(db, id))!;
    await saveAct(db, actor("Emma"), id, 2, {
      playedOn: "2026-11-02",
      vodUrl: "https://example.com/vod",
      results: results(c, [["Steward", 12, true], ["Pirate", 9, true], ["Planet Breaker", 10, false]]),
    });
    c = (await getCampaign(db, id))!;
    const r = await saveAct(db, actor("Emma"), id, 3, {
      playedOn: "2026-11-03",
      results: results(c, [["Steward", 60], ["Judge", 72], ["Overlord", 41]]),
    });
    expect(r.closed).toBe(true);

    c = (await getCampaign(db, id))!;
    expect(c.status).toBe("closed");
    expect(c.acts).toHaveLength(3);
    expect(c.players.filter((p) => p.isWinner).map((p) => p.name)).toEqual(["Chris"]);
    expect(c.winnerOverridden).toBe(false);
    expect(c.acts.map((a) => a.createdBy)).toEqual(["Chris", "Emma", "Emma"]);
    expect(c.acts[0].updatedBy).toBeNull();

    const list = await listCampaigns(db, { status: "closed" });
    expect(list[0]).toMatchObject({ id, winners: ["Chris"], topScore: 72, actsRecorded: 3 });
    expect(list[0].winnerPath.map((s) => s.fate)).toEqual(["Founder", "Pirate", "Judge"]);

    const stats = await homeStats(db);
    expect(stats).toMatchObject({ closedCount: 1, inProgressCount: 0, champion: { name: "Chris", wins: 1, games: 1 } });
    expect(stats.topAct3).toMatchObject({ score: 72, player: "Chris", fate: "Judge" });

    const log = await db.select().from(auditLog).where(eq(auditLog.campaignId, id));
    expect(log.map((l) => l.action).sort()).toEqual(["act.create", "act.create", "act.create", "campaign.close", "campaign.create"]);
  });

  it("supports an explicit winner override with a reason", async () => {
    const id = await newCampaign();
    let c = (await getCampaign(db, id))!;
    await saveAct(db, actor("Emma"), id, 1, { playedOn: "2026-11-01", results: results(c, [["Steward", 5, true], ["Founder", 4, true], ["Magnate", 6, true]]) });
    c = (await getCampaign(db, id))!;
    await saveAct(db, actor("Emma"), id, 2, { playedOn: "2026-11-02", results: results(c, [["Pirate", 5, true], ["Founder", 4, true], ["Magnate", 6, true]]) });
    c = (await getCampaign(db, id))!;
    const act3 = { playedOn: "2026-11-03", results: results(c, [["Judge", 30], ["Founder", 50], ["Magnate", 40]]) };

    await expectRuleError(saveAct(db, actor("Emma"), id, 3, { ...act3, winners: [c.players[0].cpId] }), "Give a reason");
    await saveAct(db, actor("Emma"), id, 3, { ...act3, winners: [c.players[0].cpId], winnerReason: "Judge objective" });
    c = (await getCampaign(db, id))!;
    expect(c.players.filter((p) => p.isWinner).map((p) => p.name)).toEqual(["Emma"]);
    expect(c).toMatchObject({ winnerOverridden: true, winnerOverrideReason: "Judge objective", status: "closed" });
  });
});

describe("rule violations are blocked on save", () => {
  let id: number;
  beforeEach(async () => {
    id = await newCampaign();
  });

  it("Act I must be A", async () => {
    const c = (await getCampaign(db, id))!;
    await expectRuleError(
      saveAct(db, actor("Emma"), id, 1, { playedOn: "2026-11-01", results: results(c, [["Pirate", 5, true], ["Founder", 4, true], ["Magnate", 6, true]]) }),
      "must be an A fate",
    );
    expect((await getCampaign(db, id))!.acts).toHaveLength(0);
  });

  it("checks new acts against earlier ones", async () => {
    let c = (await getCampaign(db, id))!;
    await saveAct(db, actor("Emma"), id, 1, { playedOn: "2026-11-01", results: results(c, [["Steward", 5, false], ["Founder", 4, true], ["Magnate", 6, true]]) });
    c = (await getCampaign(db, id))!;
    await expectRuleError(
      saveAct(db, actor("Emma"), id, 2, { playedOn: "2026-11-02", results: results(c, [["Steward", 5, true], ["Pirate", 4, true], ["Hegemon", 6, true]]) }),
      "can only be continued after a success",
    );
    await expectRuleError(
      saveAct(db, actor("Emma"), id, 2, { playedOn: "2026-11-02", results: results(c, [["Pirate", 5, true], ["Pirate", 4, true], ["Hegemon", 6, true]]) }),
      "can belong to only one player",
    );
    await expectRuleError(
      saveAct(db, actor("Emma"), id, 2, { playedOn: "2026-11-02", results: results(c, [["Judge", 5, true], ["Pirate", 4, true], ["Hegemon", 6, true]]) }),
      "C fates are Act III only",
    );
  });

  it("requires acts in order, success flags, valid seats and every player", async () => {
    const c = (await getCampaign(db, id))!;
    const ok = results(c, [["Steward", 5, true], ["Founder", 4, true], ["Magnate", 6, true]]);
    await expectRuleError(saveAct(db, actor("Emma"), id, 2, { playedOn: "2026-11-01", results: ok }), "Record Act I first");
    await expectRuleError(
      saveAct(db, actor("Emma"), id, 1, { playedOn: "2026-11-01", results: ok.map((r) => ({ ...r, success: null })) }),
      "succeeded",
    );
    await expectRuleError(
      saveAct(db, actor("Emma"), id, 1, { playedOn: "2026-11-01", results: ok.map((r) => ({ ...r, seat: 1 })) }),
      "share a seat",
    );
    await expectRuleError(saveAct(db, actor("Emma"), id, 1, { playedOn: "2026-11-01", results: ok.slice(1) }), "each player");
    await expectRuleError(saveAct(db, actor("Emma"), id, 1, { playedOn: "nope", results: ok }), "YYYY-MM-DD");
  });

  it("accepts negative scores (a failed objective's penalty) within -999..999", async () => {
    const c = (await getCampaign(db, id))!;
    await expect(
      saveAct(db, actor("Emma"), id, 1, { playedOn: "2026-11-01", results: results(c, [["Steward", -1000, false], ["Founder", 4, true], ["Magnate", 6, true]]) }),
    ).rejects.toThrow();
    await saveAct(db, actor("Emma"), id, 1, { playedOn: "2026-11-01", results: results(c, [["Steward", -5, false], ["Founder", 4, true], ["Magnate", 6, true]]) });
    const saved = (await getCampaign(db, id))!;
    expect(JSON.stringify(saved)).toContain('"score":-5');
  });
});

describe("permissions and the edit window", () => {
  it("blocks outsiders and enforces 24 hours for players, not moderators", async () => {
    const id = await newCampaign();
    const c = (await getCampaign(db, id))!;
    const act1 = { playedOn: "2026-11-01", results: results(c, [["Steward", 5, true], ["Founder", 4, true], ["Magnate", 6, true]]) };

    await expect(saveAct(db, actor("Outsider"), id, 1, act1)).rejects.toBeInstanceOf(PermissionError);

    const saved = new Date("2026-11-01T20:00:00Z");
    await saveAct(db, actor("Emma"), id, 1, act1, saved);

    const edited = { ...act1, notes: "fixed a score" };
    await saveAct(db, actor("Chris"), id, 1, edited, new Date(saved.getTime() + 23 * 3_600_000));
    await expect(
      saveAct(db, actor("Chris"), id, 1, edited, new Date(saved.getTime() + 25 * 3_600_000)),
    ).rejects.toThrow(/24-hour edit window/);
    await saveAct(db, actor("Mod", true), id, 1, { ...edited, notes: "mod fix" }, new Date(saved.getTime() + 999 * 3_600_000));

    const after = (await getCampaign(db, id))!;
    expect(after.acts[0].notes).toBe("mod fix");
    expect(after.acts[0].createdAt.toISOString()).toBe(saved.toISOString());

    const updates = await db.select().from(auditLog).where(eq(auditLog.action, "act.update"));
    expect(updates).toHaveLength(2);
    expect(updates[1].before).toMatchObject({ notes: "fixed a score" });
    expect(updates[1].after).toMatchObject({ notes: "mod fix" });
  });

  it("lets moderators void, reopen and delete; others cannot", async () => {
    const id = await newCampaign();
    await expect(voidCampaign(db, actor("Emma"), id, "x")).rejects.toBeInstanceOf(PermissionError);
    await voidCampaign(db, actor("Mod", true), id, "duplicate entry");
    expect((await getCampaign(db, id))!.status).toBe("void");
    expect(await listCampaigns(db, { status: "in_progress" })).toHaveLength(0);
    await reopenCampaign(db, actor("Mod", true), id);
    expect((await getCampaign(db, id))!.status).toBe("in_progress");
    await deleteCampaign(db, actor("Mod", true), id);
    expect(await getCampaign(db, id)).toBeNull();
    const [del] = await db.select().from(auditLog).where(eq(auditLog.action, "campaign.delete"));
    expect(del.before).toMatchObject({ title: `Campaign #${id}` });
  });

  it("flags campaigns idle for 60 days as stalled and keeps them out of open lists", async () => {
    const id = await newCampaign();
    const later = new Date(Date.now() + 61 * 86_400_000);
    expect((await getCampaign(db, id, later))!.stalled).toBe(true);
    expect(await listCampaigns(db, { status: "in_progress" }, later)).toHaveLength(0);
    expect(await listCampaigns(db, { status: "stalled" }, later)).toHaveLength(1);
    expect((await homeStats(db, later)).inProgressCount).toBe(0);
  });
});
