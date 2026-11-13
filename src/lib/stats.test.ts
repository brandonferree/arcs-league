import { describe, expect, it } from "vitest";
import type { Tier } from "@/lib/rules/fates";
import {
  fateDetail,
  fateSummaries,
  leaderboard,
  pickChampion,
  playerDetail,
  playerSummaries,
  records,
  type StatEntry,
  type StatFate,
  type StatGame,
} from "./stats";
import { filterQuery, parseStatsFilters } from "./stats-filters";

const FATES: StatFate[] = [
  { id: 1, name: "Steward", tier: "A", complexity: null },
  { id: 2, name: "Founder", tier: "A", complexity: null },
  { id: 3, name: "Magnate", tier: "A", complexity: null },
  { id: 4, name: "Pirate", tier: "B", complexity: null },
  { id: 5, name: "Hegemon", tier: "B", complexity: null },
  { id: 6, name: "Judge", tier: "C", complexity: null },
  { id: 7, name: "Overlord", tier: "C", complexity: null },
];
const FATE = Object.fromEntries(FATES.map((f) => [f.name, f]));

const PLAYERS: Record<string, { id: number; guest?: boolean }> = {
  Emma: { id: 1 },
  Chris: { id: 2 },
  Mark: { id: 3 },
  Gail: { id: 4, guest: true },
};

/** [fate, score, success?, seat?] for each act. */
type A = [fate: string, score: number, success?: boolean | null, seat?: number];

function entry(name: string, won: boolean, acts: [A, A, A]): StatEntry {
  return {
    playerId: PLAYERS[name].id,
    name,
    isGuest: !!PLAYERS[name].guest,
    isWinner: won,
    acts: acts.map(([fate, score, success = null, seat = null], i) => ({
      fateId: FATE[fate].id,
      fate,
      tier: FATE[fate].tier as Tier,
      score,
      success: i === 2 ? null : success,
      seat,
    })) as StatEntry["acts"],
  };
}

let nextId = 1;
function game(playedOn: string, entries: StatEntry[]): StatGame {
  const id = nextId++;
  return { campaignId: id, title: `Campaign #${id}`, playedOn, playerCount: entries.length, seasonId: null, entries };
}

// Emma: wins 1 and 3. Chris: wins 2. Gail (guest) wins 4. Mark never wins.
const GAMES: StatGame[] = [
  game("2026-01-01", [
    entry("Emma", true, [["Steward", 5, true, 1], ["Steward", 10, true, 1], ["Steward", 60, null, 1]]),
    entry("Chris", false, [["Founder", 4, false, 2], ["Pirate", 9, true, 2], ["Judge", 40, null, 2]]),
    entry("Mark", false, [["Magnate", 6, true, 3], ["Hegemon", 8, false, 3], ["Overlord", 30, null, 3]]),
  ]),
  game("2026-02-01", [
    entry("Emma", false, [["Founder", 3, false], ["Pirate", 7, true], ["Pirate", 50]]),
    entry("Chris", true, [["Steward", 6, true], ["Hegemon", 11, true], ["Judge", 70]]),
    entry("Mark", false, [["Magnate", 4, false], ["Magnate", 0, false], ["Magnate", 20]]),
  ]),
  game("2026-03-01", [
    entry("Emma", true, [["Magnate", 5, true], ["Magnate", 12, true], ["Overlord", 80]]),
    entry("Chris", false, [["Steward", 5, true], ["Steward", 9, false], ["Judge", 45]]),
    entry("Mark", false, [["Founder", 2, false], ["Pirate", 8, true], ["Pirate", 55]]),
  ]),
  game("2026-04-01", [
    entry("Emma", false, [["Steward", 5, false], ["Pirate", 7, false], ["Judge", 30]]),
    entry("Gail", true, [["Founder", 7, true], ["Founder", 12, true], ["Founder", 90]]),
    entry("Mark", false, [["Magnate", 4, true], ["Hegemon", 9, true], ["Overlord", 40]]),
  ]),
];

