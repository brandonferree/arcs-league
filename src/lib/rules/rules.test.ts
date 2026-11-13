import { describe, expect, it } from "vitest";
import {
  FATE_SEED,
  progressionSteps,
  resolveWinners,
  tierLookupFrom,
  validateCampaign,
  validateFateRules,
  validateTableSize,
  type PlayerRecord,
} from "./index";

const p = (
  name: string,
  f: [string?, string?, string?],
  s: [boolean?, boolean?] = [true, true],
): PlayerRecord => ({
  name,
  act1: f[0] ? { fate: f[0], success: s[0] ?? null, score: 5 } : undefined,
  act2: f[1] ? { fate: f[1], success: s[1] ?? null, score: 10 } : undefined,
  act3: f[2] ? { fate: f[2], score: 60 } : undefined,
});
const codes = (players: PlayerRecord[]) => validateFateRules(players).map((e) => e.code);

describe("fate seed", () => {
  it("has 24 fates, 8 per tier, tier matching act", () => {
    expect(FATE_SEED).toHaveLength(24);
    for (const tier of ["A", "B", "C"] as const) {
      expect(FATE_SEED.filter((f) => f.tier === tier)).toHaveLength(8);
    }
    expect(FATE_SEED.every((f) => ({ A: 1, B: 2, C: 3 })[f.tier] === f.act)).toBe(true);
    expect(new Set(FATE_SEED.map((f) => f.name)).size).toBe(24);
    expect(FATE_SEED[0].cardId).toBe("ARCS-FATE01");
    expect(FATE_SEED[23].cardId).toBe("ARCS-FATE24");
  });
});

describe("rule 1: unique player names", () => {
  it("flags duplicates, ignoring case and surrounding space", () => {
    const errs = validateFateRules([p("Emma", ["Steward"]), p(" emma ", ["Founder"])]);
    expect(errs.map((e) => e.code)).toEqual(["duplicate-player"]);
  });
});

describe("rule 2: Act I must be tier A", () => {
  it.each(["Pathfinder", "Overlord"])("rejects %s in Act I", (fate) => {
    expect(codes([p("Emma", [fate])])).toContain("act1-not-a");
  });
});

describe("rule 3: Act II cannot be tier C", () => {
  it("rejects a C fate in Act II", () => {
    expect(codes([p("Emma", ["Steward", "Judge"])])).toContain("act2-c-fate");
  });
  it("allows a B fate in Act II", () => {
    expect(codes([p("Emma", ["Steward", "Pirate"])])).toEqual([]);
  });
});

describe("rule 4: A fates after Act I only as continuation", () => {
  it("rejects switching to a different A fate in Act II", () => {
    expect(codes([p("Emma", ["Steward", "Founder"])])).toContain("a-fate-not-continued");
  });
  it("rejects an A fate in Act III that was not Act II's fate", () => {
    expect(codes([p("Emma", ["Steward", "Pirate", "Founder"])])).toContain("a-fate-not-continued");
  });
  it("allows an A fate kept through all three acts", () => {
    expect(codes([p("Emma", ["Steward", "Steward", "Steward"])])).toEqual([]);
  });
});

describe("rule 5: continue only after success", () => {
  it("rejects keeping a B fate into Act III after failing it", () => {
    expect(codes([p("Emma", ["Steward", "Pirate", "Pirate"], [true, false])])).toContain(
      "continued-after-failure",
    );
  });
  it("treats an unset success flag as not succeeded", () => {
    expect(codes([p("Emma", ["Steward", "Steward"], [undefined])])).toContain("continued-after-failure");
  });
});

describe("rule 6: dropped fates cannot be picked up again", () => {
  it("rejects returning to the Act I fate in Act III", () => {
    expect(codes([p("Emma", ["Steward", "Pirate", "Steward"])])).toContain("returned-to-dropped");
  });
});

describe("rule 7: a fate belongs to one player", () => {
  it("rejects two players taking the same fate in different acts", () => {
    expect(codes([p("Emma", ["Steward", "Pirate"]), p("Chris", ["Founder", "Pirate"])])).toContain(
      "fate-shared",
    );
  });
  it("names every player involved", () => {
    const err = validateFateRules([p("Emma", ["Steward"]), p("Chris", ["Steward"])]).find(
      (e) => e.code === "fate-shared",
    );
    expect(err?.players).toEqual(["Chris", "Emma"]);
  });
});

