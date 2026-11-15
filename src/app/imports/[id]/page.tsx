import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { PLATFORM_LABEL } from "@/lib/import/act-summary";
import { formatDate, formatDateTime, ROMAN } from "@/lib/format";
import { canRecordAct } from "@/lib/permissions";
import { canDiscardImport, getImport } from "@/server/imports";
import { getSession, toActor } from "@/server/session";
import { ConfirmImport } from "./ConfirmImport";

type Params = Promise<{ id: string }>;

export const metadata: Metadata = { title: "Imported act" };

export default async function ImportPage({ params }: { params: Params }) {
  const [{ id }, session] = await Promise.all([params, getSession()]);
  if (!session) {
    return (
      <>
        <div className="page-head">
          <div className="eyebrow">Import</div>
          <h1>Imported act</h1>
        </div>
        <section className="panel">
          <p style={{ marginTop: 0 }}>Sign in with Discord to check this imported act.</p>
          <a className="btn" href={`/sign-in?next=/imports/${encodeURIComponent(id)}`}>
            Sign in with Discord
          </a>
        </section>
      </>
    );
  }
  const n = Number(id);
  const imp = Number.isInteger(n) && n > 0 ? await getImport(await getDb(), n) : null;
  if (!imp) notFound();

  const actor = toActor(session);
  const from = PLATFORM_LABEL[imp.platform] ?? imp.platform;
  // A waiting import whose act is already saved is a clash: it can only be discarded.
  const clash = imp.status === "pending" && !!imp.campaign && imp.actId != null;
  const canConfirm =
    imp.status === "pending" && !clash && (imp.access ? canRecordAct(actor, imp.access) || actor.isModerator : true);
  const canDiscard = imp.status === "pending" && canDiscardImport(actor, imp.access);

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">
          Import from {from} · <Link href="/imports">All imports</Link>
        </div>
        <h1>
          Act {ROMAN[imp.actNo]} {imp.campaign ? `of ${imp.campaign.title}` : "of a new campaign"}
        </h1>
        <div className="actions small muted">
          <span>Played {formatDate(imp.datePlayed)}</span>
          <span>Received {formatDateTime(imp.receivedAt)}</span>
          {imp.sourceUrl ? <a href={imp.sourceUrl}>Game on {from}</a> : null}
          {imp.campaign ? <Link href={`/campaigns/${imp.campaign.id}`}>Campaign page</Link> : null}
        </div>
      </div>

      {imp.status === "saved" ? (
        <p className="notice">
          Saved{imp.resolvedBy ? ` by ${imp.resolvedBy}` : " automatically"}
          {imp.resolvedAt ? ` on ${formatDateTime(imp.resolvedAt)}` : ""}.{" "}
          {imp.campaign ? <Link href={`/campaigns/${imp.campaign.id}#act-${imp.actNo}`}>See the act</Link> : null}
        </p>
      ) : imp.status === "discarded" ? (
        <p className="notice">
          Discarded{imp.resolvedBy ? ` by ${imp.resolvedBy}` : ""}
          {imp.resolvedAt ? ` on ${formatDateTime(imp.resolvedAt)}` : ""}. Sending it again from {from} brings it back.
        </p>
      ) : null}

      {imp.problems.length ? (
        <section className="panel" aria-labelledby="why-h">
          <div className="panel__head">
            <h2 id="why-h" className="panel__title">
              {imp.status === "pending" ? "Why it is waiting" : "Notes"}
            </h2>
          </div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {imp.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel panel--cyan" aria-labelledby="res-h">
        <div className="panel__head">
          <h2 id="res-h" className="panel__title">
            Results as sent
          </h2>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name on {from}</th>
                <th>Colour</th>
                <th>Fate</th>
                <th className="num">Score</th>
                <th>{imp.actNo < 3 ? "Fate succeeded" : "Winner"}</th>
                <th className="num">Seat</th>
                <th>Cards held</th>
              </tr>
            </thead>
            <tbody>
              {imp.rows.map((r) => (
                <tr key={r.index}>
                  <td>{r.name}</td>
                  <td>{r.color ?? "–"}</td>
                  <td>{r.fate}</td>
                  <td className="num">{r.score}</td>
                  <td>{imp.actNo < 3 ? (r.success ? "Yes" : "No") : r.winner ? "Winner" : "–"}</td>
                  <td className="num">{r.seat ?? "–"}</td>
                  <td className="small">{r.tableau.length ? r.tableau.join(", ") : <span className="muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {imp.notes ? <p className="small muted">{imp.notes}</p> : null}
      </section>

      {canConfirm || canDiscard ? (
        <ConfirmImport
          importId={imp.id}
          actNo={imp.actNo}
          from={from}
          canConfirm={canConfirm}
          canDiscard={canDiscard}
          rows={imp.rows.map((r) => ({ index: r.index, name: r.name, matchId: r.match?.playerId ?? null, via: r.match?.via ?? null }))}
          options={
            imp.campaign
              ? imp.campaign.players.map((p) => ({ id: p.playerId, name: p.name, isGuest: false }))
              : imp.choices
          }
          newCampaign={!imp.campaign}
          campaignId={imp.campaign?.id ?? null}
        />
      ) : imp.status === "pending" ? (
        <p className="notice">Only players in this campaign or moderators can confirm it.</p>
      ) : null}
    </>
  );
}
