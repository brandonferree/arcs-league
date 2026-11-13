import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connectPglite, type DB } from "@/db";
import { auditLog, campaigns, fates, players } from "@/db/schema";
import { createCampaign, getCampaign, PermissionError, RuleError, saveAct } from "./campaigns";
import { createSeason, deleteSeason, listSeasonsWithCounts, tagCampaignsBySeasonDates, updateSeason } from "./seasons";

let db: DB;
let ids: Record<string, number>;
let fateId: Record<string, number>;
const mod = () => ({ playerId: ids.Mod, isModerator: true });
const member = () => ({ playerId: ids.Emma, isModerator: false });

beforeEach(async () => {
  db = await connectPglite();
  fateId = Object.fromEntries((await db.select().from(fates)).map((f) => [f.name, f.id]));
  const rows = await db
    .insert(players)
    .values(["Emma", "Chris", "Mark", "Mod"].map((n, i) => ({ displayName: n, discordId: `d${i}` })))
    .returning();
  ids = Object.fromEntries(rows.map((r) => [r.displayName, r.id]));
});

async function errorOf(p: Promise<unknown>) {
  return p.then(() => null, (e) => e);
}

/** A campaign with Act I played on the given date. */
async function campaignOn(date: string, seasonId: number | null = null) {
  const id = await createCampaign(db, member(), {
    seasonId,
    players: [{ playerId: ids.Emma }, { playerId: ids.Chris }, { playerId: ids.Mark }],
  });
  const c = (await getCampaign(db, id))!;
  await saveAct(db, member(), id, 1, {
    playedOn: date,
    results: c.players.map((p, i) => ({
      campaignPlayerId: p.cpId,
      fateId: fateId[["Steward", "Founder", "Magnate"][i]],
      score: 5,
      success: true,
    })),
  });
  return id;
}

describe("seasons", () => {
  it("only moderators can manage seasons", async () => {
    expect(await errorOf(createSeason(db, member(), { name: "Season 1" }))).toBeInstanceOf(PermissionError);
  });

  it("creates, lists, renames and audits", async () => {
    const id = await createSeason(db, mod(), { name: " Season 1 ", startsOn: "2026-01-01", endsOn: "" });
    await updateSeason(db, mod(), id, { name: "Spring", startsOn: "2026-01-01", endsOn: "2026-03-31" });
    expect(await listSeasonsWithCounts(db)).toEqual([
      { id, name: "Spring", startsOn: "2026-01-01", endsOn: "2026-03-31", campaignCount: 0 },
    ]);
    const log = await db.select().from(auditLog).where(eq(auditLog.entityType, "season"));
    expect(log.map((l) => l.action)).toEqual(["season.create", "season.update"]);
  });

  it("rejects a blank name, duplicate names and backwards dates", async () => {
    await createSeason(db, mod(), { name: "Spring" });
    const dup = await errorOf(createSeason(db, mod(), { name: "spring" }));
    expect(dup).toBeInstanceOf(RuleError);
    expect((dup as RuleError).errors[0]).toContain("already a season");
    expect(await errorOf(createSeason(db, mod(), { name: "  " }))).toBeInstanceOf(RuleError);
    const back = await errorOf(createSeason(db, mod(), { name: "X", startsOn: "2026-05-01", endsOn: "2026-04-01" }));
    expect((back as RuleError).errors[0]).toContain("end on or after");
  });

  it("tags untagged campaigns whose Act I falls in the season", async () => {
    const other = await createSeason(db, mod(), { name: "Other" });
    const spring = await createSeason(db, mod(), { name: "Spring", startsOn: "2026-03-01", endsOn: "2026-05-31" });
    const inside = await campaignOn("2026-03-01");
    const edge = await campaignOn("2026-05-31");
    const outside = await campaignOn("2026-06-01");
    const alreadyTagged = await campaignOn("2026-04-01", other);
    await createCampaign(db, member(), { players: [{ playerId: ids.Emma }, { playerId: ids.Chris }, { playerId: ids.Mark }] }); // no acts

    expect(await tagCampaignsBySeasonDates(db, mod(), spring)).toBe(2);
    const season = async (id: number) => (await db.select().from(campaigns).where(eq(campaigns.id, id)))[0].seasonId;
    expect(await season(inside)).toBe(spring);
    expect(await season(edge)).toBe(spring);
    expect(await season(outside)).toBeNull();
    expect(await season(alreadyTagged)).toBe(other);
    expect(await tagCampaignsBySeasonDates(db, mod(), spring)).toBe(0);
    expect((await listSeasonsWithCounts(db)).find((s) => s.id === spring)?.campaignCount).toBe(2);
  });

  it("needs both dates to tag", async () => {
    const id = await createSeason(db, mod(), { name: "Open", startsOn: "2026-01-01" });
    expect(await errorOf(tagCampaignsBySeasonDates(db, mod(), id))).toBeInstanceOf(RuleError);
  });

  it("deleting a season untags its campaigns but keeps them", async () => {
    const id = await createSeason(db, mod(), { name: "Spring" });
    const c = await campaignOn("2026-03-01", id);
    await deleteSeason(db, mod(), id);
    expect(await listSeasonsWithCounts(db)).toEqual([]);
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, c));
    expect(row.seasonId).toBeNull();
  });
});
