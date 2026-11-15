import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { PLATFORM_LABEL } from "@/lib/import/act-summary";
import { formatDateTime, ROMAN } from "@/lib/format";
import type { ActNumber } from "@/lib/rules";
import { listImports } from "@/server/imports";
import { getSession } from "@/server/session";

export const metadata: Metadata = { title: "Imports" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ImportsPage({ searchParams }: { searchParams: SP }) {
  const [session, sp] = await Promise.all([getSession(), searchParams]);
  if (!session) {
    return (
      <>
        <div className="page-head">
          <div className="eyebrow">Imports</div>
          <h1>Imported acts</h1>
        </div>
        <section className="panel">
          <p style={{ marginTop: 0 }}>Sign in with Discord to see acts waiting to be checked.</p>
          <a className="btn" href="/sign-in?next=/imports">
            Sign in with Discord
          </a>
        </section>
      </>
    );
  }

  const showAll = sp.all === "1";
  const rows = await listImports(await getDb(), showAll ? {} : { status: "pending" });

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Imports</div>
        <div className="page-head__row">
          <h1>Imported acts</h1>
          <Link className="btn btn--quiet btn--small" href={showAll ? "/imports" : "/imports?all=1"}>
            {showAll ? "Waiting only" : "Show all"}
          </Link>
        </div>
        <p className="lede">
          Acts sent from meeples. Most save on their own; these need a player to say who is who, or a moderator to sort
          out a clash with an act already saved.
        </p>
      </div>
      <section className="panel">
        <div className="table-wrap">
          {rows.length === 0 ? (
            <p className="empty">{showAll ? "No imports yet." : "Nothing is waiting."}</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Act</th>
                  <th>From</th>
                  <th>Players</th>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th className="num">Received</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/imports/${r.id}`}>Act {ROMAN[r.actNo as ActNumber]}</Link>
                    </td>
                    <td>{PLATFORM_LABEL[r.platform] ?? r.platform}</td>
                    <td>{r.players.join(", ")}</td>
                    <td>
                      {r.campaignId ? (
                        <Link href={`/campaigns/${r.campaignId}`}>{r.campaignTitle}</Link>
                      ) : (
                        <span className="muted">New campaign</span>
                      )}
                    </td>
                    <td>{r.status === "pending" ? "Waiting" : r.status === "saved" ? "Saved" : "Discarded"}</td>
                    <td className="num">{formatDateTime(r.receivedAt)}</td>
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
