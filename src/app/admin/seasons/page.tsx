import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { formatDate } from "@/lib/format";
import { listSeasonsWithCounts } from "@/server/seasons";
import { getSession } from "@/server/session";
import { createSeasonAction, deleteSeasonAction, tagSeasonAction, updateSeasonAction } from "./actions";

export const metadata: Metadata = { title: "Seasons" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function SeasonsAdminPage({ searchParams }: { searchParams: SP }) {
  const [sp, session] = await Promise.all([searchParams, getSession()]);
  const error = typeof sp.error === "string" ? sp.error : null;
  const notice = typeof sp.notice === "string" ? sp.notice : null;

  const head = (
    <div className="page-head">
      <div className="eyebrow">Moderation</div>
      <h1>Seasons</h1>
      <p className="lede">
        A season is a name with optional dates. Campaigns can be tagged with one when they are logged, and the stats
        pages can then be filtered by season.
      </p>
    </div>
  );

  if (!session?.isModerator) {
    return (
      <>
        {head}
        <section className="panel">
          <p className="empty">
            {session ? (
              "Only moderators can manage seasons."
            ) : (
              <>
                Moderators manage seasons. <Link href="/sign-in?next=/admin/seasons">Sign in</Link> first.
              </>
            )}
          </p>
        </section>
      </>
    );
  }

  const seasons = await listSeasonsWithCounts(await getDb());

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

      <section className="panel" aria-labelledby="new-h">
        <div className="panel__head">
          <h2 id="new-h" className="panel__title">
            New season
          </h2>
        </div>
        <form className="filters" action={createSeasonAction}>
          <label className="field">
            <span className="field__label">Name</span>
            <input className="input" name="name" required maxLength={60} placeholder="Season 1" />
          </label>
          <label className="field">
            <span className="field__label">Starts (optional)</span>
            <input className="input" type="date" name="startsOn" />
          </label>
          <label className="field">
            <span className="field__label">Ends (optional)</span>
            <input className="input" type="date" name="endsOn" />
          </label>
          <button className="btn" type="submit">
            Create season
          </button>
        </form>
      </section>

      <section className="panel" aria-labelledby="list-h" style={{ marginTop: 22 }}>
        <div className="panel__head">
          <h2 id="list-h" className="panel__title">
            All seasons
          </h2>
          <span className="panel__note">
            &ldquo;Tag campaigns&rdquo; adds untagged campaigns whose Act I falls within the dates
          </span>
        </div>
        {seasons.length === 0 ? (
          <p className="empty">No seasons yet.</p>
        ) : (
          <div className="season-list">
            {seasons.map((s) => (
              <div key={s.id} className="season-item">
                <div className="season-item__head">
                  <strong>{s.name}</strong>
                  <span className="muted small tabular">
                    {s.startsOn || s.endsOn ? `${formatDate(s.startsOn)} – ${formatDate(s.endsOn)} · ` : ""}
                    <Link href={`/campaigns?season=${s.id}`}>
                      {s.campaignCount} {s.campaignCount === 1 ? "campaign" : "campaigns"}
                    </Link>
                  </span>
                </div>
                <form className="filters" action={updateSeasonAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <label className="field">
                    <span className="field__label">Name</span>
                    <input className="input" name="name" required maxLength={60} defaultValue={s.name} />
                  </label>
                  <label className="field">
                    <span className="field__label">Starts</span>
                    <input className="input" type="date" name="startsOn" defaultValue={s.startsOn ?? ""} />
                  </label>
                  <label className="field">
                    <span className="field__label">Ends</span>
                    <input className="input" type="date" name="endsOn" defaultValue={s.endsOn ?? ""} />
                  </label>
                  <button className="btn btn--cyan" type="submit">
                    Save
                  </button>
                </form>
                <div className="actions">
                  <form action={tagSeasonAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <button
                      className="btn btn--quiet btn--small"
                      type="submit"
                      disabled={!s.startsOn || !s.endsOn}
                      title={!s.startsOn || !s.endsOn ? "Needs a start and end date" : undefined}
                    >
                      Tag campaigns
                    </button>
                  </form>
                  <details>
                    <summary className="link-button">Delete</summary>
                    <form className="filters" action={deleteSeasonAction} style={{ marginTop: 10 }}>
                      <input type="hidden" name="id" value={s.id} />
                      <label className="field">
                        <span className="field__label">Type &ldquo;delete&rdquo; to confirm</span>
                        <input className="input" name="confirm" autoComplete="off" />
                      </label>
                      <button className="btn btn--danger btn--small" type="submit">
                        Delete season
                      </button>
                    </form>
                  </details>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
