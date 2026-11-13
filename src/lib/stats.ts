/**
 * League statistics (spec section 6, "Statistics").
 *
 * Pure functions over closed campaigns loaded by `src/server/stats.ts`, so every
 * definition here is unit-tested without a database. Only closed campaigns are
 * ever passed in: in-progress, stalled and void campaigns never count.
 *
 * Definitions:
 *  - A player's "games" are closed campaigns they sat in; "wins" use the explicit
 *    winner flag, never scores (C fates can win on objectives).
 *  - "Act III finish" is the fate a player held in Act III; its tier is the
 *    player's "class" for that game.
 *  - Fate success % is per act (I and II); Act III success is winning, so a
 *    fate's win % is wins / Act III finishes on that fate.
 *  - Keep % = of successful Act I / II plays, how often the player kept the fate
 *    into the next act.
 *  - Plays count act appearances: a fate kept for three acts is three plays.
 *  - Guests never rank (leaderboard, champion, per-player awards) but their plays
 *    count towards fate statistics and single-game records.
 */
import type { Tier } from "@/lib/rules/fates";
import { progressionSteps, type ProgressionStep } from "@/lib/rules/progression";

// Thresholds are guesses to revisit once real games exist (spec section 11).
export const LEADERBOARD_MIN_GAMES = 5;
export const MOST_IMPROVED_MIN_GAMES = 4;
export const CLASS_WIN_RATE_MIN_GAMES = 4;
export const BEST_FATE_MIN_PLAYS = 2;
export const DEADLIEST_FATE_MIN_PLAYS = 4;

export const TIERS: readonly Tier[] = ["A", "B", "C"];
export const ACT_INDEXES = [0, 1, 2] as const;

export interface StatAct {
  fateId: number;
  fate: string;
  tier: Tier;
  score: number;
  /** Acts I and II only; null in Act III. */
  success: boolean | null;
  seat: number | null;
}

export interface StatEntry {
  playerId: number;
  name: string;
  isGuest: boolean;
  isWinner: boolean;
  /** Acts I, II and III; null only if an act row is somehow missing. */
  acts: [StatAct | null, StatAct | null, StatAct | null];
}

export interface StatGame {
  campaignId: number;
  title: string;
  /** Date Act III was played: the campaign's date for filters and timelines. */
  playedOn: string;
  playerCount: number;
  seasonId: number | null;
  entries: StatEntry[];
}

export interface StatFate {
  id: number;
  name: string;
  tier: Tier;
  complexity: number | null;
}

/** n / d, or null when there is nothing to divide. */
export function rate(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function byDate(a: StatGame, b: StatGame) {
  return a.playedOn.localeCompare(b.playedOn) || a.campaignId - b.campaignId;
}

export function entrySteps(e: StatEntry): ProgressionStep[] {
  return progressionSteps(e.acts.map((a) => (a ? { fate: a.fate, success: a.success } : null)));
}

// ---------------------------------------------------------------------------
// Players

export interface PlayerSummary {
  playerId: number;
  name: string;
  isGuest: boolean;
  games: number;
  wins: number;
  winRate: number | null;
  avgAct3: number | null;
  bestAct3: number | null;
  /** Average Act III score over finishes on A or B fates. */
  avgAct3ExclC: number | null;
  /** Act III finishes by tier (counts; divide by `games` for the share). */
  finishTiers: Record<Tier, number>;
  lastPlayedOn: string | null;
}

export function playerSummaries(games: StatGame[]): PlayerSummary[] {
  const map = new Map<number, PlayerSummary & { act3: number[]; act3AB: number[] }>();
  for (const g of [...games].sort(byDate)) {
    for (const e of g.entries) {
      let s = map.get(e.playerId);
      if (!s) {
        s = {
          playerId: e.playerId,
          name: e.name,
          isGuest: e.isGuest,
          games: 0,
          wins: 0,
          winRate: null,
          avgAct3: null,
          bestAct3: null,
          avgAct3ExclC: null,
          finishTiers: { A: 0, B: 0, C: 0 },
          lastPlayedOn: null,
          act3: [],
          act3AB: [],
        };
        map.set(e.playerId, s);
      }
      s.games++;
      if (e.isWinner) s.wins++;
      s.lastPlayedOn = g.playedOn;
      const a3 = e.acts[2];
      if (a3) {
        s.act3.push(a3.score);
        if (a3.tier !== "C") s.act3AB.push(a3.score);
        s.finishTiers[a3.tier]++;
      }
    }
  }
  return [...map.values()].map(({ act3, act3AB, ...s }) => ({
    ...s,
    winRate: rate(s.wins, s.games),
    avgAct3: mean(act3),
    bestAct3: act3.length ? Math.max(...act3) : null,
    avgAct3ExclC: mean(act3AB),
  }));
}

/** Members ranked by win rate, then wins, then games played. Guests never rank. */
export function leaderboard(games: StatGame[], minGames = LEADERBOARD_MIN_GAMES) {
  const members = playerSummaries(games).filter((p) => !p.isGuest);
  const ranked = members
    .filter((p) => p.games >= minGames)
    .sort(
      (a, b) =>
        (b.winRate ?? 0) - (a.winRate ?? 0) || b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name),
    );
  return { ranked, belowMinimum: members.length - ranked.length };
}

