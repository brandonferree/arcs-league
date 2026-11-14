import type { Metadata } from "next";
import Link from "next/link";
import { CardCell, HoldersWon } from "@/components/cardStats";
import { StatsFilterBar } from "@/components/StatsFilterBar";
import { getDb } from "@/db";
import { ACT_NOS, CARD_WIN_RATE_MIN_HOLDERS, loreGuildByAct, type ActNo, type CardActRow } from "@/lib/card-stats";
import { formatAvg, ROMAN } from "@/lib/format";
import { filterQuery, hasFilters, parseStatsFilters } from "@/lib/stats-filters";
import { listSeasons } from "@/server/campaigns";
import { loadTableaux } from "@/server/card-stats";

export const metadata: Metadata = { title: "Lore & Guild cards" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function CardStatsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filters = parseStatsFilters(sp);
  const actParam = Number(Array.isArray(sp.act) ? sp.act[0] : sp.act);
  const actNo: ActNo = actParam === 2 || actParam === 3 ? actParam : 1;
  const db = await getDb();
  const [tableaux, seasons] = await Promise.all([loadTableaux(db, filters), listSeasons(db)]);
  const byAct = loreGuildByAct(tableaux);
  const act = byAct[actNo - 1];
  const campaignsCounted = new Set(tableaux.map((t) => t.campaignId)).size;
  const qs = filterQuery(filters);

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">
          <Link href="/cards">Cards</Link>
        </div>
        <h1>Lore &amp; Guild</h1>
        <p className="lede">
          The Lore and Guild cards players held at the end of each act, from the cards recorded on their tableaux.
          Guild cards are the fates&rsquo; own Guild cards and the court&rsquo;s Guild cards.
        </p>
      </div>

      <section className="panel" aria-label="Filters">
        <StatsFilterBar filters={filters} seasons={seasons} action="/cards/stats" clearHref={`/cards/stats?act=${actNo}`}>
          <input type="hidden" name="act" value={actNo} />
        </StatsFilterBar>
        <p className="muted small" style={{ margin: "12px 0 0" }}>
          {hasFilters(filters) ? "Matching these filters: " : ""}
          {tableaux.length} recorded {tableaux.length === 1 ? "tableau" : "tableaux"} in {campaignsCounted}{" "}
          {campaignsCounted === 1 ? "campaign" : "campaigns"}. A tableau is one player at the end of one act; it counts
          once any card is recorded on it. In-progress campaigns count; void ones never do. Win rates use closed
          campaigns only, and are greyed under {CARD_WIN_RATE_MIN_HOLDERS} holders.
        </p>
      </section>

      {tableaux.length === 0 ? (
        <section className="panel">
          <p className="empty">
            {hasFilters(filters) ? "No recorded tableaux match these filters." : "No cards recorded yet."} Cards are added
            from each player&rsquo;s slot on a campaign page (&ldquo;Add cards&rdquo;).
          </p>
        </section>
      ) : (
        <>
          <section className="panel" aria-labelledby="avg-h">
            <div className="panel__head">
              <h2 id="avg-h" className="panel__title">
                Cards per player
              </h2>
              <span className="panel__note">Lore and Guild: average per recorded tableau</span>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Act</th>
                    <th className="num">Tableaux</th>
                    <th className="num">Lore</th>
                    <th className="num">Guild</th>
                  </tr>
                </thead>
                <tbody>
                  {byAct.map((a) => (
                    <tr key={a.actNo}>
                      <td>Act {ROMAN[a.actNo]}</td>
                      <td className="num">{a.tableaux}</td>
                      <td className="num">{formatAvg(a.avgLore)}</td>
                      <td className="num">{formatAvg(a.avgGuild)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <nav className="act-tabs" aria-label="Act">
            {ACT_NOS.map((n) => (
              <Link
                key={n}
                href={`/cards/stats${filterQuery(filters, { act: n })}`}
                className={`btn btn--small ${n === actNo ? "btn--cyan" : "btn--quiet"}`}
                aria-current={n === actNo ? "page" : undefined}
              >
                Act {ROMAN[n]}
              </Link>
            ))}
          </nav>

          <div className="grid-2 grid-2--even">
            <CardTable title="Lore" actNo={actNo} rows={act.lore} />
            <CardTable title="Guild" actNo={actNo} rows={act.guild} />
          </div>

          <p className="muted small" style={{ margin: 0 }}>
            See also <Link href={`/records${qs}`}>Records</Link> and the <Link href="/cards">card reference</Link>.
          </p>
        </>
      )}
    </>
  );
}

function CardTable({ title, actNo, rows }: { title: string; actNo: ActNo; rows: CardActRow[] }) {
  const id = `${title.toLowerCase()}-h`;
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel__head">
        <h2 id={id} className="panel__title">
          {title} cards
        </h2>
        <span className="panel__note">held at the end of Act {ROMAN[actNo]} · won = holders who won</span>
      </div>
      {rows.length === 0 ? (
        <p className="empty">
          No {title} cards recorded at the end of Act {ROMAN[actNo]}.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Card</th>
                <th className="num">Held</th>
                <th className="num" title="Holders in closed campaigns who won">Won</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <CardCell id={r.id} name={r.name} imageV={r.imageV} />
                  </td>
                  <td className="num">{r.held}</td>
                  <td className="num">
                    <HoldersWon wins={r.wins} holders={r.holders} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