describe("player summaries", () => {
  it("counts games, wins, Act III scores and finish tiers", () => {
    const emma = playerSummaries(GAMES).find((p) => p.name === "Emma")!;
    expect(emma).toMatchObject({ games: 4, wins: 2, winRate: 0.5, bestAct3: 80, lastPlayedOn: "2026-04-01" });
    expect(emma.avgAct3).toBe((60 + 50 + 80 + 30) / 4);
    expect(emma.avgAct3ExclC).toBe((60 + 50) / 2); // Overlord and Judge finishes are C
    expect(emma.finishTiers).toEqual({ A: 1, B: 1, C: 2 });
  });

  it("keeps guests out of the leaderboard and applies the minimum", () => {
    const lb = leaderboard(GAMES, 3);
    expect(lb.ranked.map((p) => p.name)).toEqual(["Emma", "Chris", "Mark"]);
    expect(lb.belowMinimum).toBe(0);
    expect(leaderboard(GAMES, 4).ranked.map((p) => p.name)).toEqual(["Emma", "Mark"]);
    expect(leaderboard(GAMES, 4).belowMinimum).toBe(1);
    expect(leaderboard(GAMES).ranked).toEqual([]); // default minimum is 5
  });
});

describe("champion", () => {
  it("is most wins, ties broken by win rate, then name", () => {
    expect(pickChampion([{ name: "A", wins: 2, games: 10 }, { name: "B", wins: 3, games: 20 }])?.name).toBe("B");
    expect(pickChampion([{ name: "A", wins: 2, games: 10 }, { name: "B", wins: 2, games: 4 }])?.name).toBe("B");
    expect(pickChampion([{ name: "B", wins: 1, games: 2 }, { name: "A", wins: 1, games: 2 }])?.name).toBe("A");
    expect(pickChampion([{ name: "A", wins: 0, games: 3 }])).toBeNull();
  });
});

describe("player detail", () => {
  it("lists games in date order with progression and a cumulative win rate", () => {
    const d = playerDetail(GAMES, PLAYERS.Emma.id)!;
    expect(d.games.map((g) => g.playedOn)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]);
    expect(d.games[0].steps).toEqual(["started", "kept", "kept"]);
    expect(d.games[1].steps).toEqual(["started", "changed-after-failure", "kept"]);
    expect(d.games[2].steps).toEqual(["started", "kept", "changed-after-success"]);
    expect(d.timeline.map((t) => t.winRate)).toEqual([1, 0.5, 2 / 3, 0.5]);
    expect(d.stepsByAct[1]).toMatchObject({ kept: 2, "changed-after-failure": 2, "changed-after-success": 0 });
    expect(d.successByAct).toEqual([
      [2, 4],
      [3, 4],
    ]);
    const pirate = d.fates.find((f) => f.fate === "Pirate")!;
    expect(pirate.plays).toEqual([0, 2, 1]);
    expect(d.fates.find((f) => f.fate === "Overlord")!.wins).toBe(1);
  });

  it("returns null for someone with no closed games", () => {
    expect(playerDetail(GAMES, 999)).toBeNull();
  });
});

describe("fate summaries", () => {
  const fs = Object.fromEntries(fateSummaries(GAMES, FATES).map((f) => [f.name, f]));

  it("counts plays and success per act", () => {
    expect(fs.Steward.plays).toEqual([4, 2, 1]);
    expect(fs.Steward.successes).toEqual([3, 1]);
    expect(fs.Steward.successRate).toEqual([3 / 4, 1 / 2]);
    expect(fs.Steward.totalPlays).toBe(7);
  });

  it("computes keep % from successful plays that had a next act", () => {
    // Steward successes: Emma g1 act I (kept) and II (kept), Chris g2 act I (changed), Chris g3 act I (kept).
    expect(fs.Steward.keepChances).toBe(4);
    expect(fs.Steward.kept).toBe(3);
    expect(fs.Steward.keepRate).toBe(0.75);
  });

  it("computes win % and averages from Act III finishes", () => {
    expect(fs.Judge).toMatchObject({ finishes: 4, wins: 1, winRate: 0.25 });
    expect(fs.Judge.avgScore[2]).toBe((40 + 70 + 45 + 30) / 4);
    expect(fs.Pirate.avgScore[1]).toBe((9 + 7 + 8 + 7) / 4);
    expect(fs.Hegemon.avgScore[2]).toBeNull();
  });

  it("counts failures in Acts I and II", () => {
    expect(fs.Magnate.failures).toBe(2);
    expect(fs.Magnate.failRate).toBe(2 / 6);
  });
});

