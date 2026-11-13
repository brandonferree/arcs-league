import Link from "next/link";
import type { Season } from "@/db/schema";
import { hasFilters, type StatsFilters } from "@/lib/stats-filters";

/**
 * The filter row above every stats page (spec section 6): date range, season
 * and player count. A plain GET form, so filtered pages are linkable.
 */
export function StatsFilterBar({
  filters,
  seasons,
  action,
  children,
  clearHref,
}: {
  filters: StatsFilters;
  seasons: Season[];
  action: string;
  /** Extra fields for this page (e.g. the leaderboard minimum). */
  children?: React.ReactNode;
  clearHref?: string;
}) {
  return (
    <form className="filters stats-filters" method="get" action={action} aria-label="Filters">
      <label className="field">
        <span className="field__label">From</span>
        <input className="input" type="date" name="from" defaultValue={filters.from ?? ""} />
      </label>
      <label className="field">
        <span className="field__label">To</span>
        <input className="input" type="date" name="to" defaultValue={filters.to ?? ""} />
      </label>
      {seasons.length || filters.seasonId ? (
        <label className="field">
          <span className="field__label">Season</span>
          <select className="select" name="season" defaultValue={filters.seasonId ?? ""}>
            <option value="">All seasons</option>
            {filters.seasonId && !seasons.some((s) => s.id === filters.seasonId) ? (
              // A link to a season that no longer exists: say so rather than pretend "All seasons".
              <option value={filters.seasonId}>Unknown season</option>
            ) : null}
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="field">
        <span className="field__label">Players</span>
        <select className="select" name="players" defaultValue={filters.playerCount ?? ""}>
          <option value="">3 or 4</option>
          <option value="3">3 players</option>
          <option value="4">4 players</option>
        </select>
      </label>
      {children}
      <button className="btn btn--cyan" type="submit">
        Filter
      </button>
      {hasFilters(filters) ? (
        <Link className="btn btn--quiet" href={clearHref ?? action}>
          Clear
        </Link>
      ) : null}
    </form>
  );
}

export function FilterNote({ filters, count }: { filters: StatsFilters; count: number }) {
  return (
    <p className="muted small" style={{ margin: "12px 0 0" }}>
      {count} closed {count === 1 ? "campaign" : "campaigns"}
      {hasFilters(filters) ? " match these filters" : " in total"}. In-progress, stalled and void campaigns never
      count.
    </p>
  );
}
