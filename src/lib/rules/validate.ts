/**
 * Pure campaign rules: fate legality and table size. No I/O, so it runs the same
 * in the browser (live form validation) and on the server (authoritative check).
 *
 * Ported from docs/reference/legacy-rules/domain.py. Differences from the legacy
 * version:
 *   - acts may be missing, so a campaign in progress can be checked act by act;
 *   - fate tiers come from a lookup (the database), defaulting to the seed list;
 *   - violations are structured so the form can point at the offending field;
 *   - messages are plain text (the legacy Markdown bold is dropped);
 *   - player names are compared trimmed and case-insensitively;
 *   - an unknown fate name is reported.
 */
import { defaultTierOf, type ActNumber, type TierLookup } from "./fates";

export interface ActEntry {
  /** Fate name; empty or missing means "not chosen yet" and is skipped. */
  fate?: string | null;
  /** Required for Acts I and II. Act III has no success flag (winning is success). */
  success?: boolean | null;
  score?: number | null;
}

export interface PlayerRecord {
  name: string;
  act1?: ActEntry | null;
  act2?: ActEntry | null;
  act3?: ActEntry | null;
}

export type RuleCode =
  | "duplicate-player"
  | "unknown-fate"
  | "act1-not-a"
  | "act2-c-fate"
  | "a-fate-not-continued"
  | "continued-after-failure"
  | "returned-to-dropped"
  | "fate-shared"
  | "table-size";

export interface Violation {
  code: RuleCode;
  message: string;
  /** Player name(s) involved, when the violation is about specific players. */
  players?: string[];
  /** The act the violation is attached to, when it is about one act. */
  act?: ActNumber;
  fate?: string;
}

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 4;

const ROMAN: Record<ActNumber, string> = { 1: "I", 2: "II", 3: "III" };

function fateOf(entry: ActEntry | null | undefined): string | undefined {
  const f = entry?.fate?.trim();
  return f ? f : undefined;
}

function normName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * Rules 1-7 of the spec. Returns an empty list when the (possibly partial)
 * campaign is legal so far.
 */
export function validateFateRules(
  players: readonly PlayerRecord[],
  tierOf: TierLookup = defaultTierOf,
): Violation[] {
  const errors: Violation[] = [];

  // 1. Player names must be unique within a game.
  const byName = new Map<string, string[]>();
  for (const p of players) {
    const key = normName(p.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), p.name.trim()]);
  }
  const dupes = [...byName.values()].filter((v) => v.length > 1).map((v) => v[0]).sort();
  for (const nm of dupes) {
    errors.push({
      code: "duplicate-player",
      message: `${nm} is listed more than once — each player must be unique.`,
      players: [nm],
    });
  }

  // Per-player fate-sequence rules.
  for (const p of players) {
    const nm = p.name.trim();
    const f1 = fateOf(p.act1);
    const f2 = fateOf(p.act2);
    const f3 = fateOf(p.act3);
    const s1 = p.act1?.success === true;
    const s2 = p.act2?.success === true;

    const entries: [ActNumber, string | undefined][] = [[1, f1], [2, f2], [3, f3]];
    for (const [act, f] of entries) {
      if (f && !tierOf(f)) {
        errors.push({
          code: "unknown-fate",
          message: `${nm}: Act ${ROMAN[act]} fate ${f} is not a known fate.`,
          players: [nm], act, fate: f,
        });
      }
    }

    // 2-3. Tier act-legality.
    if (f1 && tierOf(f1) && tierOf(f1) !== "A") {
      errors.push({
        code: "act1-not-a",
        message: `${nm}: Act I fate ${f1} must be an A fate.`,
        players: [nm], act: 1, fate: f1,
      });
    }
    if (f2 && tierOf(f2) === "C") {
      errors.push({
        code: "act2-c-fate",
        message: `${nm}: Act II fate ${f2} is a C fate — C fates are Act III only.`,
        players: [nm], act: 2, fate: f2,
      });
    }

    // 4. A fates can only appear after Act I as a continuation of the prior act.
    if (f2 && tierOf(f2) === "A" && f2 !== f1) {
      errors.push({
        code: "a-fate-not-continued",
        message: `${nm}: Act II fate ${f2} is an A fate — A fates can only appear after Act I if continued from the prior act.`,
        players: [nm], act: 2, fate: f2,
      });
    }
    if (f3 && tierOf(f3) === "A" && f3 !== f2) {
      errors.push({
        code: "a-fate-not-continued",
        message: `${nm}: Act III fate ${f3} is an A fate — A fates can only appear after Act I if continued from the prior act.`,
        players: [nm], act: 3, fate: f3,
      });
    }

    // 5. Continuing a fate is only allowed after a success in the prior act.
    if (f1 && f2 === f1 && !s1) {
      errors.push({
        code: "continued-after-failure",
        message: `${nm}: kept ${f1} into Act II but failed it in Act I — a fate can only be continued after a success.`,
        players: [nm], act: 2, fate: f1,
      });
    }
    if (f2 && f3 === f2 && !s2) {
      errors.push({
        code: "continued-after-failure",
        message: `${nm}: kept ${f2} into Act III but failed it in Act II — a fate can only be continued after a success.`,
        players: [nm], act: 3, fate: f2,
      });
    }

    // 6. Can't return to a fate once it has been dropped.
    if (f1 && f2 && f2 !== f1 && f3 === f1) {
      errors.push({
        code: "returned-to-dropped",
        message: `${nm}: returned to ${f1} in Act III after leaving it — a dropped fate can't be played again.`,
        players: [nm], act: 3, fate: f1,
      });
    }
  }

  // 7. A fate can belong to only one player across the whole game.
  const owners = new Map<string, Set<string>>();
  for (const p of players) {
    for (const f of new Set([fateOf(p.act1), fateOf(p.act2), fateOf(p.act3)])) {
      if (!f) continue;
      if (!owners.has(f)) owners.set(f, new Set());
      owners.get(f)!.add(p.name.trim());
    }
  }
  for (const fate of [...owners.keys()].sort()) {
    const who = [...owners.get(fate)!].sort();
    if (who.length > 1) {
      errors.push({
        code: "fate-shared",
        message: `Fate ${fate} is shared by ${who.join(", ")} — a fate can belong to only one player per game.`,
        players: who, fate,
      });
    }
  }

  return errors;
}

/** Rule 8: tables are 3 or 4 players. */
export function validateTableSize(playerCount: number): Violation[] {
  if (playerCount >= MIN_PLAYERS && playerCount <= MAX_PLAYERS) return [];
  return [{
    code: "table-size",
    message: `A campaign needs ${MIN_PLAYERS} or ${MAX_PLAYERS} players (this one has ${playerCount}).`,
  }];
}

/** All of rules 1-8. */
export function validateCampaign(
  players: readonly PlayerRecord[],
  tierOf: TierLookup = defaultTierOf,
): Violation[] {
  return [...validateTableSize(players.length), ...validateFateRules(players, tierOf)];
}
