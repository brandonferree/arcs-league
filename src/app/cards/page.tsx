import type { Metadata } from "next";
import Link from "next/link";
import { FateChip } from "@/components/fates";
import { getDb } from "@/db";
import { productName, ROMAN } from "@/lib/format";
import { cardCount, cardTypes, listCards } from "@/server/cards";
import { listStatFates } from "@/server/stats";
import { getSession } from "@/server/session";

export const metadata: Metadata = { title: "Cards" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function CardsPage({ searchParams }: { searchParams: SP }) {
  const [sp, session] = await Promise.all([searchParams, getSession()]);
  const q = one(sp.q)?.slice(0, 80) ?? "";
  const type = one(sp.type) ?? "";
  const fateId = Number(one(sp.fate)) || undefined;
  const db = await getDb();
  const [total, types, fates] = await Promise.all([cardCount(db), cardTypes(db), listStatFates(db)]);
  const rows = total ? await listCards(db, { q, type: type || undefined, fateId }) : [];
  const filtered = !!(q || type || fateId);

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Reference</div>
        <div className="page-head__row">
          <h1>Cards</h1>
          {session?.isModerator ? (
            <Link className="btn btn--quiet" href="/admin/cards">
              Card import
            </Link>
          ) : null}
        </div>
        <p className="lede">
          Every ARCS card except setup cards and player aids, from{" "}
          <a href="https://cards.buriedgiant.com/" rel="noopener">
            Buried Giant Studios&rsquo; card database
          </a>{" "}
          with their permission. &ldquo;Seen&rdquo; counts tableau photos where members tagged the card; &ldquo;Holders
          won&rdquo; is how many of the players holding it in a closed campaign went on to win.
        </p>
      </div>

      {total === 0 ? (
        <section className="panel">
          <p className="empty">
            No cards yet: a moderator imports them from Buried Giant Studios&rsquo; database
            {session?.isModerator ? (
              <>
                {" "}
                on the <Link href="/admin/cards">card import</Link> page
              </>
            ) : null}
            .
          </p>
        </section>
      ) : (
        <>
          <section className="panel" aria-label="Filters">
            <form className="filters" method="get" action="/cards">
              <label className="field">
                <span className="field__label">Search</span>
                <input className="input" type="search" name="q" defaultValue={q} placeholder="Name or rules text" maxLength={80} />
              </label>
              <label className="field">
                <span className="field__label">Type</span>
                <select className="select" name="type" defaultValue={type}>
                  <option value="">All types</option>
                  {types.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.type} ({t.n})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Fate</span>
                <select className="select" name="fate" defaultValue={fateId ? String(fateId) : ""}>
                  <option value="">Any or none</option>
                  {fates.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.tier})
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn--cyan" type="submit">
                Filter
              </button>
              {filtered ? (
                <Link className="btn btn--quiet" href="/cards">
                  Clear
                </Link>
              ) : null}
            </form>
            <p className="muted small" style={{ margin: "12px 0 0" }}>
              {rows.length} of {total} cards.
            </p>
          </section>

          <section className="panel" aria-label="Cards" style={{ marginTop: 22 }}>
            {rows.length === 0 ? (
              <p className="empty">No cards match.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Card</th>
                      <th>Type</th>
                      <th>Fate</th>
                      <th className="num">Act</th>
                      <th className="num">Keys</th>
                      <th className="num">Seen</th>
                      <th className="num">Holders won</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/cards/${c.id}`} style={{ fontWeight: 600 }}>
                            {c.name}
                          </Link>
                          <div className="muted small">{productName(c.product)}</div>
                        </td>
                        <td>{c.type}</td>
                        <td>{c.fate ? <FateChip fate={c.fate.name} tier={c.fate.tier} /> : <span className="muted">–</span>}</td>
                        <td className="num">{c.act ? ROMAN[c.act as 1 | 2 | 3] : "–"}</td>
                        <td className="num">{c.keys ?? "–"}</td>
                        <td className="num">{c.stats.tagged || "–"}</td>
                        <td className="num">{c.stats.holders ? `${c.stats.wins} of ${c.stats.holders}` : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
