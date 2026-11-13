import type { Metadata } from "next";
import Link from "next/link";
import { FilterNote, StatsFilterBar } from "@/components/StatsFilterBar";
import { getDb } from "@/db";
import { formatDate, formatPct } from "@/lib/format";
import { playerSummaries } from "@/lib/stats";
import { filterQuery, parseStatsFilters } from "@/lib/stats-filters";
import { listSeasons } from "@/server/campaigns";
import { loadStatGames } from "@/server/stats";

export const metadata: Metadata = { title: "Players" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function PlayersPage({ searchParams }: { searchParams: SP }) {
  const filters = parseStatsFilters(await searchParams);
  const db = await getDb();
  const [games, seasons] = await Promise.all([loadStatGames(db, filters), listSeasons(db)]);
  const rows = playerSummaries(games).sort(
    (a, b) => Number(a.isGuest) - Number(b.isGuest) || b.games - a.games || a.name.localeCompare(b.name),
  );
  const qs = filterQuery(filters);

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Captains</div>
        <h1>Players</h1>
        <p className="lede">Everyone with a finished campaign, members first. Guests are listed but never rank.</p>
      </div>

      <section className="panel" aria-label="Players">
        <StatsFilterBar filters={filters} seasons={seasons} action="/players" />
        <FilterNote filters={filters} count={games.length} />
        <div className="table-wrap" style={{ marginTop: 20 }}>
          {rows.length === 0 ? (
            <p className="empty">No finished campaigns yet.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Games</th>
                  <th className="num">Wins</th>
                  <th className="num">Win %</th>
                  <th className="num">Best III</th>
                  <th className="num">Last played</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.playerId}>
                    <td>
                      <Link href={`/players/${p.playerId}${qs}`}>{p.name}</Link>
                      {p.isGuest ? <span className="badge badge--guest">Guest</span> : null}
                    </td>
                    <td className="num">{p.games}</td>
                    <td className="num">{p.wins}</td>
                    <td className="num">{formatPct(p.winRate)}</td>
                    <td className="num">{p.bestAct3 ?? "–"}</td>
                    <td className="num">{formatDate(p.lastPlayedOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