describe("rule 8: 3 or 4 players", () => {
  it.each([0, 1, 2, 5, 6])("rejects %i players", (n) => {
    expect(validateTableSize(n).map((e) => e.code)).toEqual(["table-size"]);
  });
  it.each([3, 4])("accepts %i players", (n) => {
    expect(validateTableSize(n)).toEqual([]);
  });
  it("is part of the full campaign check", () => {
    const two = [p("Emma", ["Steward"]), p("Chris", ["Founder"])];
    expect(validateCampaign(two).map((e) => e.code)).toEqual(["table-size"]);
    const three = [...two, p("Mark", ["Magnate"])];
    expect(validateCampaign(three)).toEqual([]);
  });
});

describe("partial campaigns (live, act-by-act validation)", () => {
  it("checks Act I alone", () => {
    const players = [p("Emma", ["Steward"]), p("Chris", ["Founder"]), p("Mark", ["Pirate"])];
    expect(validateCampaign(players).map((e) => e.code)).toEqual(["act1-not-a"]);
  });
  it("skips fates not chosen yet", () => {
    const players = [p("Emma", ["Steward", undefined]), p("Chris", [undefined]), p("Mark", ["Magnate"])];
    expect(validateCampaign(players)).toEqual([]);
  });
  it("attaches violations to the act that caused them", () => {
    const errs = validateFateRules([p("Emma", ["Steward", "Steward"], [false])]);
    expect(errs[0]).toMatchObject({ act: 2, players: ["Emma"], fate: "Steward" });
  });
});

describe("unknown fates and custom fate tables", () => {
  it("reports a fate not in the table", () => {
    expect(codes([p("Emma", ["Stewart"])])).toEqual(["unknown-fate"]);
  });
  it("uses the supplied tier lookup (fates come from the database)", () => {
    const tierOf = tierLookupFrom([{ name: "Steward", tier: "B" }]);
    expect(validateFateRules([p("Emma", ["Steward"])], tierOf).map((e) => e.code)).toEqual(["act1-not-a"]);
  });
});

describe("explicit winner", () => {
  const scores = [
    { name: "Emma", score: 72 },
    { name: "Chris", score: 58 },
    { name: "Mark", score: 64 },
  ];

  it("defaults to the highest Act III score", () => {
    expect(resolveWinners(scores)).toEqual({ winners: ["Emma"], overridden: false, reason: null, errors: [] });
  });

  it("choosing the default is not an override and needs no reason", () => {
    const d = resolveWinners(scores, ["Emma"], "");
    expect(d).toMatchObject({ overridden: false, errors: [], reason: null });
  });

  it("allows an override with a reason", () => {
    const d = resolveWinners(scores, ["Chris"], "Judge objective met");
    expect(d).toEqual({ winners: ["Chris"], overridden: true, reason: "Judge objective met", errors: [] });
  });

  it("requires a reason for an override", () => {
    expect(resolveWinners(scores, ["Chris"], "  ").errors).toEqual([
      "Give a reason when the winner is not the highest Act III score.",
    ]);
  });

  it("rejects an empty winner list and non-players", () => {
    expect(resolveWinners(scores, [], "x").errors).toContain("Choose at least one winner.");
    expect(resolveWinners(scores, ["Zed"], "x").errors).toContain("Zed is not a player in this campaign.");
  });

  it("treats a tie as shared by default, and narrowing a tie as an override", () => {
    const tied = [{ name: "A", score: 70 }, { name: "B", score: 70 }, { name: "C", score: 1 }];
    expect(resolveWinners(tied).winners).toEqual(["A", "B"]);
    expect(resolveWinners(tied, ["A"], null).errors).toHaveLength(1);
  });
});

describe("progression key", () => {
  it("classifies each act against the previous one", () => {
    expect(
      progressionSteps([
        { fate: "Steward", success: true },
        { fate: "Steward", success: true },
        { fate: "Overlord" },
      ]),
    ).toEqual(["started", "kept", "changed-after-success"]);
    expect(
      progressionSteps([{ fate: "Steward", success: false }, { fate: "Pirate", success: true }]),
    ).toEqual(["started", "changed-after-failure"]);
  });
  it("stops at the first act not yet played", () => {
    expect(progressionSteps([{ fate: "Steward" }, null, { fate: "Judge" }])).toEqual(["started"]);
  });
});
