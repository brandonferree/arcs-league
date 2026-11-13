import type { Metadata } from "next";
import Link from "next/link";
import { FilterNote, StatsFilterBar } from "@/components/StatsFilterBar";
import { getDb } from "@/db";
import { formatAvg, formatPct } from "@/lib/format";
import { LEADERBOARD_MIN_GAMES, leaderboard, pickChampion, playerSummaries } from "@/lib/stats";
import { filterQuery, parseStatsFilters } from "@/lib/stats-filters";
import { listSeasons } from "@/server/campaigns";
import { loadStatGames } from "@/server/stats";

export const metadata: Metadata = { title: "Leaderboard" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function LeaderboardPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filters = parseStatsFilters(sp);
  const rawMin = Number(Array.isArray(sp.min) ? sp.min[0] : sp.min);
  const minGames = Number.isInteger(rawMin) && rawMin >= 1 && rawMin <= 100 ? rawMin : LEADERBOARD_MIN_GAMES;

  const db = await getDb();
  const [games, seasons] = await Promise.all([loadStatGames(db, filters), listSeasons(db)]);
  const { ranked, belowMinimum } = leaderboard(games, minGames);
  const champion = pickChampion(playerSummaries(games).filter((p) => !p.isGuest));
  const qs = filterQuery(filters);

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Standings</div>
        <h1>Leaderboard</h1>
        <p className="lede">
          Members ranked by win rate, then wins. Guests appear in campaign records but never rank. No rating system:
          just results.
        </p>
      </div>

      <section className="panel" aria-label="Leaderboard">
        <StatsFilterBar filters={filters} seasons={seasons} action="/leaderboard">
          <label className="field field--narrow">
            <span className="field__label">Min games</span>
            <input className="input" type="number" name="min" min={1} max={100} defaultValue={minGames} />
          </label>
        </StatsFilterBar>
        <FilterNote filters={filters} count={games.length} />

        <div className="table-wrap" style={{ marginTop: 20 }}>
          {ranked.length === 0 ? (
            <p className="empty">
              Nobody has {minGames} or more finished {minGames === 1 ? "campaign" : "campaigns"} yet
              {belowMinimum ? ` (${belowMinimum} ${belowMinimum === 1 ? "member is" : "members are"} below the minimum)` : ""}.
              {minGames > 1 ? (
                <>
                  {" "}
                  <Link href={`/leaderboard${filterQuery(filters, { min: 1 })}`}>Show everyone with a finished campaign</Link>.
                </>
              ) : null}
            </p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Player</th>
                  <th className="num">Games</th>
                  <th className="num">Wins</th>
                  <th className="num">Win %</th>
                  <th className="num">Avg III</th>
                  <th className="num">Best III</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((p, i) => (
                  <tr key={p.playerId}>
                    <td className="num muted">{i + 1}</td>
                    <td>
                      <Link href={`/players/${p.playerId}${qs}`}>{p.name}</Link>
                      {champion?.playerId === p.playerId ? <span className="badge badge--winner">Champion</span> : null}
                    </td>
                    <td className="num">{p.games}</td>
                    <td className="num">{p.wins}</td>
                    <td className="num">{formatPct(p.winRate)}</td>
                    <td className="num">{formatAvg(p.avgAct3)}</td>
                    <td className="num">{p.bestAct3 ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {ranked.length && belowMinimum ? (
          <p className="muted small" style={{ margin: "14px 0 0" }}>
            {belowMinimum} more {belowMinimum === 1 ? "member has" : "members have"} fewer than {minGames} finished
            campaigns. <Link href={`/players${qs}`}>All players</Link>
          </p>
        ) : (
          <p className="muted small" style={{ margin: "14px 0 0" }}>
            <Link href={`/players${qs}`}>All players, including guests</Link>
          </p>
        )}
      </section>
    </>
  );
}
