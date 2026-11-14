import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CardImage } from "@/components/CardImage";
import { CardText } from "@/components/CardText";
import { ProgressionBars, WinRateLine } from "@/components/charts";
import { FateChip, FatePath } from "@/components/fates";
import { Kpi } from "@/components/Kpi";
import { FilterNote, StatsFilterBar } from "@/components/StatsFilterBar";
import { getDb } from "@/db";
import { fateSlug, formatAvg, formatDate, formatPct, ROMAN } from "@/lib/format";
import { buriedGiantCardUrl } from "@/lib/cards";
import { fateDetail, type FateSwitch } from "@/lib/stats";
import { filterQuery, parseStatsFilters } from "@/lib/stats-filters";
import { listSeasons } from "@/server/campaigns";
import { fateCards } from "@/server/cards";
import { listStatFates, loadStatGames } from "@/server/stats";

type Params = Promise<{ slug: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

async function findFate(slug: string) {
  const fates = await listStatFates(await getDb());
  return { fates, fate: fates.find((f) => fateSlug(f.name) === slug) ?? null };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { fate } = await findFate((await params).slug);
  return { title: fate ? `${fate.name} (${fate.tier})` : "Fate" };
}

export default async function FatePage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { fates, fate } = await findFate((await params).slug);
  if (!fate) notFound();
  const filters = parseStatsFilters(await searchParams);
  const qs = filterQuery(filters);
  const db = await getDb();
  const [games, seasons, cardSet] = await Promise.all([loadStatGames(db, filters), listSeasons(db), fateCards(db, fate.id)]);
  const fateCard = cardSet.find((c) => c.id === fate.cardId) ?? null;
  const others = cardSet.filter((c) => c.id !== fate.cardId);
  const setActs = [...new Set(others.map((c) => c.act))].sort((a, b) => (a ?? 9) - (b ?? 9));
  const d = fateDetail(games, fates, fate.id)!;
  const s = d.summary;
  // A fates can be held in any act (by continuation), B from Act II, C only in Act III.
  const cardAct = ({ A: 1, B: 2, C: 3 } as const)[fate.tier];
  const acts = ([1, 2, 3] as const).filter((a) => a >= cardAct);

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">
          <Link href={`/fates${qs}`}>Fates</Link> · Tier {fate.tier} · Act {ROMAN[cardAct]} card
        </div>
        <h1>
          <FateChip fate={fate.name} tier={fate.tier} />
        </h1>
      </div>

      <section className="panel" aria-label="Filters">
        <StatsFilterBar filters={filters} seasons={seasons} action={`/fates/${fateSlug(fate.name)}`} />
        <FilterNote filters={filters} count={games.length} />
      </section>

      <section className="grid-kpi" aria-label="Headline numbers" style={{ marginTop: 22 }}>
        <Kpi label="Plays" value={String(s.totalPlays)} note={acts.map((a) => `${ROMAN[a]} ${s.plays[a - 1]}`).join(" · ")} />
        {fate.tier !== "C" ? (
          <Kpi label="Keep %" value={formatPct(s.keepRate)} note={`${s.kept} of ${s.keepChances} successes kept`} />
        ) : (
          <Kpi label="Finishes" value={String(s.finishes)} note="Act III plays" />
        )}
        <Kpi label="Win %" value={formatPct(s.winRate)} note={`${s.wins} of ${s.finishes} Act III finishes`} />
        <Kpi label="Avg Act III" value={formatAvg(s.avgScore[2])} note="final score on this fate" />
      </section>

      <div className="grid-2 grid-2--even" style={{ marginTop: 22 }}>
        <section className="panel" aria-labelledby="card-h">
          <div className="panel__head">
            <h2 id="card-h" className="panel__title">
              The card
            </h2>
            <span className="panel__note">Complexity {fate.complexity ?? "–"}</span>
          </div>
          {fateCard ? (
            <>
              {fateCard.imageV ? (
                <Link href={`/cards/${fateCard.id}`} className="fate-card-img">
                  <CardImage id={fateCard.id} name={fateCard.name} imageV={fateCard.imageV} size="full" eager />
                </Link>
              ) : (
                <CardText text={fateCard.text} />
              )}
              <p className="small muted" style={{ marginBottom: 0 }}>
                <Link href={`/cards/${fateCard.id}`}>Card page</Link> ·{" "}
                <a href={buriedGiantCardUrl(fateCard.id)} rel="noopener">
                  View on Buried Giant
                </a>
              </p>
            </>
          ) : (
            <p className="empty">
              The fate card&rsquo;s text and its card set appear once a moderator imports the cards from Buried Giant
              Studios&rsquo; database.
            </p>
          )}
        </section>

        <section className="panel" aria-labelledby="acts-h">
          <div className="panel__head">
            <h2 id="acts-h" className="panel__title">
              By act
            </h2>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Act</th>
                  <th className="num">Plays</th>
                  <th className="num">Success</th>
                  <th className="num">Avg score</th>
                </tr>
              </thead>
              <tbody>
                {acts.map((a) => (
                  <tr key={a}>
                    <td>Act {ROMAN[a]}</td>
                    <td className="num">{s.plays[a - 1]}</td>
                    <td className="num">
                      {a < 3 ? formatPct(s.successRate[a - 1]) : <span title="Act III success is winning">{formatPct(s.winRate)} won</span>}
                    </td>
                    <td className="num">{formatAvg(s.avgScore[a - 1])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="grid-2 grid-2--even" style={{ marginTop: 22 }}>
        <section className="panel" aria-labelledby="prog-h">
          <div className="panel__head">
            <h2 id="prog-h" className="panel__title">
              Progression across acts
            </h2>
            <span className="panel__note">how players came to this fate</span>
          </div>
          <ProgressionBars rows={acts.map((a) => ({ act: a, counts: d.stepsByAct[a - 1] }))} />
        </section>

        <section className="panel" aria-labelledby="wr-h">
          <div className="panel__head">
            <h2 id="wr-h" className="panel__title">
              Win rate over time
            </h2>
            <span className="panel__note">Act III finishes, cumulative</span>
          </div>
          <WinRateLine points={d.timeline} label={`${fate.name} win rate`} />
        </section>
      </div>

      {others.length ? (
        <section className="panel" aria-labelledby="set-h" style={{ marginTop: 22 }}>
          <div className="panel__head">
            <h2 id="set-h" className="panel__title">
              Card set
            </h2>
            <span className="panel__note">{others.length} cards</span>
          </div>
          <div className="card-set card-set--images">
            {setActs.map((a) => (
              <div key={a ?? "any"}>
                <h3 className="photo-act__title">{a ? `Act ${ROMAN[a as 1 | 2 | 3]}` : "Any act"}</h3>
                <ul className="card-grid card-grid--small">
                  {others
                    .filter((c) => c.act === a)
                    .map((c) => (
                      <li key={c.id}>
                        <Link href={`/cards/${c.id}`} className="card-grid__item">
                          <CardImage id={c.id} name={c.name} imageV={c.imageV} />
                          <span className="card-grid__name">{c.name}</span>
                          <span className="card-grid__meta">{c.type}</span>
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid-2 grid-2--even" style={{ marginTop: 22 }}>
        <SwitchTable id="from-h" title="Switched from" note="the fate held just before" rows={d.switchedFrom} qs={qs} />
        <SwitchTable id="to-h" title="Switched to" note="the fate taken next" rows={d.switchedTo} qs={qs} />
      </div>

      <section className="panel" aria-labelledby="games-h" style={{ marginTop: 22 }}>
        <div className="panel__head">
          <h2 id="games-h" className="panel__title">
            Campaigns
          </h2>
        </div>
        {d.games.length === 0 ? (
          <p className="empty">Nobody has played {fate.name} in a finished campaign yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">Date</th>
                  <th>Campaign</th>
                  <th>Player</th>
                  <th>Fate path</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {d.games.map((g) => (
                  <tr key={`${g.campaignId}:${g.playerId}`}>
                    <td className="num">{formatDate(g.playedOn)}</td>
                    <td>
                      <Link href={`/campaigns/${g.campaignId}`}>{g.title}</Link>
                    </td>
                    <td>
                      <Link href={`/players/${g.playerId}${qs}`}>{g.player}</Link>
                      {g.isGuest ? <span className="badge badge--guest">Guest</span> : null}
                    </td>
                    <td>
                      <FatePath steps={g.path} />
                    </td>
                    <td>{g.won ? <span className="badge badge--winner">Won</span> : <span className="muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function SwitchTable({ id, title, note, rows, qs }: { id: string; title: string; note: string; rows: FateSwitch[]; qs: string }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel__head">
        <h2 id={id} className="panel__title">
          {title}
        </h2>
        <span className="panel__note">{note}</span>
      </div>
      {rows.length === 0 ? (
        <p className="empty">No switches yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Fate</th>
                <th className="num">Times</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.fateId}>
                  <td>
                    <Link href={`/fates/${fateSlug(r.fate)}${qs}`} className="chip-link">
                      <FateChip fate={r.fate} tier={r.tier} />
                    </Link>
                  </td>
                  <td className="num">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
