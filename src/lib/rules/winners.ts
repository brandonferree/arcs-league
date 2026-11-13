/**
 * Winner logic. The default winner is the highest Act III score (ties share the
 * win), but the stored winner is an explicit field: C fates can win on objectives
 * regardless of points, so the submitter may override the default with a reason.
 */

export interface Act3Result {
  name: string;
  score: number;
}

/** Player(s) with the highest Act III score. Ties share the win. */
export function campaignWinners(players: readonly Act3Result[]): string[] {
  if (players.length === 0) return [];
  const top = Math.max(...players.map((p) => p.score));
  return players.filter((p) => p.score === top).map((p) => p.name);
}

export interface WinnerDecision {
  winners: string[];
  /** True when the chosen winners differ from the score-based default. */
  overridden: boolean;
  reason: string | null;
  errors: string[];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

/**
 * Resolves the explicit winner field. `chosen` null/undefined means "use the
 * default". An override must name at least one player in the campaign and must
 * give a reason.
 */
export function resolveWinners(
  players: readonly Act3Result[],
  chosen?: readonly string[] | null,
  reason?: string | null,
): WinnerDecision {
  const defaults = campaignWinners(players);
  if (chosen == null) {
    return { winners: defaults, overridden: false, reason: null, errors: [] };
  }

  const errors: string[] = [];
  const names = new Set(players.map((p) => p.name));
  const picked = [...new Set(chosen)];
  if (picked.length === 0) errors.push("Choose at least one winner.");
  for (const w of picked) {
    if (!names.has(w)) errors.push(`${w} is not a player in this campaign.`);
  }

  const overridden = !sameSet(picked, defaults);
  const why = reason?.trim() || null;
  if (overridden && !why) {
    errors.push("Give a reason when the winner is not the highest Act III score.");
  }
  return { winners: picked, overridden, reason: overridden ? why : null, errors };
}