export interface Standing {
  name: string;
  wins: number;
  games: number;
}

/**
 * Reigning champion (owner decision, 2026-11-13): most wins, ties broken by win
 * rate, then name. Pass members only. Null until someone has won.
 */
export function pickChampion<T extends Standing>(standings: T[]): T | null {
  const sorted = [...standings].sort(
    (a, b) => b.wins - a.wins || b.wins / b.games - a.wins / a.games || a.name.localeCompare(b.name),
  );
  return sorted[0] && sorted[0].wins > 0 ? sorted[0] : null;
}

export interface TimelinePoint {
  campaignId: number;
  title: string;
  playedOn: string;
  won: boolean;
  /** Games so far, including this one. */
  n: number;
  /** Win rate over all games so far. */
  winRate: number;
}

function timeline(items: { campaignId: number; title: string; playedOn: string; won: boolean }[]): TimelinePoint[] {
  let wins = 0;
  return items.map((it, i) => {
    if (it.won) wins++;
    return { ...it, n: i + 1, winRate: wins / (i + 1) };
  });
}

/** How players reached each act: counts per progression step, for Acts I-III. */
export type StepCounts = Record<ProgressionStep, number>;
const emptySteps = (): StepCounts => ({
  started: 0,
  kept: 0,
  "changed-after-success": 0,
  "changed-after-failure": 0,
});

export interface PlayerGame {
  campaignId: number;
  title: string;
  playedOn: string;
  playerCount: number;
  won: boolean;
  path: { fate: string; tier: Tier; score: number; success: boolean | null }[];
  steps: ProgressionStep[];
  act3Score: number | null;
}

export interface PlayerFateUse {
  fateId: number;
  fate: string;
  tier: Tier;
  /** Plays in Acts I, II, III. */
  plays: [number, number, number];
  /** Act III finishes on this fate that won. */
  wins: number;
}

export interface PlayerDetail {
  summary: PlayerSummary;
  games: PlayerGame[];
  timeline: TimelinePoint[];
  /** Index 0..2 = Act I..III. */
  stepsByAct: [StepCounts, StepCounts, StepCounts];
  /** Success in Acts I and II: [successes, plays]. */
  successByAct: [[number, number], [number, number]];
  fates: PlayerFateUse[];
}

