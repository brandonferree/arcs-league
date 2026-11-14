import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProgressionBars, WinRateLine } from "@/components/charts";
import { FateChip, FatePath, ProgressionMark, TierBadge } from "@/components/fates";
import { Kpi } from "@/components/Kpi";
import { FilterNote, StatsFilterBar } from "@/components/StatsFilterBar";
import { getDb } from "@/db";
import { fateSlug, formatAvg, formatDate, formatPct, ROMAN } from "@/lib/format";
import { playerDetail, rate, TIERS } from "@/lib/stats";
import { filterQuery, hasFilters, parseStatsFilters } from "@/lib/stats-filters";
import { listSeasons } from "@/server/campaigns";
import { getPlayer, loadStatGames } from "@/server/stats";
import { loadTableaux } from "@/server/card-stats";
import { playerCards } from "@/lib/card-stats";
import { PlayerCardsPanel } from "./PlayerCards";

type Params = Promise<{ id: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return { title: "Player" };
  const p = await getPlayer(await getDb(), id);
  return { title: p?.name ?? "Player" };
}

export default async function PlayerPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const filters = parseStatsFilters(await searchParams);
  const qs = filterQuery(filters);
  const db = await getDb();
  const player = await getPlayer(db, id);
  if (!player) notFound();
  // A guest linked to a real account has had its history moved there.
  if (player.linkedPlayerId) redirect(`/players/${player.linkedPlayerId}${qs}`);

  const [games, seasons, tableaux] = await Promise.all([
    loadStatGames(db, filters),
    listSeasons(db),
    loadTableaux(db, filters, { playerId: id }),
  ]);
  const d = playerDetail(games, id);
  const cards = playerCards(tableaux, id);

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">
          <Link href={`/players${qs}`}>Players</Link>
        </div>
        <h1>
          {player.name}
          {player.isGuest ? <span className="badge badge--guest">Guest</span> : null}
        </h1>
        {player.isGuest ? (
          <p className="lede">Guests appear in campaign records but never on the leaderboard.</p>
        ) : null}
      </div>

      <section className="panel" aria-label="Filters">
        <StatsFilterBar filters={filters} seasons={seasons} action={`/players/${id}`} />
        <FilterNote filters={filters} count={games.length} />
      </section>

      {!d ? (
        <section className="panel" style={{ marginTop: 22 }}>
          <p className="empty">
            {hasFilters(filters) ? "No finished campaigns match these filters." : "No finished campaigns yet."}
          </p>
        </section>
      ) : (
        <>
          <section className="grid-kpi" aria-label="Headline numbers" style={{ marginTop: 22 }}>
            <Kpi label="Games" value={String(d.summary.games)} note={`last ${formatDate(d.summary.lastPlayedOn)}`} />
            <Kpi label="Wins" value={String(d.summary.wins)} note={`${formatPct(d.summary.winRate)} win rate`} tone={d.summary.wins > 0 ? "gold" : undefined} />
            <Kpi
              label="Avg Act III"
              value={formatAvg(d.summary.avgAct3)}
              note={`${formatAvg(d.summary.avgAct3ExclC)} excluding C-fate finishes`}
            />
            <Kpi label="Best Act III" value={String(d.summary.bestAct3 ?? "–")} note="highest final score" />
          </section>

          <div className="grid-2 grid-2--even" style={{ marginTop: 22 }}>
            <section className="panel" aria-labelledby="wr-h">
              <div className="panel__head">
                <h2 id="wr-h" className="panel__title">
                  Win rate over time
                </h2>
                <span className="panel__note">cumulative, by date</span>
              </div>
              <WinRateLine points={d.timeline} label={`${player.name}'s win rate`} />
            </section>

            <section className="panel" aria-labelledby="prog-h">
              <div className="panel__head">
                <h2 id="prog-h" className="panel__title">
                  Progression across acts
                </h2>
                <span className="panel__note">how each act&apos;s fate was reached</span>
              </div>
              <ProgressionBars
                noun="games"
                rows={[
                  { act: 2, counts: d.stepsByAct[1] },
                  { act: 3, counts: d.stepsByAct[2] },
                ]}
              />
              <dl className="mini-stats">
                <div>
                  <dt>Act III class</dt>
                  <dd>
                    {TIERS.map((t) => (
                      <span key={t} className="mini-stats__item">
                        <TierBadge tier={t} />
                        <span className="tabular">{formatPct(d.summary.finishTiers[t] / d.summary.games)}</span>
                      </span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt>Success</dt>
                  <dd>
                    {d.successByAct.map(([ok, n], i) => (
                      <span key={i} className="mini-stats__item">
                        Act {ROMAN[(i + 1) as 1 | 2]} <span className="tabular">{formatPct(rate(ok, n))}</span>
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <section className="panel" aria-labelledby="fates-h" style={{ marginTop: 22 }}>
            <div className="panel__head">
              <h2 id="fates-h" className="panel__title">
                Fates played
              </h2>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Fate</th>
                    <th className="num">Act I</th>
                    <th className="num">Act II</th>
                    <th className="num">Act III</th>
                    <th className="num">Wins</th>
                  </tr>
                </thead>
                <tbody>
                  {d.fates.map((f) => (
                    <tr key={f.fateId}>
                      <td>
                        <Link href={`/fates/${fateSlug(f.fate)}${qs}`} className="chip-link">
                          <FateChip fate={f.fate} tier={f.tier} />
                        </Link>
                      </td>
                      {f.plays.map((n, i) => (
                        <td key={i} className="num">
                          {n || "–"}
                        </td>
                      ))}
                      <td className="num">{f.wins || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel" aria-labelledby="hist-h" style={{ marginTop: 22 }}>
            <div className="panel__head">
              <h2 id="hist-h" className="panel__title">
                Campaigns
              </h2>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="num">Date</th>
                    <th>Campaign</th>
                    <th>Fate path</th>
                    <th>Progression</th>
                    <th className="num">Act III</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {[...d.games].reverse().map((g) => (
                    <tr key={g.campaignId}>
                      <td className="num">{formatDate(g.playedOn)}</td>
                      <td>
                        <Link href={`/campaigns/${g.campaignId}`}>{g.title}</Link>
                        <div className="muted small">{g.playerCount} players</div>
                      </td>
                      <td>
                        <FatePath steps={g.path} />
                      </td>
                      <td>
                        <span className="path">
                          {g.steps.map((s, i) => (
                            <ProgressionMark key={i} step={s} />
                          ))}
                        </span>
                      </td>
                      <td className="num">{g.act3Score ?? "–"}</td>
                      <td>{g.won ? <span className="badge badge--winner">Won</span> : <span className="muted">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {cards ? <PlayerCardsPanel data={cards} playerName={player.name} qs={qs} /> : null}
    </>
  );
}
