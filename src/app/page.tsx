import Link from "next/link";
import { FatePath } from "@/components/fates";
import { getDb } from "@/db";
import { formatShortDate, joinNames } from "@/lib/format";
import { homeStats, listCampaigns } from "@/server/campaigns";

export default async function Home() {
  const db = await getDb();
  const [stats, latest, open] = await Promise.all([
    homeStats(db),
    listCampaigns(db, { status: "closed", limit: 5 }),
    listCampaigns(db, { status: "in_progress", limit: 6 }),
  ]);

  const kpis = [
    {
      label: "Campaigns",
      value: String(stats.closedCount),
      note: `${stats.inProgressCount} in progress`,
      tone: undefined,
    },
    {
      label: "Captains",
      value: String(stats.memberCount),
      note: `${stats.rankedCount} with a finished campaign`,
      tone: undefined,
    },
    {
      label: "Top Act III",
      value: stats.topAct3 ? String(stats.topAct3.score) : "–",
      note: stats.topAct3 ? `${stats.topAct3.player} · ${stats.topAct3.fate}` : "No finished campaigns yet",
      tone: "var(--cyan-light)",
    },
    {
      label: "Reigning champion",
      value: stats.champion?.name ?? "–",
      note: stats.champion ? `${stats.champion.wins} ${stats.champion.wins === 1 ? "win" : "wins"} in ${stats.champion.games}` : "Awaiting the first winner",
      tone: "var(--gold)",
    },
  ];

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">The Blighted Reach Chronicle</div>
        <h1>Three acts. One Reach.</h1>
        <p className="lede">
          Every campaign logged act by act: who chose which fate, who kept it, who broke it, and who ruled at the end.
        </p>
      </div>

      <section className="grid-kpi" aria-label="Headline numbers">
        {kpis.map((k) => (
          <div key={k.label} className="panel kpi">
            <div className="kpi__label">{k.label}</div>
            <div className="kpi__value" style={k.tone ? { color: k.tone } : undefined}>
              {k.value}
            </div>
            <div className="kpi__note">{k.note}</div>
          </div>
        ))}
      </section>

      <div className="grid-2">
        <section className="panel panel--cyan" aria-labelledby="latest-h">
          <div className="panel__head">
            <h2 id="latest-h" className="panel__title">
              Latest results
            </h2>
            <Link className="panel__note" href="/campaigns?status=closed">
              All results
            </Link>
          </div>
          {latest.length === 0 ? (
            <p className="empty">No finished campaigns yet. The Reach awaits.</p>
          ) : (
            <div className="card-list">
              {latest.map((c) => (
                <Link key={c.id} href={`/campaigns/${c.id}`} className="card">
                  <div className="card__meta">
                    <span>
                      {formatShortDate(c.lastPlayedOn)} · {c.playerCount} players
                    </span>
                    <span className="tabular">Act III · {c.topScore ?? "–"} pts</span>
                  </div>
                  <div className="card__title">
                    <span className="gold">{joinNames(c.winners)}</span>{" "}
                    <span className="muted small" style={{ fontWeight: 400 }}>
                      won {c.title}
                    </span>
                  </div>
                  {c.winnerPath.length ? <FatePath steps={c.winnerPath} /> : null}
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="open-h">
          <div className="panel__head">
            <h2 id="open-h" className="panel__title">
              Open campaigns
            </h2>
            <Link className="btn btn--small" href="/campaigns/new">
              Log a game
            </Link>
          </div>
          {open.length === 0 ? (
            <p className="empty">No campaigns in progress.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Players</th>
                    <th className="num">Acts</th>
                    <th className="num">Last played</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/campaigns/${c.id}`}>{c.title}</Link>
                      </td>
                      <td>{c.players.map((p) => p.name).join(", ")}</td>
                      <td className="num">{c.actsRecorded} / 3</td>
                      <td className="num">{formatShortDate(c.lastPlayedOn)}</td>
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
