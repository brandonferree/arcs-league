"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useState, useTransition } from "react";
import { cardImageUrl, type PickerGroup } from "@/lib/cards";
import type { TableauRef } from "@/server/cards";
import { addCardTagAction } from "./actions";

/** Search and add cards to a player's tableau. The player's own fate cards come first. */
export function CardPicker({ tableau, groups }: { tableau: TableauRef; groups: PickerGroup[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const shown = groups
    .map((g) => ({ ...g, cards: q ? g.cards.filter((c) => c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q) || !!c.fate?.toLowerCase().includes(q)) : g.cards }))
    .filter((g) => g.cards.length);

  async function add(cardId: string) {
    setBusy(cardId);
    setError(null);
    const r = await addCardTagAction(tableau, cardId);
    if (!r.ok) setError(r.error);
    startTransition(() => {
      router.refresh();
      setBusy(null);
    });
  }

  return (
    <div className="picker">
      <label className="field">
        <span className="field__label">Find a card</span>
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, type or fate, e.g. Lore"
          autoComplete="off"
        />
      </label>
      {error ? (
        <p className="photo-upload__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="picker__groups">
        {shown.length === 0 ? <p className="muted small">No cards match.</p> : null}
        {shown.map((g) => (
          <section key={g.key} className="picker__group" aria-label={g.label}>
            <h3 className="photo-act__title">{g.label}</h3>
            <ul className="picker__list">
              {g.cards.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="picker__card"
                    disabled={busy !== null}
                    onClick={() => add(c.id)}
                    aria-label={`Add ${c.name}, ${c.type}${g.key !== "fate" && c.fate ? `, ${c.fate}` : ""}`}
                  >
                    <span className="picker__plus" aria-hidden="true">
                      {busy === c.id ? "…" : "+"}
                    </span>
                    {c.imageV ? (
                      <img
                        className="picker__thumb"
                        src={cardImageUrl(c.id, "thumb", c.imageV)!}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        width={240}
                        height={335}
                      />
                    ) : (
                      <span className="picker__thumb picker__thumb--none" aria-hidden="true" />
                    )}
                    <span className="picker__name">{c.name}</span>
                    <span className="picker__type">
                      {c.type}
                      {g.key !== "fate" && c.fate ? ` · ${c.fate}` : ""}
                      {c.act ? ` · ${["I", "II", "III"][c.act - 1] ?? c.act}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
