import type { Metadata } from "next";
import Link from "next/link";
import { FateChip, TierBadge } from "@/components/fates";
import { FilterNote, StatsFilterBar } from "@/components/StatsFilterBar";
import { getDb } from "@/db";
import { fateSlug, formatAvg, formatDate, formatPct, ROMAN } from "@/lib/format";
import {
  BEST_FATE_MIN_PLAYS,
  CLASS_WIN_RATE_MIN_GAMES,
  DEADLIEST_FATE_MIN_PLAYS,
  MOST_IMPROVED_MIN_GAMES,
  rate,
  records,
  TIERS,
  type FateSummary,
} from "@/lib/stats";
import { filterQuery, parseStatsFilters } from "@/lib/stats-filters";
import { listSeasons } from "@/server/campaigns";
import { listStatFates, loadStatGames } from "@/server/stats";

export const metadata: Metadata = { title: "Records" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function RecordsPage({ searchParams }: { searchParams: SP }) {
  const filters = parseStatsFilters(await searchParams);
  const db = await getDb();
  const [games, fates, seasons] = await Promise.all([loadStatGames(db, filters), listStatFates(db), listSeasons(db)]);
  const r = records(games, fates);
  const qs = filterQuery(filters);
  const player = (id: number, name: string) => <Link href={`/players/${id}${qs}`}>{name}</Link>;
  const fate = (f: { name: string; tier: FateSummary["tier"] }) => (
    <Link href={`/fates/${fateSlug(f.name)}${qs}`} className="chip-link">
      <FateChip fate={f.name} tier={f.tier} />
    </Link>
  );

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Hall of the Reach</div>
        <h1>Records</h1>
        <p className="lede">
          Awards from closed campaigns. Player awards are for members; guests still count in single-game records and
          fate stats. Minimums are provisional until there are more games.
        </p>
      </div>

      <section className="panel" aria-label="Filters">
        <StatsFilterBar filters={filters} seasons={seasons} action="/records" />
        <FilterNote filters={filters} count={games.length} />
      </section>

      <section className="award-grid" aria-label="Awards" style={{ marginTop: 22 }}>
        <Award title="Champion" rule="Most wins, ties broken by win rate">
          {r.champion ? (
            <>
              <AwardValue>{player(r.champion.playerId, r.champion.name)}</AwardValue>
              <p className="award__detail tabular">
                {r.champion.wins} {r.champion.wins === 1 ? "win" : "wins"} in {r.champion.games}
              </p>
            </>
          ) : null}
        </Award>

        <Award title="Top Act III score" rule="Highest final score; earliest wins a tie">
          {r.topAct3 ? (
            <>
              <AwardValue>{r.topAct3.score}</AwardValue>
              <p className="award__detail">
                {player(r.topAct3.playerId, r.topAct3.name)}
                {r.topAct3.isGuest ? <span className="badge badge--guest">Guest</span> : null} on {fate({ name: r.topAct3.fate, tier: r.topAct3.tier })} in{" "}
                <Link href={`/campaigns/${r.topAct3.campaignId}`}>{r.topAct3.title}</Link>, {formatDate(r.topAct3.playedOn)}
              </p>
            </>
          ) : null}
        </Award>

        <Award title="Most improved" rule={`Later-half win rate minus earlier-half, at least ${MOST_IMPROVED_MIN_GAMES} games`}>
          {r.mostImproved ? (
            <>
              <AwardValue>{player(r.mostImproved.playerId, r.mostImproved.name)}</AwardValue>
              <p className="award__detail tabular">
                {formatPct(r.mostImproved.firstRate)} → {formatPct(r.mostImproved.secondRate)} over {r.mostImproved.half} +{" "}
                {r.mostImproved.half} games
              </p>
            </>
          ) : null}
        </Award>

        <Award title="Most played fate" rule="Act appearances">
          {r.mostPlayedFate ? (
            <>
              <AwardValue>{fate(r.mostPlayedFate)}</AwardValue>
              <p className="award__detail tabular">{r.mostPlayedFate.totalPlays} plays</p>
            </>
          ) : null}
        </Award>

        {(["A", "B"] as const).map((t) => {
          const f = r.bestFate[t];
          return (
            <Award key={t} title={`Best ${t} fate`} rule={`Highest Act III average, at least ${BEST_FATE_MIN_PLAYS} finishes`}>
              {f ? (
                <>
                  <AwardValue>{fate(f)}</AwardValue>
                  <p className="award__detail tabular">
                    {formatAvg(f.avgScore[2])} average over {f.finishes} finishes
                  </p>
                </>
              ) : null}
            </Award>
          );
        })}

        <Award title="Deadliest fate" rule={`Highest failure rate in Acts I and II, at least ${DEADLIEST_FATE_MIN_PLAYS} plays`}>
          {r.deadliestFate ? (
            <>
              <AwardValue>{fate(r.deadliestFate)}</AwardValue>
              <p className="award__detail tabular">
                {formatPct(r.deadliestFate.failRate)} failed ({r.deadliestFate.failures} of{" "}
                {r.deadliestFate.plays[0] + r.deadliestFate.plays[1]})
              </p>
            </>
          ) : null}
        </Award>
      </section>

      <div className="grid-2 grid-2--even" style={{ marginTop: 22 }}>
        <section className="panel" aria-labelledby="class-h">
          <div className="panel__head">
            <h2 id="class-h" className="panel__title">
              Top win rate by class
            </h2>
            <span className="panel__note">class = Act III fate tier, at least {CLASS_WIN_RATE_MIN_GAMES} finishes</span>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Player</th>
                  <th className="num">Win %</th>
                  <th className="num">Wins</th>
                  <th className="num">Finishes</th>
                </tr>
              </thead>
              <tbody>
                {TIERS.map((t) => {
                  const w = r.classWinRate[t];
                  return (
                    <tr key={t}>
                      <td>
                        <TierBadge tier={t} />
                      </td>
                      {w ? (
                        <>
                          <td className="gold">{player(w.playerId, w.name)}</td>
                          <td className="num">{formatPct(w.winRate)}</td>
                          <td className="num">{w.wins}</td>
                          <td className="num">{w.finishes}</td>
                        </>
                      ) : (
                        <td colSpan={4} className="muted">
                          Nobody qualifies yet
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel" aria-labelledby="seat-h">
          <div className="panel__head">
            <h2 id="seat-h" className="panel__title">
              Seat order
            </h2>
            <span className="panel__note">where seats were recorded</span>
          </div>
          {r.seats.length === 0 ? (
            <p className="empty">No seats recorded yet. Seat order is optional on the act form.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Seat</th>
                    {([0, 1] as const).map((i) => (
                      <th key={i} className="num">
                        Success {ROMAN[(i + 1) as 1 | 2]}
                      </th>
                    ))}
                    <th className="num">Win % III</th>
                  </tr>
                </thead>
                <tbody>
                  {r.seats.map((s) => (
                    <tr key={s.seat}>
                      <td className="tabular">{s.seat}</td>
                      {s.byAct.map(([ok, n], i) => (
                        <td key={i} className="num">
                          {formatPct(rate(ok, n))} <span className="muted small">({n})</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Award({ title, rule, children }: { title: string; rule: string; children: React.ReactNode }) {
  return (
    <div className="panel award">
      <h2 className="award__title">{title}</h2>
      {children ?? <p className="award__empty">Nobody qualifies yet</p>}
      <p className="award__rule">{rule}</p>
    </div>
  );
}

function AwardValue({ children }: { children: React.ReactNode }) {
  return <div className="award__value">{children}</div>;
}
