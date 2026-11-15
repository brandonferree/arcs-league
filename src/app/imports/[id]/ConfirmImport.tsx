"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { confirmImportAction, discardImportAction } from "../actions";

interface Row {
  index: number;
  name: string;
  matchId: number | null;
  via: "discord" | "alias" | "name" | null;
}

interface Option {
  id: number;
  name: string;
  isGuest: boolean;
}

const GUEST = "guest";

const VIA_NOTE: Record<NonNullable<Row["via"]>, string> = {
  discord: "matched by Discord account",
  alias: "matched from an earlier import",
  name: "same name; please check",
};

export function ConfirmImport(props: {
  importId: number;
  actNo: number;
  from: string;
  canConfirm: boolean;
  canDiscard: boolean;
  rows: Row[];
  options: Option[];
  newCampaign: boolean;
  campaignId: number | null;
}) {
  const { importId, from, rows, options, newCampaign } = props;
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [picks, setPicks] = useState<Record<number, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.index, r.matchId ? String(r.matchId) : newCampaign ? GUEST : ""])),
  );

  const chosenIds = rows.map((r) => picks[r.index]).filter((v) => v && v !== GUEST);
  const duplicate = new Set(chosenIds).size !== chosenIds.length;
  const complete = rows.every((r) => picks[r.index]);

  function confirm() {
    if (!complete) return setErrors(["Say who each player is."]);
    if (duplicate) return setErrors(["Two players cannot be the same person."]);
    setErrors([]);
    const choices = rows.map((r) =>
      picks[r.index] === GUEST ? { guestName: r.name } : { playerId: Number(picks[r.index]) },
    );
    startTransition(async () => {
      const res = await confirmImportAction(importId, choices);
      if (!res.ok) return setErrors(res.errors);
      router.push(`/campaigns/${res.data.campaignId}#act-${res.data.actNo}`);
      router.refresh();
    });
  }

  function discard() {
    if (!window.confirm("Discard this import? Nothing is saved, and it comes back if it is sent again.")) return;
    startTransition(async () => {
      const res = await discardImportAction(importId);
      if (!res.ok) return setErrors(res.errors);
      router.refresh();
    });
  }

  return (
    <section className="panel" aria-labelledby={`${id}-h`}>
      <div className="panel__head">
        <h2 id={`${id}-h`} className="panel__title">
          Who is who
        </h2>
      </div>
      {props.canConfirm ? (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            {newCampaign
              ? `Confirming creates the campaign with these players and saves Act I. Names on ${from} are remembered, so later acts save on their own.`
              : `Confirming saves the act as you. Names on ${from} are remembered, so later acts save on their own.`}{" "}
            To change a score or fate, confirm first and then edit the act within 24 hours.
          </p>
          <div className="field-row">
            {rows.map((r) => (
              <label key={r.index} className="field">
                <span className="field__label">{r.name}</span>
                <select
                  className="select"
                  value={picks[r.index]}
                  onChange={(e) => setPicks((p) => ({ ...p, [r.index]: e.target.value }))}
                  aria-invalid={(!picks[r.index] && errors.length > 0) || undefined}
                >
                  <option value="">Choose a player…</option>
                  {newCampaign ? <option value={GUEST}>New guest named “{r.name}”</option> : null}
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {o.isGuest ? " (guest)" : ""}
                    </option>
                  ))}
                </select>
                {r.via && picks[r.index] === String(r.matchId) ? (
                  <span className="field__hint">{VIA_NOTE[r.via]}</span>
                ) : null}
              </label>
            ))}
          </div>
        </>
      ) : null}

      {errors.length ? (
        <ul className="errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      <div className="actions" style={{ marginTop: 16 }}>
        {props.canConfirm ? (
          <button className="btn" type="button" onClick={confirm} disabled={pending}>
            {pending ? "Saving…" : newCampaign ? "Create campaign and save Act I" : "Confirm and save"}
          </button>
        ) : null}
        {props.canDiscard ? (
          <button className="btn btn--danger btn--small" type="button" onClick={discard} disabled={pending}>
            Discard
          </button>
        ) : null}
      </div>
    </section>
  );
}
