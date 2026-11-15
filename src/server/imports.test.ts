/**
 * Act imports against a real (in-memory) Postgres, using the anonymised meeples
 * samples in docs/reference/meeples/.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connectPglite, type DB } from "@/db";
import { actImports, auditLog, campaigns, cardTags, cards, playerAliases, players } from "@/db/schema";
import { getCampaign, PermissionError, RuleError } from "./campaigns";
import { confirmImport, discardImport, getImport, listImports, receiveImport } from "./imports";

const sample = (f: string) =>
  JSON.parse(readFileSync(path.join(process.cwd(), "docs/reference/meeples", f), "utf8"));
const act1 = () => sample("arcs-act1.json");
const act2 = () => sample("arcs-act2.json");
const act3 = () => sample("arcs-act3-synthetic.json");

let db: DB;
let ids: Record<string, number>;
const actor = (name: string, isModerator = false) => ({ playerId: ids[name], isModerator });

beforeEach(async () => {
  db = await connectPglite();
  const rows = await db
    .insert(players)
    .values(["Ada", "Ben", "Outsider", "Mod"].map((n, i) => ({ displayName: n, discordId: `10000${i}` })))
    .returning();
  ids = Object.fromEntries(rows.map((r) => [r.displayName, r.id]));
  await db.insert(cards).values(
    [
      ["ARCS-F102", "Imperial Authority", "Guild"],
      ["ARCS-L01", "Tool Priests", "Lore"],
    ].map(([id, name, type]) => ({ id, name, type, product: "blightedreach", tags: [], source: {} })),
  );
});

/** Act I comes in, Ada confirms: Player 1 = Ada, Player 2 = Ben, the others new guests. */
async function startFromAct1() {
  const r = await receiveImport(db, act1());
  expect(r.status).toBe("pending");
  if (r.status !== "pending") throw new Error();
  const done = await confirmImport(db, actor("Ada"), r.importId, [
    { playerId: ids.Ada },
    { playerId: ids.Ben },
    { guestName: "Player 3" },
    { guestName: "Player 4" },
  ]);
  return { importId: r.importId, campaignId: done.campaignId };
}

describe("receiving", () => {
  it("rejects invalid summaries and unknown fates without storing them", async () => {
    expect(await receiveImport(db, "{")).toMatchObject({ status: "invalid" });
    const bad = act1();
    bad.players[0].fate = { name: "Space Wizard" };
    expect(await receiveImport(db, bad)).toEqual({ status: "invalid", errors: ['"Space Wizard" is not one of the 24 fates.'] });
    expect(await db.select().from(actImports)).toHaveLength(0);
  });

  it("holds an Act I with no campaign as a new campaign to confirm", async () => {
    const r = await receiveImport(db, act1());
    expect(r).toMatchObject({ status: "pending", problems: [expect.stringContaining("new campaign")] });
    const view = (await getImport(db, (r as { importId: number }).importId))!;
    expect(view.campaign).toBeNull();
    expect(view.rows.map((x) => x.name)).toEqual(["Player 1", "Player 2", "Player 3", "Player 4"]);
    expect(view.choices.map((c) => c.name)).toContain("Ada");
  });

  it("holds a later act when no campaign is linked, and saves it once Act I is confirmed", async () => {
    const r = await receiveImport(db, act2());
    expect(r).toMatchObject({ status: "pending", problems: [expect.stringContaining("No league campaign is linked")] });
    const { campaignId } = await startFromAct1();
    const [row] = await db.select().from(actImports).where(eq(actImports.id, (r as { importId: number }).importId));
    expect(row).toMatchObject({ status: "saved", campaignId });
    expect((await getCampaign(db, campaignId))!.acts.map((a) => a.actNo)).toEqual([1, 2]);
  });

  it("reports a leagueCampaign link that does not exist", async () => {
    const s = act2();
    s.leagueCampaign = "https://league.example/campaigns/999";
    expect(await receiveImport(db, s)).toMatchObject({ status: "pending", problems: ["League campaign #999 does not exist."] });
  });
});

