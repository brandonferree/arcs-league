/**
 * Filters shared by every stats page (spec section 6): date range, season,
 * player count and where the campaign was played. Read from and written to the
 * query string.
 */

/** "manual" is a campaign entered by hand on the site; the rest are import platforms. */
export const PLATFORM_FILTERS = ["manual", "meeples", "tts", "screenshot"] as const;
export type PlatformFilter = (typeof PLATFORM_FILTERS)[number];

export interface StatsFilters {
  /** Inclusive ISO dates, compared with the date Act III was played. */
  from: string | null;
  to: string | null;
  seasonId: number | null;
  playerCount: 3 | 4 | null;
  platform: PlatformFilter | null;
}

export const NO_FILTERS: StatsFilters = { from: null, to: null, seasonId: null, playerCount: null, platform: null };

type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function isoDate(v: string | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? null : v;
}

export function parseStatsFilters(sp: SearchParams): StatsFilters {
  const pc = Number(one(sp.players));
  const season = Number(one(sp.season));
  return {
    from: isoDate(one(sp.from)),
    to: isoDate(one(sp.to)),
    seasonId: Number.isInteger(season) && season > 0 ? season : null,
    playerCount: pc === 3 || pc === 4 ? pc : null,
    platform: (PLATFORM_FILTERS as readonly string[]).includes(one(sp.played) ?? "") ? (one(sp.played) as PlatformFilter) : null,
  };
}

/** Query string for links between stats pages, so the filters carry over. "" when none. */
export function filterQuery(f: StatsFilters, extra: Record<string, string | number | null | undefined> = {}): string {
  const p = new URLSearchParams();
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.seasonId) p.set("season", String(f.seasonId));
  if (f.playerCount) p.set("players", String(f.playerCount));
  if (f.platform) p.set("played", f.platform);
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function hasFilters(f: StatsFilters): boolean {
  return !!(f.from || f.to || f.seasonId || f.playerCount || f.platform);
}

/** Query condition for the platform filter: null source means entered by hand. */
export function platformCondition<C>(
  f: StatsFilters,
  ops: { isNull: () => C; eq: (platform: string) => C },
): C | null {
  if (!f.platform) return null;
  return f.platform === "manual" ? ops.isNull() : ops.eq(f.platform);
}
