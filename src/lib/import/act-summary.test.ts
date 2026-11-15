import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  campaignKeyOf,
  findFate,
  gameWinners,
  leagueCampaignId,
  matchTableau,
  parseActSummary,
  type ActSummary,
} from "./act-summary";

const sample = (f: string) =>
  readFileSync(path.join(process.cwd(), "docs/reference/meeples", f), "utf8");

function ok(text: string): ActSummary {
  const r = parseActSummary(text);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.summary;
}

describe("parseActSummary", () => {
  it("accepts the three meeples samples, extras and favors included", () => {
    const a1 = ok(sample("arcs-act1.json"));
    const a2 = ok(sample("arcs-act2.json"));
    const a3 = ok(sample("arcs-act3-synthetic.json"));
    expect([a1.act, a2.act, a3.act]).toEqual([1, 2, 3]);
    expect(a1.players).toHaveLength(4);
    expect(a2.players.find((p) => p.name === "Player 4")!.score).toBe(-5);
    expect(a2.players[0].favors).toEqual({ Yellow: 1 });
    // Unknown fields are kept, not stripped.
    expect((a1.players[0] as Record<string, unknown>).powerBeforePenalty).toBe(29);
  });

  it("rejects other JSON with readable errors", () => {
    expect(parseActSummary("not json")).toEqual({ ok: false, errors: ["The summary is not valid JSON."] });
    const r = parseActSummary({ format: "something-else", version: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toContain("format must be");
  });

  it("requires 3-4 players, unique names, success in Acts I-II and a meeples game id", () => {
    const base = JSON.parse(sample("arcs-act1.json"));
    const bad = (mut: (s: typeof base) => void) => {
      const s = structuredClone(base);
      mut(s);
      const r = parseActSummary(s);
      return r.ok ? "" : r.errors.join("\n");
    };
    expect(bad((s) => s.players.splice(0, 2))).toContain("3 or 4 players");
    expect(bad((s) => (s.players[1].name = s.players[0].name.toUpperCase()))).toContain("unique");
    expect(bad((s) => delete s.players[0].success)).toContain("success is required");
    expect(bad((s) => delete s.source.gameId)).toContain("gameId is required");
    expect(bad((s) => (s.players[0].score = 1.5))).toContain("whole number");
    expect(parseActSummary("x".repeat(70_000))).toEqual({ ok: false, errors: ["The summary is larger than 64 KB."] });
  });
});

describe("helpers", () => {
  it("campaign key prefers campaignGameId", () => {
    const s = ok(sample("arcs-act2.json"));
    expect(campaignKeyOf(s)).toBe("samplegame0001");
    expect(campaignKeyOf({ ...s, source: { ...s.source, campaignGameId: "first" } })).toBe("first");
  });

  it("reads a league campaign id from a number, a string or a link", () => {
    expect(leagueCampaignId(42)).toBe(42);
    expect(leagueCampaignId("42")).toBe(42);
    expect(leagueCampaignId("https://league.example/campaigns/42")).toBe(42);
    expect(leagueCampaignId("https://league.example/campaigns/42/act/2?x=1")).toBe(42);
    expect(leagueCampaignId("https://league.example/players/42")).toBeNull();
    expect(leagueCampaignId("")).toBeNull();
    expect(leagueCampaignId(null)).toBeNull();
  });

  it("finds fates by card id, then by name", () => {
    const fates = [
      { id: 1, name: "Steward", cardId: "ARCS-FATE01" },
      { id: 12, name: "Planet Breaker", cardId: null },
    ];
    expect(findFate(fates, { name: "Wrong name", cardId: "arcs-fate01" })?.id).toBe(1);
    expect(findFate(fates, { name: "planet  breaker" })?.id).toBe(12);
    expect(findFate(fates, { name: "Nobody" })).toBeNull();
  });

  it("matches tableau cards by id, then by a unique name", () => {
    const cards = [
      { id: "ARCS-L01", name: "Tool Priests" },
      { id: "ARCS-F102", name: "Imperial Authority" },
      { id: "ARCS-CC01", name: "Mining Interest" },
      { id: "ARCS-CC01B", name: "Mining Interest" },
    ];
    expect(
      matchTableau(cards, [
        { cardId: "ARCS-L01", name: "Tool Priests" },
        { cardId: null, name: "imperial authority" },
        { cardId: "ARCS-NOPE", name: "Mining Interest" },
        { cardId: "ARCS-L01", name: "dupe" },
      ]),
    ).toEqual({ cardIds: ["ARCS-L01", "ARCS-F102"], unmatched: ["Mining Interest"] });
  });

  it("takes Act III winners from true flags only", () => {
    const s3 = ok(sample("arcs-act3-synthetic.json"));
    expect(gameWinners(s3)).toEqual(["Player 1"]);
    expect(gameWinners(ok(sample("arcs-act2.json")))).toBeNull();
    expect(gameWinners({ ...s3, players: s3.players.map((p) => ({ ...p, winner: null })) })).toBeNull();
  });
});
