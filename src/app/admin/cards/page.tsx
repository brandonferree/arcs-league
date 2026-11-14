import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import type { CardImportPlan } from "@/lib/cards";
import { formatDateTime } from "@/lib/format";
import { cardCount, cardImagesWaiting, fetchUpstreamCards, lastCardImport, previewCardImport } from "@/server/cards";
import { RuleError } from "@/server/campaigns";
import { getSession } from "@/server/session";
import { importCardsAction } from "./actions";
import { CopyImages } from "./CopyImages";

export const metadata: Metadata = { title: "Card import" };

type SP = Promise<Record<string, string | string[] | undefined>>;

function NameList({ title, items, link }: { title: string; items: { id: string; name: string }[]; link?: boolean }) {
  if (!items.length) return null;
  const shown = items.slice(0, 60);
  return (
    <div>
      <h3 className="photo-act__title">
        {title} ({items.length})
      </h3>
      <p className="small" style={{ margin: 0 }}>
        {shown.map((c, i) => (
          <span key={c.id}>
            {i > 0 ? ", " : ""}
            {link ? <Link href={`/cards/${c.id}`}>{c.name}</Link> : c.name}
          </span>
        ))}
        {items.length > shown.length ? `, and ${items.length - shown.length} more` : ""}
      </p>
    </div>
  );
}

async function check(): Promise<{ plan: CardImportPlan; skipped: number } | { error: string }> {
  try {
    const upstream = await fetchUpstreamCards();
    return { plan: await previewCardImport(await getDb(), upstream), skipped: upstream.skipped };
  } catch (err) {
    if (err instanceof RuleError) return { error: err.errors.join(" ") };
    console.error(err);
    return { error: "Buried Giant's card database could not be reached. Please try again later." };
  }
}

export default async function CardImportPage({ searchParams }: { searchParams: SP }) {
  const [sp, session] = await Promise.all([searchParams, getSession()]);
  const head = (
    <div className="page-head">
      <div className="eyebrow">Moderation</div>
      <h1>Card import</h1>
      <p className="lede">
        Cards are copied from{" "}
        <a href="https://cards.buriedgiant.com/" rel="noopener">
          Buried Giant Studios&rsquo; card database
        </a>{" "}
        with their permission, only when a moderator asks: the site never checks for updates on its own. Setup cards and
        player aids are left out. After an import, copy the card images: the site shows its own copies, never Buried
        Giant&rsquo;s links.
      </p>
    </div>
  );

  if (!session?.isModerator) {
    return (
      <>
        {head}
        <section className="panel">
          <p className="empty">
            {session ? "Only moderators can import cards." : (
              <>
                Moderators import cards. <Link href="/sign-in?next=/admin/cards">Sign in</Link> first.
              </>
            )}
          </p>
        </section>
      </>
    );
  }

  const db = await getDb();
  const [count, last, waiting] = await Promise.all([cardCount(db), lastCardImport(db), cardImagesWaiting(db)]);
  const error = typeof sp.error === "string" ? sp.error : null;
  const notice = typeof sp.notice === "string" ? sp.notice : null;
  const result = sp.check === "1" ? await check() : null;

  return (
    <>
      {head}
      {error ? (
        <ul className="errors" role="alert">
          <li>{error}</li>
        </ul>
      ) : null}
      {notice ? (
        <p className="ok-note" role="status">
          {notice}
        </p>
      ) : null}

      <section className="panel" aria-labelledby="now-h">
        <div className="panel__head">
          <h2 id="now-h" className="panel__title">
            On this site
          </h2>
          <Link className="panel__note" href="/cards">
            Card reference
          </Link>
        </div>
        <p style={{ marginTop: 0 }}>
          {count} cards.{" "}
          {last ? (
            <>
              Last imported {formatDateTime(last.at)}
              {last.by ? ` by ${last.by}` : ""}
              {last.version ? (
                <span className="muted tabular"> (Buried Giant data {last.version.slice(0, 8)})</span>
              ) : null}
              .
            </>
          ) : (
            "Never imported."
          )}
        </p>
        {count ? (
          <div style={{ margin: "0 0 16px" }}>
            <CopyImages key={waiting} waiting={waiting} total={count} />
          </div>
        ) : null}
        <div className="actions">
          <Link className="btn btn--quiet" href="/admin/cards?check=1">
            Check Buried Giant for changes
          </Link>
          {!last && !result ? (
            <form action={importCardsAction}>
              <button className="btn" type="submit">
                Import now
              </button>
            </form>
          ) : null}
        </div>
      </section>

      {result ? (
        <section className="panel" aria-labelledby="check-h" style={{ marginTop: 22 }}>
          <div className="panel__head">
            <h2 id="check-h" className="panel__title">
              What an import would change
            </h2>
          </div>
          {"error" in result ? (
            <p className="errors" role="alert">
              {result.error}
            </p>
          ) : (
            <div className="photo-acts">
              <p style={{ margin: 0 }}>
                Buried Giant has {result.plan.rows.length} ARCS cards to import: {result.plan.added.length} new,{" "}
                {result.plan.changed.length} changed, {result.plan.removed.length} gone, {result.plan.restored.length} back,{" "}
                {result.plan.unchanged} unchanged.
                {result.skipped ? ` ${result.skipped} malformed records will be skipped.` : ""}
              </p>
              <NameList title="New" items={result.plan.added} />
              <NameList title="Changed" items={result.plan.changed} link />
              <NameList title="Gone from Buried Giant (kept here, hidden from the reference)" items={result.plan.removed} link />
              <NameList title="Back again" items={result.plan.restored} link />
              {result.plan.added.length + result.plan.changed.length + result.plan.removed.length + result.plan.restored.length ? (
                <form action={importCardsAction}>
                  <button className="btn" type="submit">
                    Import these changes
                  </button>
                </form>
              ) : (
                <p className="ok-note" style={{ margin: 0 }}>
                  Up to date: nothing to import.
                </p>
              )}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
