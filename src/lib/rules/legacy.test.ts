/**
 * Port of every test in docs/reference/legacy-rules/test_domain.py.
 * These are the acceptance criteria for rules 1-7, so they call the fate-rule
 * validator directly (the legacy validator had no table-size rule, and its
 * examples use two players).
 */
import { describe, expect, it } from "vitest";
import { campaignWinners, validateFateRules, type PlayerRecord } from "./index";

function player(
  name: string, f1: string, f2: string, f3: string,
  { s1 = true, s2 = true, sc = [5, 10, 70] as [number, number, number] } = {},
): PlayerRecord & { act3: { fate: string; score: number } } {
  return {
    name,
    act1: { fate: f1, success: s1, score: sc[0] },
    act2: { fate: f2, success: s2, score: sc[1] },
    act3: { fate: f3, score: sc[2] },
  };
}

const messages = (players: PlayerRecord[]) => validateFateRules(players).map((e) => e.message);
const winnersOf = (players: ReturnType<typeof player>[]) =>
  campaignWinners(players.map((p) => ({ name: p.name, score: p.act3.score })));

describe("legacy domain tests", () => {
  it("valid campaign has no errors", () => {
    const players = [
      player("Brandon", "Steward", "Steward", "Steward"), // A continued
      player("Mark", "Founder", "Pathfinder", "Overlord"), // A -> B -> C
    ];
    expect(validateFateRules(players)).toEqual([]);
  });

  it("Act I must be an A fate", () => {
    const errs = messages([player("Brandon", "Pathfinder", "Pathfinder", "Overlord")]);
    expect(errs.some((e) => e.includes("Act I fate"))).toBe(true);
  });

  it("cannot continue after failure", () => {
    const errs = messages([player("Brandon", "Steward", "Steward", "Magnate", { s1: false })]);
    expect(errs.some((e) => e.includes("can only be continued after a success"))).toBe(true);
  });

  it("fate cannot be shared", () => {
    const errs = messages([
      player("Brandon", "Steward", "Steward", "Steward"),
      player("Mark", "Steward", "Founder", "Overlord"),
    ]);
    expect(errs.some((e) => e.includes("can belong to only one player"))).toBe(true);
  });

  it("winner is highest Act III", () => {
    const players = [
      player("Brandon", "Steward", "Steward", "Steward", { sc: [5, 10, 60] }),
      player("Mark", "Founder", "Pathfinder", "Overlord", { sc: [5, 10, 80] }),
    ];
    expect(winnersOf(players)).toEqual(["Mark"]);
  });

  it("ties share the win", () => {
    const players = [
      player("Brandon", "Steward", "Steward", "Steward", { sc: [5, 10, 70] }),
      player("Mark", "Founder", "Pathfinder", "Overlord", { sc: [5, 10, 70] }),
    ];
    expect(new Set(winnersOf(players))).toEqual(new Set(["Brandon", "Mark"]));
  });
});
