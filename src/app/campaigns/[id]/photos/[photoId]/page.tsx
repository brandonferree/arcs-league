import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CardImage } from "@/components/CardImage";
import { FateChip } from "@/components/fates";
import { getDb } from "@/db";
import { pickerGroups } from "@/lib/cards";
import { ROMAN } from "@/lib/format";
import { canRemoveCardTag, canTagCards, canViewPhotos } from "@/lib/permissions";
import { photoForTagging, pickerCards, tagsForPhotos } from "@/server/cards";
import { getSession, toActor } from "@/server/session";
import { removeCardTagAction } from "./actions";
import { CardPicker } from "./CardPicker";

type Params = Promise<{ id: string; photoId: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

async function load(id: string, photoId: string) {
  const pid = Number(photoId);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const p = await photoForTagging(await getDb(), pid);
  return p && String(p.campaignId) === id ? p : null;
}

function title(p: NonNullable<Awaited<ReturnType<typeof load>>>) {
  return p.player ? `${p.player.name}'s tableau, Act ${ROMAN[p.actNo]}` : `Board, Act ${ROMAN[p.actNo]}`;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id, photoId } = await params;
  const p = await load(id, photoId);
  return { title: p ? title(p) : "Photo" };
}

export default async function PhotoPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const [{ id, photoId }, sp, session] = await Promise.all([params, searchParams, getSession()]);
  const p = await load(id, photoId);
  if (!p) notFound();
  const c = p.campaign;
  const actor = session ? toActor(session) : null;
  const error = typeof sp.error === "string" ? sp.error : null;

  const head = (
    <div className="page-head">
      <div className="eyebrow">
        <Link href={`/campaigns/${c.id}#photos`}>{c.title}</Link> · Act {ROMAN[p.actNo]}
      </div>
      <h1>{p.player ? <>{p.player.name}&rsquo;s tableau</> : "Board"}</h1>
      {p.fate ? (
        <div className="actions small muted">
          <span>Playing</span>
          <FateChip fate={p.fate.name} tier={p.fate.tier} />
        </div>
      ) : null}
    </div>
  );

  if (!canViewPhotos(!!session, c.photosPublic)) {
    return (
      <>
        {head}
        <section className="panel">
          <p className="empty">
            Photos are for signed-in members.{" "}
            <Link href={`/sign-in?next=/campaigns/${c.id}/photos/${p.id}`}>Sign in</Link> to see this one.
          </p>
        </section>
      </>
    );
  }

  const db = await getDb();
  const tags = p.campaignPlayerId ? ((await tagsForPhotos(db, [p.id])).get(p.id) ?? []) : [];
  const tagged = new Set(tags.map((t) => t.cardId));
  const allCards = p.campaignPlayerId && canTagCards(actor) ? await pickerCards(db) : [];
  const groups = pickerGroups(allCards.filter((x) => !tagged.has(x.id)), p.fate, p.actNo);

  return (
    <>
      {head}
      {error ? (
        <ul className="errors" role="alert">
          <li>{error}</li>
        </ul>
      ) : null}

      <div className="photo-page">
        <section className="panel photo-page__photo" aria-label="Photo">
          <a href={`/api/photos/${p.id}/full`} target="_blank" rel="noopener">
            {/* Served by the access-checked photo route. */}
            <img src={`/api/photos/${p.id}/full`} alt={title(p)} width={p.width} height={p.height} />
          </a>
          <p className="small muted" style={{ margin: "10px 0 0" }}>
            {p.width}×{p.height} ·{" "}
            <a href={`/api/photos/${p.id}/full`} target="_blank" rel="noopener">
              Open full size
            </a>
          </p>
        </section>

        {p.campaignPlayerId ? (
          <section className="panel photo-page__tags" aria-labelledby="tags-h">
            <div className="panel__head">
              <h2 id="tags-h" className="panel__title">
                Cards seen
              </h2>
              <span className="panel__note">{tags.length}</span>
            </div>
            {tags.length ? (
              <ul className="tag-list">
                {tags.map((t) => (
                  <li key={t.tagId} className="tag-list__item">
                    <Link href={`/cards/${t.cardId}`} className="tag-list__thumb" aria-hidden="true" tabIndex={-1}>
                      <CardImage id={t.cardId} name={t.name} imageV={t.imageV} />
                    </Link>
                    <Link href={`/cards/${t.cardId}`}>{t.name}</Link>
                    <span className="muted small">
                      {t.type}
                      {t.taggedBy ? ` · ${t.taggedBy}` : ""}
                    </span>
                    {canRemoveCardTag(actor, t.taggedById, c.access) ? (
                      <form action={removeCardTagAction}>
                        <input type="hidden" name="campaignId" value={c.id} />
                        <input type="hidden" name="photoId" value={p.id} />
                        <input type="hidden" name="tagId" value={t.tagId} />
                        <button className="link-button small" type="submit" aria-label={`Remove ${t.name}`}>
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small" style={{ marginTop: 0 }}>
                No cards tagged yet.
              </p>
            )}

            {!actor ? (
              <p className="small" style={{ marginBottom: 0 }}>
                <Link href={`/sign-in?next=/campaigns/${c.id}/photos/${p.id}`}>Sign in</Link> to tag the cards you can
                see.
              </p>
            ) : allCards.length ? (
              <CardPicker campaignId={c.id} photoId={p.id} groups={groups} />
            ) : (
              <p className="muted small" style={{ marginBottom: 0 }}>
                No cards to tag yet: a moderator needs to import them from Buried Giant Studios&rsquo; database.
              </p>
            )}
          </section>
        ) : (
          <section className="panel photo-page__tags">
            <p className="muted small" style={{ margin: 0 }}>
              Cards are tagged on each player&rsquo;s tableau photo, not the board.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
