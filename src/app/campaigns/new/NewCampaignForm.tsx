"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { MAX_PLAYERS, MIN_PLAYERS, validateCampaign } from "@/lib/rules";
import { createCampaignAction } from "../actions";

interface Option {
  id: number;
  name: string;
  isGuest: boolean;
}

type Seat = { choice: string; guestName: string };

const GUEST = "guest";

export function NewCampaignForm({
  players,
  seasons,
  me,
}: {
  players: Option[];
  seasons: { id: number; name: string }[];
  me: number;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [seats, setSeats] = useState<Seat[]>(() => [
    { choice: players.some((p) => p.id === me) ? `p:${me}` : "", guestName: "" },
    ...Array.from({ length: MIN_PLAYERS - 1 }, () => ({ choice: "", guestName: "" })),
  ]);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const members = players.filter((p) => !p.isGuest);
  const guests = players.filter((p) => p.isGuest);

  const seatName = (s: Seat): string | null => {
    if (s.choice === GUEST) return s.guestName.trim() || null;
    if (s.choice.startsWith("p:")) return byId.get(Number(s.choice.slice(2)))?.name ?? null;
    return null;
  };

  const incomplete = seats.map((s, i) => (seatName(s) ? null : `Choose a player for seat ${i + 1}.`)).filter(Boolean) as string[];
  const named = seats.map(seatName).filter((n): n is string => !!n);
  const ruleErrors = validateCampaign(named.map((name) => ({ name })))
    .filter((v) => v.code !== "table-size" || named.length === seats.length)
    .map((v) => v.message);
  const liveErrors = [...ruleErrors, ...(submitted ? incomplete : [])];
  const canSubmit = incomplete.length === 0 && ruleErrors.length === 0 && !pending;

  function update(i: number, patch: Partial<Seat>) {
    setSeats((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setServerErrors([]);
    if (!canSubmit) return;
    startTransition(async () => {
      const r = await createCampaignAction({
        title,
        seasonId: seasonId ? Number(seasonId) : null,
        players: seats.map((s) =>
          s.choice === GUEST ? { guestName: s.guestName.trim() } : { playerId: Number(s.choice.slice(2)) },
        ),
      });
      if (r.ok) router.push(`/campaigns/${r.data.id}/act/1`);
      else setServerErrors(r.errors);
    });
  }

  const errors = [...liveErrors, ...serverErrors];

  return (
    <form className="form panel" onSubmit={submit} noValidate>
      <div className="field-row">
        <label className="field">
          <span className="field__label">Title</span>
          <input
            className="input"
            value={title}
            maxLength={120}
            placeholder="Leave blank to auto-generate"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {seasons.length ? (
          <label className="field">
            <span className="field__label">Season (optional)</span>
            <select className="select" value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
              <option value="">No season</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field__label" style={{ marginBottom: 6 }}>
          Players ({MIN_PLAYERS} or {MAX_PLAYERS})
        </legend>
        <p className="field__hint" style={{ marginTop: 0 }}>
          Pick members who have signed in, or add a guest by name. Guests appear in campaign records but not on the
          leaderboard.
        </p>
        {seats.map((s, i) => {
          const name = seatName(s);
          const dup = !!name && named.filter((n) => n.toLowerCase() === name.toLowerCase()).length > 1;
          return (
            <div key={i} className="field-row" style={{ alignItems: "end", marginTop: 10 }}>
              <label className="field">
                <span className="field__label">Seat {i + 1}</span>
                <select
                  className="select"
                  value={s.choice}
                  aria-invalid={dup || (submitted && !name) || undefined}
                  onChange={(e) => update(i, { choice: e.target.value })}
                >
                  <option value="">Choose a player…</option>
                  {members.length ? (
                    <optgroup label="Members">
                      {members.map((p) => (
                        <option key={p.id} value={`p:${p.id}`}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {guests.length ? (
                    <optgroup label="Guests">
                      {guests.map((p) => (
                        <option key={p.id} value={`p:${p.id}`}>
                          {p.name} (guest)
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  <option value={GUEST}>+ New guest…</option>
                </select>
              </label>
              {s.choice === GUEST ? (
                <label className="field">
                  <span className="field__label">Guest name</span>
                  <input
                    className="input"
                    value={s.guestName}
                    maxLength={40}
                    aria-invalid={dup || (submitted && !name) || undefined}
                    onChange={(e) => update(i, { guestName: e.target.value })}
                  />
                </label>
              ) : (
                <span />
              )}
              {seats.length > MIN_PLAYERS ? (
                <div>
                  <button
                    type="button"
                    className="btn btn--quiet btn--small"
                    onClick={() => setSeats((prev) => prev.filter((_, j) => j !== i))}
                  >
                    Remove seat
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
        {seats.length < MAX_PLAYERS ? (
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn--quiet btn--small"
              onClick={() => setSeats((prev) => [...prev, { choice: "", guestName: "" }])}
            >
              + Add a fourth player
            </button>
          </div>
        ) : null}
      </fieldset>

      {errors.length ? (
        <ul className="errors" role="alert">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}

      <div className="actions">
        <button className="btn" type="submit" disabled={pending || (submitted && !canSubmit)}>
          {pending ? "Creating…" : "Create campaign and record Act I"}
        </button>
      </div>
    </form>
  );
}