describe("confirming and automatic saves", () => {
  it("creates the campaign from Act I, then saves Acts II and III on their own", async () => {
    const { importId, campaignId } = await startFromAct1();

    let c = (await getCampaign(db, campaignId))!;
    expect(c.players.map((p) => p.name)).toEqual(["Ada", "Ben", "Player 3", "Player 4"]);
    expect(c.acts[0].playedOn).toBe("2026-11-02");
    expect(Object.values(c.acts[0].results).map((r) => r.score)).toEqual([15, 1, 5, 2]);
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(camp).toMatchObject({ sourcePlatform: "meeples", sourceCampaignKey: "samplegame0001" });
    expect((await db.select().from(actImports).where(eq(actImports.id, importId)))[0]).toMatchObject({
      status: "saved",
      resolvedById: ids.Ada,
    });
    // Names learned, and the cards we know were tagged (as Ada).
    expect((await db.select().from(playerAliases)).map((a) => a.name).sort()).toEqual([
      "player 1",
      "player 2",
      "player 3",
      "player 4",
    ]);
    const tags = await db.select().from(cardTags);
    expect(tags.map((t) => t.cardId).sort()).toEqual(["ARCS-F102", "ARCS-L01"]);
    expect(tags.every((t) => t.taggedById === ids.Ada)).toBe(true);

    // Act II: matched by game id and aliases, saved with no one involved, negative score kept.
    const r2 = await receiveImport(db, act2());
    expect(r2).toMatchObject({ status: "saved", campaignId, actNo: 2 });
    c = (await getCampaign(db, campaignId))!;
    const a2 = c.acts.find((a) => a.actNo === 2)!;
    expect(a2.createdBy).toBeNull();
    expect(a2.results[c.players[3].cpId]).toMatchObject({ fate: "Blight Speaker", score: -5, success: false });
    const log = await db.select().from(auditLog).where(eq(auditLog.action, "act.create"));
    expect(log.map((l) => l.actorId)).toEqual([ids.Ada, null]);

    // Act III: the game's winner is kept, and the campaign closes.
    const r3 = await receiveImport(db, act3());
    expect(r3).toMatchObject({ status: "saved", actNo: 3 });
    c = (await getCampaign(db, campaignId))!;
    expect(c.status).toBe("closed");
    expect(c.players.filter((p) => p.isWinner).map((p) => p.name)).toEqual(["Ada"]);
  });

  it("accepts an identical resend and flags a different one as a conflict", async () => {
    const { campaignId } = await startFromAct1();
    const first = await receiveImport(db, act2());
    const again = await receiveImport(db, act2());
    expect(again).toEqual(first);

    const changed = act2();
    changed.players[0].score = 20;
    expect(await receiveImport(db, changed)).toMatchObject({ status: "conflict", campaignId, actNo: 2 });
    const c = (await getCampaign(db, campaignId))!;
    expect(c.acts.find((a) => a.actNo === 2)!.results[c.players[0].cpId].score).toBe(18);
    expect(await listImports(db, { status: "pending" })).toHaveLength(1);
  });

  it("holds an act that breaks the fate rules, with the rule's message", async () => {
    await startFromAct1();
    const s = act2();
    s.players[1].fate = { name: "Judge", cardId: "ARCS-FATE24" };
    const r = await receiveImport(db, s);
    expect(r.status).toBe("pending");
    expect((r as { problems: string[] }).problems.join(" ")).toContain("C fates are Act III only");
  });

  it("asks to confirm a name that only looks like a member", async () => {
    const { campaignId } = await startFromAct1();
    await db.delete(playerAliases).where(eq(playerAliases.name, "player 2"));
    const s = act2();
    s.players[1].name = "ben";
    const r = await receiveImport(db, s);
    expect(r).toMatchObject({ status: "pending", problems: ["Confirm that ben is Ben."] });
    const view = (await getImport(db, (r as { importId: number }).importId))!;
    expect(view.campaign?.id).toBe(campaignId);
    expect(view.rows[1].match).toMatchObject({ playerId: ids.Ben, via: "name" });

    // Only the campaign's players may confirm, and only with its players.
    const choices = view.rows.map((x, i) => ({ playerId: view.campaign!.players[i].playerId }));
    await expect(confirmImport(db, actor("Outsider"), view.id, choices)).rejects.toBeInstanceOf(PermissionError);
    await expect(
      confirmImport(db, actor("Ben"), view.id, [...choices.slice(0, 3), { playerId: ids.Outsider }]),
    ).rejects.toBeInstanceOf(RuleError);
    await confirmImport(db, actor("Ben"), view.id, choices);
    expect((await db.select().from(playerAliases).where(eq(playerAliases.name, "ben")))[0].playerId).toBe(ids.Ben);
  });

  it("matches by Discord id", async () => {
    const { campaignId } = await startFromAct1();
    await db.delete(playerAliases);
    const s = act2();
    s.players.forEach((p: { discordId: string | null }, i: number) => (p.discordId = i === 0 ? "100000" : null));
    const view = (await getImport(db, ((await receiveImport(db, s)) as { importId: number }).importId))!;
    expect(view.campaign?.id).toBe(campaignId);
    expect(view.rows[0].match).toMatchObject({ playerId: ids.Ada, via: "discord" });
  });
});

describe("discarding", () => {
  it("lets a member discard a new-campaign import, and only once", async () => {
    const r = (await receiveImport(db, act1())) as { importId: number };
    await discardImport(db, actor("Outsider"), r.importId);
    await expect(discardImport(db, actor("Ada"), r.importId)).rejects.toBeInstanceOf(RuleError);
    // A resend brings it back.
    expect(await receiveImport(db, act1())).toMatchObject({ status: "pending", importId: r.importId });
  });

  it("keeps outsiders from discarding a campaign's import", async () => {
    await startFromAct1();
    const s = act2();
    s.players[1].fate = { name: "Judge" };
    const r = (await receiveImport(db, s)) as { importId: number };
    await expect(discardImport(db, actor("Outsider"), r.importId)).rejects.toBeInstanceOf(PermissionError);
    await discardImport(db, actor("Mod", true), r.importId);
  });
});