export function playerDetail(games: StatGame[], playerId: number): PlayerDetail | null {
  const summary = playerSummaries(games).find((p) => p.playerId === playerId);
  if (!summary) return null;
  const mine = [...games]
    .sort(byDate)
    .flatMap((g) => g.entries.filter((e) => e.playerId === playerId).map((e) => ({ g, e })));

  const stepsByAct: PlayerDetail["stepsByAct"] = [emptySteps(), emptySteps(), emptySteps()];
  const successByAct: PlayerDetail["successByAct"] = [
    [0, 0],
    [0, 0],
  ];
  const fateUse = new Map<number, PlayerFateUse>();

  const list: PlayerGame[] = mine.map(({ g, e }) => {
    const steps = entrySteps(e);
    steps.forEach((s, i) => stepsByAct[i][s]++);
    e.acts.forEach((a, i) => {
      if (!a) return;
      if (i < 2 && a.success !== null) {
        successByAct[i][1]++;
        if (a.success) successByAct[i][0]++;
      }
      let u = fateUse.get(a.fateId);
      if (!u) {
        u = { fateId: a.fateId, fate: a.fate, tier: a.tier, plays: [0, 0, 0], wins: 0 };
        fateUse.set(a.fateId, u);
      }
      u.plays[i]++;
      if (i === 2 && e.isWinner) u.wins++;
    });
    return {
      campaignId: g.campaignId,
      title: g.title,
      playedOn: g.playedOn,
      playerCount: g.playerCount,
      won: e.isWinner,
      path: e.acts.flatMap((a) => (a ? [{ fate: a.fate, tier: a.tier, score: a.score, success: a.success }] : [])),
      steps,
      act3Score: e.acts[2]?.score ?? null,
    };
  });

  return {
    summary,
    games: list,
    timeline: timeline(list.map((x) => ({ campaignId: x.campaignId, title: x.title, playedOn: x.playedOn, won: x.won }))),
    stepsByAct,
    successByAct,
    fates: [...fateUse.values()].sort(
      (a, b) => b.plays.reduce((x, y) => x + y) - a.plays.reduce((x, y) => x + y) || a.fate.localeCompare(b.fate),
    ),
  };
}

// ---------------------------------------------------------------------------
// Fates

export interface FateSummary extends StatFate {
  /** Plays in Acts I, II, III. */
  plays: [number, number, number];
  totalPlays: number;
  /** Successes in Acts I and II. */
  successes: [number, number];
  successRate: [number | null, number | null];
  /** Failed Act I / II plays. */
  failures: number;
  failRate: number | null;
  /** Successful Act I / II plays followed by another act. */
  keepChances: number;
  kept: number;
  keepRate: number | null;
  /** Act III finishes on this fate, and how many won. */
  finishes: number;
  wins: number;
  winRate: number | null;
  /** Average score in Acts I, II, III. */
  avgScore: [number | null, number | null, number | null];
}

export function fateSummaries(games: StatGame[], fates: StatFate[]): FateSummary[] {
  const acc = new Map(
    fates.map((f) => [
      f.id,
      {
        plays: [0, 0, 0] as [number, number, number],
        successes: [0, 0] as [number, number],
        judged: [0, 0] as [number, number],
        keepChances: 0,
        kept: 0,
        wins: 0,
        scores: [[], [], []] as [number[], number[], number[]],
      },
    ]),
  );
  for (const g of games) {
    for (const e of g.entries) {
      e.acts.forEach((a, i) => {
        const f = a && acc.get(a.fateId);
        if (!a || !f) return;
        f.plays[i]++;
        f.scores[i].push(a.score);
        if (i < 2 && a.success !== null) {
          f.judged[i]++;
          if (a.success) {
            f.successes[i]++;
            const next = e.acts[i + 1];
            if (next) {
              f.keepChances++;
              if (next.fateId === a.fateId) f.kept++;
            }
          }
        }
        if (i === 2 && e.isWinner) f.wins++;
      });
    }
  }
  return fates.map((fate) => {
    const f = acc.get(fate.id)!;
    const judged = f.judged[0] + f.judged[1];
    const succeeded = f.successes[0] + f.successes[1];
    return {
      ...fate,
      plays: f.plays,
      totalPlays: f.plays[0] + f.plays[1] + f.plays[2],
      successes: f.successes,
      successRate: [rate(f.successes[0], f.judged[0]), rate(f.successes[1], f.judged[1])],
      failures: judged - succeeded,
      failRate: rate(judged - succeeded, judged),
      keepChances: f.keepChances,
      kept: f.kept,
      keepRate: rate(f.kept, f.keepChances),
      finishes: f.plays[2],
      wins: f.wins,
      winRate: rate(f.wins, f.plays[2]),
      avgScore: [mean(f.scores[0]), mean(f.scores[1]), mean(f.scores[2])],
    };
  });
}

export interface FateSwitch {
  fateId: number;
  fate: string;
  tier: Tier;
  count: number;
}

export interface FateGame {
  campaignId: number;
  title: string;
  playedOn: string;
  player: string;
  playerId: number;
  isGuest: boolean;
  /** Acts (1-3) this player held the fate in. */
  actsHeld: number[];
  won: boolean;
  path: { fate: string; tier: Tier }[];
}

