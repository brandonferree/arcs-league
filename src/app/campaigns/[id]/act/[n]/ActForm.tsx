"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ROMAN } from "@/lib/format";
import {
  campaignWinners,
  resolveWinners,
  tierLookupFrom,
  validateCampaign,
  type ActEntry,
  type ActNumber,
  type PlayerRecord,
  type Tier,
} from "@/lib/rules";
import { saveActAction } from "../../../actions";

export interface FormFate {
  id: number;
  name: string;
  tier: Tier;
}
export interface FormPlayer {
  cpId: number;
  name: string;
}
type PriorEntry = { fate: string; success: boolean | null; score: number };

/** A whole number from -999 to 999: power can go negative after a failed objective. */
const SCORE_RE = /^-?\d{1,3}$/;
/** Keeps a leading minus and up to three digits. */
function cleanScore(value: string): string {
  const digits = value.replace(/[^\d]/g, "").slice(0, 3);
  return (value.trim().startsWith("-") ? "-" : "") + digits;
}
export interface ActFormProps {
  campaignId: number;
  actNo: ActNumber;
  isEdit: boolean;
  players: FormPlayer[];
  fates: FormFate[];
  /** Saved results of the other acts, keyed by act number then campaign player id. */
  otherActs: Partial<Record<ActNumber, Record<number, PriorEntry>>>;
  initial: {
    playedOn: string;
    vodUrl: string;
    notes: string;
    rows: Record<number, { fateId: number | null; score: number | null; success: boolean | null; seat: number | null }>;
    winners: number[] | null;
    winnerReason: string;
  };
}

interface Row {
  fateId: string;
  score: string;
  success: "" | "yes" | "no";
  seat: string;
}

const TIER_LABEL: Record<Tier, string> = { A: "Tier A", B: "Tier B", C: "Tier C" };