describe("fate detail", () => {
  it("tracks what players switched to and from", () => {
    const d = fateDetail(GAMES, FATES, FATE.Pirate.id)!;
    expect(d.switchedFrom.map((s) => [s.fate, s.count])).toEqual([["Founder", 3], ["Steward", 1]]);
    expect(d.switchedTo.map((s) => [s.fate, s.count])).toEqual([["Judge", 2]]);
    expect(d.stepsByAct[1]).toMatchObject({ "changed-after-failure": 4, "changed-after-success": 0 });
    expect(d.stepsByAct[2]).toMatchObject({ kept: 2 });
    expect(d.timeline.map((t) => t.won)).toEqual([false, false]);
    expect(d.games[0].playedOn).toBe("2026-04-01"); // newest first
  });
});

describe("records", () => {
  const r = records(GAMES, FATES);

  it("names the champion from members only", () => {
    expect(r.champion).toMatchObject({ name: "Emma", wins: 2, games: 4 });
  });

  it("includes guests in the top Act III score", () => {
    expect(r.topAct3).toMatchObject({ name: "Gail", score: 90, fate: "Founder", isGuest: true });
  });

  it("finds the most improved player across halves of their games", () => {
    // Chris has 3 games (below 4). Emma: [W, L | W, L] = 0.5 -> 0.5. Mark: never wins.
    expect(r.mostImproved).toBeNull();
    const more = [...GAMES, game("2026-05-01", [entry("Mark", true, [["Steward", 9, true], ["Steward", 9, true], ["Steward", 99]]), entry("Emma", false, [["Founder", 1, false], ["Pirate", 1, false], ["Judge", 1]]), entry("Chris", false, [["Magnate", 1, false], ["Hegemon", 1, false], ["Overlord", 1]])])];
    // Mark: [L, L, (L), L, W] -> 0 then 0.5.
    expect(records(more, FATES).mostImproved).toMatchObject({ name: "Mark", firstRate: 0, secondRate: 0.5, half: 2 });
  });

  it("finds the best win rate by class with the minimum", () => {
    expect(r.classWinRate.C).toBeNull(); // nobody has 4 C finishes
    const lots = Array.from({ length: 4 }, (_, i) =>
      game(`2026-06-0${i + 1}`, [entry("Chris", i < 3, [["Steward", 5, false], ["Pirate", 5, true], ["Judge", 50]]), entry("Mark", i === 3, [["Founder", 5, true], ["Hegemon", 5, true], ["Overlord", 40]]), entry("Emma", false, [["Magnate", 5, false], ["Magnate", 5, false], ["Magnate", 1]])]),
    );
    const c = records([...GAMES, ...lots], FATES).classWinRate.C!;
    expect(c).toMatchObject({ name: "Chris", finishes: 7, wins: 4 });
  });

  it("finds most played, best A and B, and deadliest fates", () => {
    expect(r.mostPlayedFate?.name).toBe("Magnate"); // 7 plays, tied with Steward; Magnate first by name
    expect(r.bestFate.A).toBeNull(); // no A fate has 2 Act III finishes
    expect(r.bestFate.B).toMatchObject({ name: "Pirate", finishes: 2 });
    expect(r.deadliestFate).toMatchObject({ name: "Founder", failures: 3 }); // 3 of 5
  });

  it("tallies seat order against success and wins", () => {
    expect(r.seats.map((s) => s.seat)).toEqual([1, 2, 3]);
    expect(r.seats[0].byAct).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    expect(r.seats[1].byAct[0]).toEqual([0, 1]);
    expect(r.seats[2].byAct[2]).toEqual([0, 1]);
  });
});

describe("filters", () => {
  it("parses and rejects bad values", () => {
    expect(parseStatsFilters({ from: "2026-01-01", to: "nope", season: "2", players: "5" })).toEqual({
      from: "2026-01-01",
      to: null,
      seasonId: 2,
      playerCount: null,
    });
  });

  it("round-trips to a query string", () => {
    const f = parseStatsFilters({ players: "4", to: "2026-12-31" });
    expect(filterQuery(f)).toBe("?to=2026-12-31&players=4");
    expect(filterQuery(f, { min: 3 })).toBe("?to=2026-12-31&players=4&min=3");
    expect(filterQuery(parseStatsFilters({}))).toBe("");
  });
});
