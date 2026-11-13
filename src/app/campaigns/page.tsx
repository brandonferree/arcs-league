import type { Metadata } from "next";
import Link from "next/link";
import { FatePath } from "@/components/fates";
import { StatusBadge } from "@/components/StatusBadge";
import { getDb } from "@/db";
import { formatDate, joinNames } from "@/lib/format";
import { listCampaigns, listSeasons, type StatusFilter } from "@/server/campaigns";

export const metadata: Metadata = { title: "Campaigns" };

const STATUSES: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "closed", label: "Closed" },
  { value: "in_progress", label: "In progress" },
  { value: "stalled", label: "Stalled" },
  { value: "void", label: "Void" },
];

type SP = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function CampaignsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const status = (STATUSES.find((s) => s.value === one(sp.status))?.value ?? "all") as StatusFilter;
  const seasonId = Number(one(sp.season)) || null;
  const pc = Number(one(sp.players));
  const playerCount = pc === 3 || pc === 4 ? pc : null;

  const db = await getDb();
  const [rows, seasons] = await Promise.all([listCampaigns(db, { status, seasonId, playerCount }), listSeasons(db)]);

  return (
    <>
      <div className="page-head">
        <div className="page-head__row">
          <div className="page-head">
            <div className="eyebrow">Chronicle</div>
            <h1>Campaigns</h1>
          </div>
          <Link className="btn" href="/campaigns/new">
            Log a game
          </Link>
        </div>
        <p className="lede">
          Stalled campaigns (no new act for 60 days), void campaigns and campaigns still in progress never count in
          stats.
        </p>
      </div>

      <section className="panel" aria-label="Campaign list">
        <form className="filters" method="get">
          <label className="field">
            <span className="field__label">Status</span>
            <select className="select" name="status" defaultValue={status}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {seasons.length ? (
            <label className="field">
              <span className="field__label">Season</span>
              <select className="select" name="season" defaultValue={seasonId ?? ""}>
                <option value="">All seasons</option>
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
            <select className="select" name="players" defaultValue={playerCount ?? ""}>
              <option value="">3 or 4</option>
              <option value="3">3 players</option>
              <option value="4">4 players</option>
            </select>
          </label>
          <button className="btn btn--cyan" type="submit">
            Filter
          </button>
        </form>

        <div className="table-wrap" style={{ marginTop: 20 }}>
          {rows.length === 0 ? (
            <p className="empty">No campaigns match.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Players</th>
                  <th>Winner</th>
                  <th>Winning path</th>
                  <th className="num">Top III</th>
                  <th className="num">Acts</th>
                  <th className="num">Last played</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/campaigns/${c.id}`}>{c.title}</Link>
                      {c.season ? <div className="muted small">{c.season}</div> : null}
                    </td>
                    <td>
                      <StatusBadge status={c.status} stalled={c.stalled} />
                    </td>
                    <td>{c.players.map((p) => p.name).join(", ")}</td>
                    <td className="winner-name">{c.winners.length ? joinNames(c.winners) : <span className="muted">–</span>}</td>
                    <td>{c.winnerPath.length ? <FatePath steps={c.winnerPath} /> : <span className="muted">–</span>}</td>
                    <td className="num">{c.topScore ?? "–"}</td>
                    <td className="num">{c.actsRecorded} / 3</td>
                    <td className="num">{formatDate(c.lastPlayedOn)}</td>
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