export function ActForm(props: ActFormProps) {
  const { campaignId, actNo, players, fates, otherActs, initial, isEdit } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [playedOn, setPlayedOn] = useState(initial.playedOn);
  const [vodUrl, setVodUrl] = useState(initial.vodUrl);
  const [notes, setNotes] = useState(initial.notes);
  const [rows, setRows] = useState<Record<number, Row>>(() =>
    Object.fromEntries(
      players.map((p) => {
        const r = initial.rows[p.cpId];
        return [
          p.cpId,
          {
            fateId: r?.fateId ? String(r.fateId) : "",
            score: r?.score != null ? String(r.score) : "",
            success: r?.success == null ? "" : r.success ? "yes" : "no",
            seat: r?.seat ? String(r.seat) : "",
          },
        ];
      }),
    ),
  );
  const [override, setOverride] = useState(initial.winners != null);
  const [winners, setWinners] = useState<number[]>(initial.winners ?? []);
  const [reason, setReason] = useState(initial.winnerReason);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  const fateById = useMemo(() => new Map(fates.map((f) => [String(f.id), f])), [fates]);
  const tierOf = useMemo(() => tierLookupFrom(fates), [fates]);
  const allowedTiers: readonly Tier[] = actNo === 1 ? ["A"] : actNo === 2 ? ["A", "B"] : ["A", "B", "C"];

  // ---- Build the rule-checker input from saved acts plus this form ----
  function recordsWith(current: Record<number, Row>): PlayerRecord[] {
    return players.map((p) => {
      const rec: PlayerRecord = { name: p.name };
      for (const n of [1, 2, 3] as const) {
        let entry: ActEntry | undefined;
        if (n === actNo) {
          const r = current[p.cpId];
          const f = fateById.get(r.fateId);
          if (f) entry = { fate: f.name, success: r.success === "" ? null : r.success === "yes", score: Number(r.score) || 0 };
        } else {
          const prior = otherActs[n]?.[p.cpId];
          if (prior) entry = prior;
        }
        if (entry) rec[`act${n}`] = entry;
      }
      return rec;
    });
  }

  const violations = validateCampaign(recordsWith(rows), tierOf).filter((v) => v.code !== "table-size");
  const invalidNames = new Set(violations.flatMap((v) => v.players ?? []));

  /**
   * An option is blocked if picking it would add a rule violation for that
   * player, compared with the current selection. (A blank selection is not a
   * neutral baseline: when editing Act I, a blank already "breaks" a kept fate
   * in Act II.)
   */
  function blockedReason(cpId: number, fateId: string): string | null {
    const name = players.find((p) => p.cpId === cpId)!.name;
    const before = new Set(validateCampaign(recordsWith(rows), tierOf).map((v) => v.message));
    const added = validateCampaign(recordsWith({ ...rows, [cpId]: { ...rows[cpId], fateId } }), tierOf).filter(
      (v) => !before.has(v.message) && (v.players ?? []).includes(name),
    );
    if (!added.length) return null;
    const shared = added.find((v) => v.code === "fate-shared");
    if (shared) return `taken by ${shared.players!.filter((n) => n !== name).join(", ")}`;
    const later = added.find((v) => v.act && v.act > actNo);
    if (later) return `conflicts with Act ${ROMAN[later.act!]}`;
    const codes = new Set(added.map((v) => v.code));
    if (codes.has("continued-after-failure")) return "failed last act";
    if (codes.has("returned-to-dropped")) return "dropped earlier";
    if (codes.has("a-fate-not-continued")) return "only as a continuation";
    return "not allowed";
  }

  // ---- Field completeness ----
  const fieldErrors: string[] = [];
  const incompleteNames = new Set<string>();
  for (const p of players) {
    const r = rows[p.cpId];
    const missing: string[] = [];
    if (!fateById.has(r.fateId)) missing.push("fate");
    if (!SCORE_RE.test(r.score.trim())) missing.push("score (a whole number; use ± for a negative score)");
    if (actNo < 3 && r.success === "") missing.push("whether the fate succeeded");
    if (missing.length) {
      incompleteNames.add(p.name);
      fieldErrors.push(`${p.name}: enter ${missing.join(", ")}.`);
    }
  }
  const seats = players.map((p) => rows[p.cpId].seat).filter(Boolean);
  if (new Set(seats).size !== seats.length) fieldErrors.push("Two players cannot share a seat.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(playedOn)) fieldErrors.push("Enter the date the act was played.");
  if (vodUrl.trim() && !/^https?:\/\/\S+$/i.test(vodUrl.trim())) fieldErrors.push("VOD link must start with http:// or https://.");

  // ---- Winner (Act III) ----
  const scoresComplete = players.every((p) => SCORE_RE.test(rows[p.cpId].score.trim()));
  const act3 = players.map((p) => ({ name: p.name, score: Number(rows[p.cpId].score) }));
  const defaultWinnerNames = actNo === 3 && scoresComplete ? campaignWinners(act3) : [];
  const winnerDecision =
    actNo === 3 && scoresComplete
      ? resolveWinners(
          act3,
          override ? players.filter((p) => winners.includes(p.cpId)).map((p) => p.name) : null,
          reason,
        )
      : null;
  const winnerErrors = winnerDecision?.errors ?? [];

  const blocking = [...violations.map((v) => v.message), ...fieldErrors, ...winnerErrors];
  const shownErrors = [
    ...violations.map((v) => v.message),
    ...winnerErrors,
    ...(submitted ? fieldErrors : []),
    ...serverErrors,
  ];

  function setRow(cpId: number, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [cpId]: { ...prev[cpId], ...patch } }));
    setServerErrors([]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setServerErrors([]);
    if (blocking.length) return;
    startTransition(async () => {
      const r = await saveActAction(campaignId, actNo, {
        playedOn,
        vodUrl: vodUrl.trim(),
        notes: notes.trim(),
        results: players.map((p) => {
          const row = rows[p.cpId];
          return {
            campaignPlayerId: p.cpId,
            fateId: Number(row.fateId),
            score: Number(row.score),
            success: actNo < 3 ? row.success === "yes" : null,
            seat: row.seat ? Number(row.seat) : null,
          };
        }),
        winners: actNo === 3 && override ? winners : null,
        winnerReason: actNo === 3 && override ? reason.trim() : "",
      });
      if (r.ok) {
        router.push(`/campaigns/${campaignId}`);
        router.refresh();
      } else {
        setServerErrors(r.errors);
      }
    });
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <section className="panel" aria-labelledby="act-details-h">
        <div className="panel__head">
          <h2 id="act-details-h" className="panel__title">
            Act {ROMAN[actNo]} details
          </h2>
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field__label">Date played</span>
            <input className="input" type="date" required value={playedOn} onChange={(e) => setPlayedOn(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">VOD link (optional)</span>
            <input
              className="input"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={vodUrl}
              maxLength={500}
              onChange={(e) => setVodUrl(e.target.value)}
            />
          </label>
        </div>
        <label className="field" style={{ marginTop: 16 }}>
          <span className="field__label">Notes (optional)</span>
          <textarea className="textarea" value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <p className="small muted" style={{ margin: "12px 0 0" }}>
          Photos of the board and of each player&rsquo;s tableau are added on the campaign page once the act is saved.
        </p>
      </section>

      <section className="panel panel--cyan" aria-labelledby="results-h">
        <div className="panel__head">
          <h2 id="results-h" className="panel__title">
            Results
          </h2>
          <span className="panel__note">
            Act {ROMAN[actNo]} allows tier {allowedTiers.join(", ")} fates
            {actNo > 1 ? "; A fates only if kept from the last act" : ""}.
          </span>
        </div>
        {players.map((p) => {
          const r = rows[p.cpId];
          const prev = actNo > 1 ? otherActs[(actNo - 1) as ActNumber]?.[p.cpId] : undefined;
          const invalid = invalidNames.has(p.name) || (submitted && incompleteNames.has(p.name));
          const id = `p${p.cpId}`;
          return (
            <div key={p.cpId} className="player-block" data-invalid={invalid || undefined}>
              <div className="player-block__name">
                {p.name}
                {prev ? (
                  <div className="small muted" style={{ fontWeight: 400 }}>
                    Act {ROMAN[(actNo - 1) as ActNumber]}: {prev.fate} ·{" "}
                    {prev.success ? "succeeded" : "failed"}
                  </div>
                ) : null}
              </div>
              <label className="field player-block__fate">
                <span className="field__label">Fate</span>
                <select
                  className="select"
                  value={r.fateId}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => setRow(p.cpId, { fateId: e.target.value })}
                >
                  <option value="">Choose a fate…</option>
                  {allowedTiers.map((tier) => (
                    <optgroup key={tier} label={TIER_LABEL[tier]}>
                      {fates
                        .filter((f) => f.tier === tier)
                        .map((f) => {
                          const why = String(f.id) === r.fateId ? null : blockedReason(p.cpId, String(f.id));
                          const kept = prev?.fate === f.name;
                          return (
                            <option key={f.id} value={f.id} disabled={!!why}>
                              {f.tier} · {f.name}
                              {kept ? " (keep)" : ""}
                              {why ? ` (${why})` : ""}
                            </option>
                          );
                        })}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Score</span>
                <span className="score-entry">
                  <input
                    className="input input--score"
                    inputMode="numeric"
                    value={r.score}
                    aria-invalid={(submitted && !SCORE_RE.test(r.score.trim())) || undefined}
                    onChange={(e) => setRow(p.cpId, { score: cleanScore(e.target.value) })}
                  />
                  <button
                    type="button"
                    className="btn btn--quiet btn--small"
                    aria-label={`Make ${p.name}'s score ${r.score.startsWith("-") ? "positive" : "negative"}`}
                    title="Switch between positive and negative"
                    onClick={() =>
                      setRow(p.cpId, { score: r.score.startsWith("-") ? r.score.slice(1) : `-${r.score}` })
                    }
                  >
                    ±
                  </button>
                </span>
              </label>
              {actNo < 3 ? (
                <div className="field" role="radiogroup" aria-labelledby={`${id}-succ`}>
                  <span className="field__label" id={`${id}-succ`}>
                    Fate succeeded?
                  </span>
                  <div className="seg">
                    <label>
                      <input
                        type="radio"
                        name={`${id}-success`}
                        checked={r.success === "yes"}
                        onChange={() => setRow(p.cpId, { success: "yes" })}
                      />
                      <span>✓ Yes</span>
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={`${id}-success`}
                        checked={r.success === "no"}
                        onChange={() => setRow(p.cpId, { success: "no" })}
                      />
                      <span>✗ No</span>
                    </label>
                  </div>
                </div>
              ) : (
                <span />
              )}
              <label className="field">
                <span className="field__label">Seat (optional)</span>
                <select className="select" value={r.seat} onChange={(e) => setRow(p.cpId, { seat: e.target.value })}>
                  <option value="">–</option>
                  {players.map((_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          );
        })}
      </section>

      {actNo === 3 ? (
        <section className="panel" aria-labelledby="winner-h">
          <div className="panel__head">
            <h2 id="winner-h" className="panel__title">
              Winner
            </h2>
          </div>
          <p style={{ marginTop: 0 }}>
            {scoresComplete ? (
              <>
                Highest Act III score:{" "}
                <span className="winner-name">{defaultWinnerNames.join(" and ")}</span>
                {defaultWinnerNames.length > 1 ? " (a tie shares the win)" : ""}.
              </>
            ) : (
              <span className="muted">Enter every score to see the default winner.</span>
            )}
          </p>
          <label className="check">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            The winner is someone else (for example, a C fate won on its objective)
          </label>
          {override ? (
            <div className="form" style={{ marginTop: 16 }}>
              <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="field__label">Winner(s)</legend>
                <div className="actions" style={{ marginTop: 8 }}>
                  {players.map((p) => (
                    <label key={p.cpId} className="check">
                      <input
                        type="checkbox"
                        checked={winners.includes(p.cpId)}
                        onChange={(e) =>
                          setWinners((prev) => (e.target.checked ? [...prev, p.cpId] : prev.filter((x) => x !== p.cpId)))
                        }
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="field">
                <span className="field__label">Reason</span>
                <input
                  className="input"
                  value={reason}
                  maxLength={500}
                  placeholder="Why the winner is not the top Act III score"
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </div>
          ) : null}
        </section>
      ) : null}

      {shownErrors.length ? (
        <ul className="errors" role="alert" aria-live="polite">
          {shownErrors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : blocking.length === 0 ? (
        <p className="ok-note" aria-live="polite">
          ✓ Everything checks out against the fate rules.
        </p>
      ) : null}

      <div className="actions">
        <button className="btn" type="submit" disabled={pending || (submitted && blocking.length > 0)}>
          {pending ? "Saving…" : isEdit ? `Save changes to Act ${ROMAN[actNo]}` : actNo === 3 ? "Save Act III and close campaign" : `Save Act ${ROMAN[actNo]}`}
        </button>
        <Link className="btn btn--quiet" href={`/campaigns/${campaignId}`}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
