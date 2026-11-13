import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FateChip, ProgressionLegend, ProgressionMark } from "@/components/fates";
import { StatusBadge } from "@/components/StatusBadge";
import { getDb } from "@/db";
import { formatDate, formatDateTime, joinNames, ROMAN } from "@/lib/format";
import { canEditAct, canRecordAct, editWindowEndsAt } from "@/lib/permissions";
import { progressionSteps, type ActNumber } from "@/lib/rules";
import { campaignHistory, getCampaign } from "@/server/campaigns";
import { getSession, toActor } from "@/server/session";
import { deleteCampaignAction, reopenCampaignAction, voidCampaignAction } from "../actions";

type Params = Promise<{ id: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

async function load(idParam: string) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return null;
  return getCampaign(await getDb(), id);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const c = await load((await params).id);
  return { title: c?.title ?? "Campaign" };
}

export default async function CampaignPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const [{ id }, sp, session] = await Promise.all([params, searchParams, getSession()]);
  const c = await load(id);
  if (!c) notFound();

  const actor = session ? toActor(session) : null;
  const now = new Date();
  const nextAct = (c.acts.length + 1) as ActNumber;
  const canRecord = c.acts.length < 3 && canRecordAct(actor, c.access);
  const winners = c.players.filter((p) => p.isWinner).map((p) => p.name);
  const error = typeof sp.error === "string" ? sp.error : null;
  const history = actor?.isModerator ? await campaignHistory(await getDb(), c.id) : [];
  const guildId = process.env.DISCORD_GUILD_ID;

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">
          Campaign #{c.id}
          {c.season ? ` · ${c.season.name}` : ""}
        </div>
        <div className="page-head__row">
          <h1>{c.title}</h1>
          {canRecord ? (
            <Link className="btn" href={`/campaigns/${c.id}/act/${nextAct}`}>
              Record Act {ROMAN[nextAct]}
            </Link>
          ) : null}
        </div>
        <div className="actions small muted">
          <StatusBadge status={c.status} stalled={c.stalled} />
          <span>{c.playerCount} players</span>
          <span>Started {formatDate(c.createdAt.toISOString().slice(0, 10))}</span>
          {c.createdBy ? <span>Logged by {c.createdBy}</span> : null}
          {c.discordThreadId && guildId ? (
            <a href={`https://discord.com/channels/${guildId}/${c.discordThreadId}`}>Discord thread</a>
          ) : null}
        </div>
      </div>

      {error ? (
        <ul className="errors" role="alert">
          <li>{error}</li>
        </ul>
      ) : null}
      {c.stalled ? (
        <p className="notice">
          Stalled: no new act for 60 days. Stalled campaigns are excluded from stats until a moderator reopens them.
        </p>
      ) : null}
      {c.status === "void" ? (
        <p className="notice">Void{c.voidReason ? `: ${c.voidReason}` : ""}. This campaign does not count anywhere.</p>
      ) : null}

      {c.status === "closed" && winners.length ? (
        <section className="panel" aria-label="Winner">
          <div className="kpi__label">{winners.length > 1 ? "Shared victory" : "Winner"}</div>
          <div className="kpi__value" style={{ color: "var(--gold)" }}>
            {joinNames(winners)}
          </div>
          {c.winnerOverridden ? (
            <div className="kpi__note">Winner chosen over the top Act III score: {c.winnerOverrideReason}</div>
          ) : (
            <div className="kpi__note">Highest Act III score{winners.length > 1 ? " (tied)" : ""}</div>
          )}
        </section>
      ) : null}

      <section className="panel panel--cyan" aria-labelledby="prog-h">
        <div className="panel__head">
          <h2 id="prog-h" className="panel__title">
            Fate progression
          </h2>
          <ProgressionLegend />
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Player</th>
                {([1, 2, 3] as const).map((n) => (
                  <th key={n}>Act {ROMAN[n]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.players.map((p) => {
                const results = ([1, 2, 3] as const).map((n) => c.acts.find((a) => a.actNo === n)?.results[p.cpId] ?? null);
                const steps = progressionSteps(results);
                return (
                  <tr key={p.cpId}>
                    <td>
                      <span className={p.isWinner ? "winner-name" : undefined} style={{ fontWeight: 600 }}>
                        {p.name}
                      </span>{" "}
                      {p.isGuest ? <span className="badge badge--guest">Guest</span> : null}{" "}
                      {p.isWinner ? <span className="badge badge--winner">Winner</span> : null}
                    </td>
                    {results.map((r, i) =>
                      r ? (
                        <td key={i}>
                          <div className="prog-cell">
                            <div className="prog-cell__row">
                              {steps[i] ? <ProgressionMark step={steps[i]} /> : null}
                              <FateChip fate={r.fate} tier={r.tier} />
                            </div>
                            <div className="prog-cell__row small">
                              <span className="prog-cell__score">{r.score} pts</span>
                              {i < 2 ? (
                                r.success ? (
                                  <span className="outcome outcome--ok">✓ Succeeded</span>
                                ) : (
                                  <span className="outcome outcome--fail">✗ Failed</span>
                                )
                              ) : null}
                              {r.seat ? <span className="muted">Seat {r.seat}</span> : null}
                            </div>
                          </div>
                        </td>
                      ) : (
                        <td key={i} className="muted">
                          –
                        </td>
                      ),
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="acts-h">
        <div className="panel__head">
          <h2 id="acts-h" className="panel__title">
            Acts
          </h2>
        </div>
        {c.acts.length === 0 ? (
          <p className="empty">No acts recorded yet.</p>
        ) : (
          <div className="card-list">
            {c.acts.map((a) => {
              const editable = canEditAct(actor, c.access, a.createdAt, now);
              const windowEnds = editWindowEndsAt(a.createdAt);
              return (
                <div key={a.id} className="card">
                  <div className="card__meta">
                    <span>
                      <strong style={{ color: "var(--text-strong)" }}>Act {ROMAN[a.actNo]}</strong> · played{" "}
                      {formatDate(a.playedOn)}
                    </span>
                    <span>
                      Saved {formatDateTime(a.createdAt)}
                      {a.createdBy ? ` by ${a.createdBy}` : ""}
                      {a.updatedAt.getTime() !== a.createdAt.getTime()
                        ? ` · edited ${formatDateTime(a.updatedAt)}${a.updatedBy ? ` by ${a.updatedBy}` : ""}`
                        : ""}
                    </span>
                  </div>
                  {a.vodUrl ? (
                    <div className="small">
                      <a href={a.vodUrl} rel="noopener nofollow ugc" target="_blank">
                        Watch the VOD
                      </a>
                    </div>
                  ) : null}
                  {a.notes ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{a.notes}</p> : null}
                  {editable ? (
                    <div className="actions small">
                      <Link className="btn btn--quiet btn--small" href={`/campaigns/${c.id}/act/${a.actNo}`}>
                        Edit Act {ROMAN[a.actNo]}
                      </Link>
                      <span className="muted">
                        {actor?.isModerator && now >= windowEnds
                          ? "Moderator edit"
                          : `Players can edit until ${formatDateTime(windowEnds)}`}
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {!session && c.status === "in_progress" ? (
          <p className="small muted" style={{ marginBottom: 0 }}>
            <a href={`/sign-in?next=/campaigns/${c.id}`}>Sign in</a> to record the next act.
          </p>
        ) : null}
      </section>

      {actor?.isModerator ? (
        <section className="panel" aria-labelledby="mod-h">
          <div className="panel__head">
            <h2 id="mod-h" className="panel__title">
              Moderator
            </h2>
          </div>
          <div className="form">
            {c.status !== "void" ? (
              <form action={voidCampaignAction} className="filters">
                <input type="hidden" name="campaignId" value={c.id} />
                <label className="field" style={{ flex: 1 }}>
                  <span className="field__label">Void with reason</span>
                  <input className="input" name="reason" required maxLength={300} />
                </label>
                <button className="btn btn--danger" type="submit">
                  Void campaign
                </button>
              </form>
            ) : null}
            {c.status === "void" || c.stalled ? (
              <form action={reopenCampaignAction}>
                <input type="hidden" name="campaignId" value={c.id} />
                <button className="btn btn--cyan" type="submit">
                  Reopen campaign
                </button>
              </form>
            ) : null}
            <form action={deleteCampaignAction} className="filters">
              <input type="hidden" name="campaignId" value={c.id} />
              <label className="field">
                <span className="field__label">Type &ldquo;delete&rdquo; to delete permanently</span>
                <input className="input" name="confirm" autoComplete="off" />
              </label>
              <button className="btn btn--danger" type="submit">
                Delete campaign
              </button>
            </form>
            <details className="history">
              <summary>Change history ({history.length})</summary>
              <ul className="history-list">
                {history.map((h) => (
                  <li key={h.id}>
                    <strong>{h.action}</strong> by {h.actor ?? "unknown"} · {formatDateTime(h.at)}
                    {h.before ? <pre>Before: {JSON.stringify(h.before, null, 1)}</pre> : null}
                    {h.after ? <pre>After: {JSON.stringify(h.after, null, 1)}</pre> : null}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </section>
      ) : null}
    </>
  );
}
