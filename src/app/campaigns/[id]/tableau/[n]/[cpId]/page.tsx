import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CardImage } from "@/components/CardImage";
import { FateChip } from "@/components/fates";
import { getDb } from "@/db";
import { pickerGroups } from "@/lib/cards";
import { ROMAN } from "@/lib/format";
import { canRemoveCardTag, canTagCards, canViewPhotos } from "@/lib/permissions";
import { campaignTags, getTableau, pickerCards, tableauKey } from "@/server/cards";
import { getSession, toActor } from "@/server/session";
import { removeCardTagAction } from "./actions";
import { CardPicker } from "./CardPicker";

type Params = Promise<{ id: string; n: string; cpId: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

async function load(p: Awaited<Params>) {
  const [id, n, cp] = [Number(p.id), Number(p.n), Number(p.cpId)];
  if (![id, n, cp].every((x) => Number.isInteger(x) && x > 0)) return null;
  return getTableau(await getDb(), id, n, cp);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const t = await load(await params);
  return { title: t ? `${t.player.name}'s tableau, Act ${ROMAN[t.act.actNo]}` : "Tableau" };
}

/** A player's tableau at the end of an act: the cards they held (and the photo, if one was added). */
export default async function TableauPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const [p, sp, session] = await Promise.all([params, searchParams, getSession()]);
  const t = await load(p);
  if (!t) notFound();
  const c = t.campaign;
  const actor = session ? toActor(session) : null;
  const error = typeof sp.error === "string" ? sp.error : null;
  const here = `/campaigns/${c.id}/tableau/${t.act.actNo}/${t.player.cpId}`;

  const db = await getDb();
  const tags = (await campaignTags(db, c.id)).get(tableauKey(t.act.id, t.player.cpId)) ?? [];
  const held = new Set(tags.map((x) => x.cardId));
  const canAdd = canTagCards(actor) && (c.status !== "void" || !!actor?.isModerator);
  const allCards = canAdd ? await pickerCards(db) : [];
  const groups = pickerGroups(allCards.filter((x) => !held.has(x.id)), t.fate, t.act.actNo);
  const seePhoto = canViewPhotos(!!session, c.photosPublic);

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">
          <Link href={`/campaigns/${c.id}#photos`}>{c.title}</Link> · Act {ROMAN[t.act.actNo]}
        </div>
        <h1>{t.player.name}&rsquo;s tableau</h1>
        <div className="actions small muted">
          {t.fate ? (
            <>
              <span>Playing</span>
              <FateChip fate={t.fate.name} tier={t.fate.tier} />
            </>
          ) : null}
          <span>
            Other tableaux:{" "}
            {c.players
              .filter((x) => x.cpId !== t.player.cpId)
              .map((x, i) => (
                <span key={x.cpId}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/campaigns/${c.id}/tableau/${t.act.actNo}/${x.cpId}`}>{x.name}</Link>
                </span>
              ))}
          </span>
        </div>
      </div>

      {error ? (
        <ul className="errors" role="alert">
          <li>{error}</li>
        </ul>
      ) : null}

      <div className="photo-page">
        <section className="panel photo-page__tags" aria-labelledby="cards-h">
          <div className="panel__head">
            <h2 id="cards-h" className="panel__title">
              Cards held
            </h2>
            <span className="panel__note">end of Act {ROMAN[t.act.actNo]}</span>
          </div>
          {tags.length ? (
            <ul className="tag-list">
              {tags.map((x) => (
                <li key={x.tagId} className="tag-list__item">
                  <Link href={`/cards/${x.cardId}`} className="tag-list__thumb" aria-hidden="true" tabIndex={-1}>
                    <CardImage id={x.cardId} name={x.name} imageV={x.imageV} />
                  </Link>
                  <Link href={`/cards/${x.cardId}`}>{x.name}</Link>
                  <span className="muted small">
                    {x.type}
                    {x.taggedBy ? ` · added by ${x.taggedBy}` : ""}
                  </span>
                  {canRemoveCardTag(actor, x.taggedById, c.access) ? (
                    <form action={removeCardTagAction}>
                      <input type="hidden" name="tagId" value={x.tagId} />
                      <input type="hidden" name="back" value={here} />
                      <button className="link-button small" type="submit" aria-label={`Remove ${x.name}`}>
                        Remove
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small" style={{ marginTop: 0 }}>
              No cards added yet.
            </p>
          )}

          {!actor ? (
            <p className="small" style={{ marginBottom: 0 }}>
              <Link href={`/sign-in?next=${here}`}>Sign in</Link> to add the cards {t.player.name} held.
            </p>
          ) : !canAdd ? (
            <p className="muted small" style={{ marginBottom: 0 }}>
              This campaign is void.
            </p>
          ) : allCards.length ? (
            <CardPicker tableau={{ campaignId: c.id, actNo: t.act.actNo, campaignPlayerId: t.player.cpId }} groups={groups} />
          ) : (
            <p className="muted small" style={{ marginBottom: 0 }}>
              No cards to add yet: a moderator needs to import them from Buried Giant Studios&rsquo; database.
            </p>
          )}
        </section>

        <section className="panel photo-page__photo" aria-label="Tableau photo">
          {!t.photo ? (
            <p className="empty" style={{ margin: 0 }}>
              No photo. A photo of the tableau is optional; add one in the{" "}
              <Link href={`/campaigns/${c.id}#photos`}>campaign&rsquo;s photos</Link>.
            </p>
          ) : !seePhoto ? (
            <p className="empty" style={{ margin: 0 }}>
              <Link href={`/sign-in?next=${here}`}>Sign in</Link> to see the photo.
            </p>
          ) : (
            <>
              <a href={`/api/photos/${t.photo.id}/full`} target="_blank" rel="noopener">
                <img
                  src={`/api/photos/${t.photo.id}/full`}
                  alt={`${t.player.name}'s tableau, Act ${ROMAN[t.act.actNo]}`}
                  width={t.photo.width}
                  height={t.photo.height}
                />
              </a>
              <p className="small muted" style={{ margin: "10px 0 0" }}>
                <a href={`/api/photos/${t.photo.id}/full`} target="_blank" rel="noopener">
                  Open full size
                </a>
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
