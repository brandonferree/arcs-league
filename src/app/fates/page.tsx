import type { Metadata } from "next";
import Link from "next/link";
import { FateChip } from "@/components/fates";
import { FilterNote, StatsFilterBar } from "@/components/StatsFilterBar";
import { getDb } from "@/db";
import { fateSlug, formatAvg, formatPct } from "@/lib/format";
import { fateSummaries, TIERS } from "@/lib/stats";
import { filterQuery, parseStatsFilters } from "@/lib/stats-filters";
import { listSeasons } from "@/server/campaigns";
import { listStatFates, loadStatGames } from "@/server/stats";

export const metadata: Metadata = { title: "Fates" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const TIER_NOTE = {
  A: "Act I fates. Legal later only as a continuation.",
  B: "Act II fates. Never in Act I.",
  C: "Act III fates. Success in Act III is winning.",
} as const;

export default async function FatesPage({ searchParams }: { searchParams: SP }) {
  const filters = parseStatsFilters(await searchParams);
  const db = await getDb();
  const [games, fates, seasons] = await Promise.all([loadStatGames(db, filters), listStatFates(db), listSeasons(db)]);
  const rows = fateSummaries(games, fates);
  const qs = filterQuery(filters);

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Analytics</div>
        <h1>Fates</h1>
        <p className="lede">
          Plays count act appearances, so a fate kept for three acts is three plays. Keep % is how often a successful
          fate was carried into the next act. Win % is wins out of Act III finishes on that fate.
        </p>
      </div>

      <section className="panel" aria-label="Filters">
        <StatsFilterBar filters={filters} seasons={seasons} action="/fates" />
        <FilterNote filters={filters} count={games.length} />
      </section>

      {TIERS.map((tier) => {
        const list = rows.filter((f) => f.tier === tier);
        // Columns only for acts this tier can be played in: B from Act II, C only in Act III.
        const inI = tier === "A";
        const inII = tier !== "C";
        return (
          <section key={tier} className="panel" aria-labelledby={`tier-${tier}`} style={{ marginTop: 22 }}>
            <div className="panel__head">
              <h2 id={`tier-${tier}`} className="panel__title">
                Tier {tier}
              </h2>
              <span className="panel__note">{TIER_NOTE[tier]}</span>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Fate</th>
                    {inI ? <th className="num">Plays I</th> : null}
                    {inII ? <th className="num">Plays II</th> : null}
                    <th className="num">Plays III</th>
                    {inI ? <th className="num">Success I</th> : null}
                    {inII ? <th className="num">Success II</th> : null}
                    {inII ? <th className="num">Keep %</th> : null}
                    <th className="num">Win %</th>
                    {inI ? <th className="num">Avg I</th> : null}
                    {inII ? <th className="num">Avg II</th> : null}
                    <th className="num">Avg III</th>
                    <th className="num">Complexity</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <Link href={`/fates/${fateSlug(f.name)}${qs}`} className="chip-link">
                          <FateChip fate={f.name} tier={f.tier} />
                        </Link>
                      </td>
                      {inI ? <td className="num">{f.plays[0]}</td> : null}
                      {inII ? <td className="num">{f.plays[1]}</td> : null}
                      <td className="num">{f.plays[2]}</td>
                      {inI ? <td className="num">{formatPct(f.successRate[0])}</td> : null}
                      {inII ? <td className="num">{formatPct(f.successRate[1])}</td> : null}
                      {inII ? <td className="num">{formatPct(f.keepRate)}</td> : null}
                      <td className="num">{formatPct(f.winRate)}</td>
                      {inI ? <td className="num">{formatAvg(f.avgScore[0])}</td> : null}
                      {inII ? <td className="num">{formatAvg(f.avgScore[1])}</td> : null}
                      <td className="num">{formatAvg(f.avgScore[2])}</td>
                      <td className="num">{f.complexity ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