export interface FateDetail {
  summary: FateSummary;
  /** How players arrived at this fate in each act (index 0..2 = Act I..III). */
  stepsByAct: [StepCounts, StepCounts, StepCounts];
  /** Fates players moved to after holding this one. */
  switchedTo: FateSwitch[];
  /** Fates players held just before moving to this one. */
  switchedFrom: FateSwitch[];
  /** Act III finishes on this fate, in date order. */
  timeline: TimelinePoint[];
  games: FateGame[];
}

function tally(m: Map<number, FateSwitch>, a: StatAct) {
  const cur = m.get(a.fateId);
  if (cur) cur.count++;
  else m.set(a.fateId, { fateId: a.fateId, fate: a.fate, tier: a.tier, count: 1 });
}

export function fateDetail(games: StatGame[], fates: StatFate[], fateId: number): FateDetail | null {
  const summary = fateSummaries(games, fates).find((f) => f.id === fateId);
  if (!summary) return null;
  const stepsByAct: FateDetail["stepsByAct"] = [emptySteps(), emptySteps(), emptySteps()];
  const to = new Map<number, FateSwitch>();
  const from = new Map<number, FateSwitch>();
  const finishes: { campaignId: number; title: string; playedOn: string; won: boolean }[] = [];
  const list: FateGame[] = [];

  for (const g of [...games].sort(byDate)) {
    for (const e of g.entries) {
      const held = e.acts.flatMap((a, i) => (a?.fateId === fateId ? [i + 1] : []));
      if (!held.length) continue;
      const steps = entrySteps(e);
      for (const act of held) {
        const i = act - 1;
        if (steps[i]) stepsByAct[i][steps[i]]++;
        const prev = i > 0 ? e.acts[i - 1] : null;
        if (prev && prev.fateId !== fateId) tally(from, prev);
        const next = i < 2 ? e.acts[i + 1] : null;
        if (next && next.fateId !== fateId) tally(to, next);
      }
      if (held.includes(3)) finishes.push({ campaignId: g.campaignId, title: g.title, playedOn: g.playedOn, won: e.isWinner });
      list.push({
        campaignId: g.campaignId,
        title: g.title,
        playedOn: g.playedOn,
        player: e.name,
        playerId: e.playerId,
        isGuest: e.isGuest,
        actsHeld: held,
        won: e.isWinner,
        path: e.acts.flatMap((a) => (a ? [{ fate: a.fate, tier: a.tier }] : [])),
      });
    }
  }
  const sortSwitches = (m: Map<number, FateSwitch>) =>
    [...m.values()].sort((a, b) => b.count - a.count || a.fate.localeCompare(b.fate));
  return {
    summary,
    stepsByAct,
    switchedTo: sortSwitches(to),
    switchedFrom: sortSwitches(from),
    timeline: timeline(finishes),
    games: list.reverse(),
  };
}

// ---------------------------------------------------------------------------
// Records

export interface PlayerAward {
  playerId: number;
  name: string;
}

export interface Records {
  champion: (PlayerAward & { wins: number; games: number }) | null;
  topAct3: (PlayerAward & { score: number; fate: string; tier: Tier; campaignId: number; title: string; playedOn: string; isGuest: boolean }) | null;
  mostImproved: (PlayerAward & { games: number; firstRate: number; secondRate: number; half: number }) | null;
  classWinRate: Record<Tier, (PlayerAward & { finishes: number; wins: number; winRate: number }) | null>;
  mostPlayedFate: FateSummary | null;
  bestFate: Record<"A" | "B", FateSummary | null>;
  deadliestFate: FateSummary | null;
  seats: SeatRow[];
}

export interface SeatRow {
  seat: number;
  /** [successes, plays] in Acts I and II; [wins, finishes] in Act III. */
  byAct: [[number, number], [number, number], [number, number]];
}

function best<T>(xs: T[], cmp: (a: T, b: T) => number): T | null {
  return xs.length ? [...xs].sort(cmp)[0] : null;
}

