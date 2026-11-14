import Link from "next/link";
import { CardImage } from "@/components/CardImage";
import type { PlayerCards, PlayerTableauCount } from "@/lib/card-stats";
import { formatAvg, formatDate, ROMAN } from "@/lib/format";

const KIND_LABEL = { lore: "Lore", guild: "Guild" } as const;

/** The cards a player held at the end of each act, across their campaigns. */
export function PlayerCardsPanel({ data, playerName, qs }: { data: PlayerCards; playerName: string; qs: string }) {
  return (
    <section className="panel" aria-labelledby="cards-h" style={{ marginTop: 22 }}>
      <div className="panel__head">
        <h2 id="cards-h" className="panel__title">
          Cards held
        </h2>
        <span className="panel__note">
          Lore and Guild: average per recorded tableau · <Link href={`/cards/stats${qs}`}>league Lore &amp; Guild stats</Link>
        </span>
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
            {data.byAct.map((a) => (
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

      {data.byAct.map((a) =>
        a.cards.length ? (
          <div key={a.actNo} style={{ marginTop: 22 }}>
            <h3 className="panel__title" style={{ margin: "0 0 12px" }}>
              Act {ROMAN[a.actNo]}
            </h3>
            <ul className="card-grid card-grid--small" aria-label={`${playerName}'s cards at the end of Act ${ROMAN[a.actNo]}`}>
              {a.cards.map((c) => (
                <li key={c.id}>
                  <Link href={`/cards/${c.id}`} className="card-grid__item">
                    <CardImage id={c.id} name={c.name} imageV={c.imageV} />
                    <span className="card-grid__name">{c.name}</span>
                    <span className="card-grid__meta">
                      {c.kind ? KIND_LABEL[c.kind] : c.type}
                      {c.count > 1 ? ` · ${c.count} games` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}

      <div className="table-wrap" style={{ marginTop: 22 }}>
        <table className="data">
          <thead>
            <tr>
              <th className="num">Date</th>
              <th>Campaign</th>
              <th>Act I</th>
              <th>Act II</th>
              <th>Act III</th>
            </tr>
          </thead>
          <tbody>
            {data.campaigns.map((c) => (
              <tr key={c.campaignId}>
                <td className="num">{formatDate(c.playedOn)}</td>
                <td>
                  <Link href={`/campaigns/${c.campaignId}`}>{c.title}</Link>
                  {c.won ? <> <span className="badge badge--winner">Won</span></> : null}
                  {!c.closed ? <div className="muted small">in progress</div> : null}
                </td>
                {c.acts.map((t, i) => (
                  <td key={i}>
                    <TableauCell count={t} href={`/campaigns/${c.campaignId}/tableau/${i + 1}/${c.campaignPlayerId}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TableauCell({ count, href }: { count: PlayerTableauCount | null; href: string }) {
  if (!count) return <span className="muted">–</span>;
  return (
    <Link href={href} className="tabular" style={{ whiteSpace: "nowrap" }}>
      {count.total} {count.total === 1 ? "card" : "cards"}
      <span className="muted small" style={{ display: "block", fontWeight: 400 }}>
        {count.lore} Lore · {count.guild} Guild
      </span>
    </Link>
  );
}