export function records(games: StatGame[], fates: StatFate[]): Records {
  const members = playerSummaries(games).filter((p) => !p.isGuest);

  const champion = pickChampion(members);

  let topAct3: Records["topAct3"] = null;
  for (const g of [...games].sort(byDate)) {
    for (const e of g.entries) {
      const a3 = e.acts[2];
      if (a3 && (!topAct3 || a3.score > topAct3.score)) {
        topAct3 = {
          playerId: e.playerId,
          name: e.name,
          isGuest: e.isGuest,
          score: a3.score,
          fate: a3.fate,
          tier: a3.tier,
          campaignId: g.campaignId,
          title: g.title,
          playedOn: g.playedOn,
        };
      }
    }
  }

  // Most improved: win rate in the later half of a player's games minus the
  // earlier half (the middle game is left out when the count is odd).
  const improved = members
    .filter((p) => p.games >= MOST_IMPROVED_MIN_GAMES)
    .map((p) => {
      const results = [...games]
        .sort(byDate)
        .flatMap((g) => g.entries.filter((e) => e.playerId === p.playerId).map((e) => e.isWinner));
      const half = Math.floor(results.length / 2);
      const wins = (xs: boolean[]) => xs.filter(Boolean).length;
      return {
        playerId: p.playerId,
        name: p.name,
        games: p.games,
        half,
        firstRate: wins(results.slice(0, half)) / half,
        secondRate: wins(results.slice(results.length - half)) / half,
      };
    })
    .filter((p) => p.secondRate > p.firstRate);
  const mostImproved = best(
    improved,
    (a, b) => b.secondRate - b.firstRate - (a.secondRate - a.firstRate) || b.games - a.games || a.name.localeCompare(b.name),
  );

  const classWinRate = Object.fromEntries(
    TIERS.map((tier) => {
      const rows = members.flatMap((p) => {
        const finishes = p.finishTiers[tier];
        if (finishes < CLASS_WIN_RATE_MIN_GAMES) return [];
        const wins = games.reduce(
          (n, g) => n + g.entries.filter((e) => e.playerId === p.playerId && e.isWinner && e.acts[2]?.tier === tier).length,
          0,
        );
        return [{ playerId: p.playerId, name: p.name, finishes, wins, winRate: wins / finishes }];
      });
      return [tier, best(rows, (a, b) => b.winRate - a.winRate || b.finishes - a.finishes || a.name.localeCompare(b.name))];
    }),
  ) as Records["classWinRate"];

  const fs = fateSummaries(games, fates);
  const mostPlayedFate = best(
    fs.filter((f) => f.totalPlays > 0),
    (a, b) => b.totalPlays - a.totalPlays || a.name.localeCompare(b.name),
  );
  const bestOf = (tier: Tier) =>
    best(
      fs.filter((f) => f.tier === tier && f.finishes >= BEST_FATE_MIN_PLAYS),
      (a, b) => (b.avgScore[2] ?? 0) - (a.avgScore[2] ?? 0) || b.finishes - a.finishes || a.name.localeCompare(b.name),
    );
  const deadliestFate = best(
    fs.filter((f) => f.plays[0] + f.plays[1] >= DEADLIEST_FATE_MIN_PLAYS && f.failures > 0),
    (a, b) => (b.failRate ?? 0) - (a.failRate ?? 0) || b.failures - a.failures || a.name.localeCompare(b.name),
  );

  const seatMap = new Map<number, SeatRow>();
  for (const g of games) {
    for (const e of g.entries) {
      e.acts.forEach((a, i) => {
        if (!a || a.seat === null) return;
        let row = seatMap.get(a.seat);
        if (!row) {
          row = { seat: a.seat, byAct: [[0, 0], [0, 0], [0, 0]] };
          seatMap.set(a.seat, row);
        }
        const ok = i === 2 ? e.isWinner : a.success;
        if (i < 2 && ok === null) return;
        row.byAct[i][1]++;
        if (ok) row.byAct[i][0]++;
      });
    }
  }

  return {
    champion: champion && { playerId: champion.playerId, name: champion.name, wins: champion.wins, games: champion.games },
    topAct3,
    mostImproved,
    classWinRate,
    mostPlayedFate,
    bestFate: { A: bestOf("A"), B: bestOf("B") },
    deadliestFate,
    seats: [...seatMap.values()].sort((a, b) => a.seat - b.seat),
  };
}
