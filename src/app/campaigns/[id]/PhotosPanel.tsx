import Link from "next/link";
import { PhotoUpload } from "@/components/PhotoUpload";
import { ROMAN } from "@/lib/format";
import type { CampaignDetail } from "@/server/campaigns";
import { tableauKey, type CardTag } from "@/server/cards";
import type { PhotoView } from "@/server/photos";
import { deletePhotoAction, setPhotosPublicAction } from "../actions";

/**
 * Per act: the board photo and each player's tableau, meaning the cards they
 * held at the end of the act (anyone can see these) and an optional photo
 * (members only unless the campaign's photos are switched public).
 */
export function PhotosPanel({
  c,
  photos,
  tags,
  canView,
  canManage,
  signedIn,
}: {
  c: CampaignDetail;
  photos: PhotoView[];
  /** Cards per tableau, keyed by tableauKey(actId, campaignPlayerId). */
  tags: Map<string, CardTag[]>;
  canView: boolean;
  canManage: boolean;
  signedIn: boolean;
}) {
  return (
    <section className="panel" id="photos" aria-labelledby="photos-h">
      <div className="panel__head">
        <h2 id="photos-h" className="panel__title">
          Tableaux and photos
        </h2>
        <div className="actions small">
          <span className="muted">Photos: {c.photosPublic ? "public" : "members only"}</span>
          {canManage ? (
            <form action={setPhotosPublicAction}>
              <input type="hidden" name="campaignId" value={c.id} />
              <input type="hidden" name="public" value={c.photosPublic ? "0" : "1"} />
              <button className="link-button" type="submit">
                {c.photosPublic ? "Make members-only" : "Make public"}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {c.acts.length === 0 ? (
        <p className="empty">Cards and photos can be added once an act is recorded.</p>
      ) : (
        <div className="photo-acts">
          <p className="small muted" style={{ margin: 0 }}>
            Add the cards each player held at the end of each act. Photos of the board and tableaux are welcome but
            optional{canManage ? "; they are shrunk on your device before upload, which also removes location data" : ""}.
            {!canView ? (
              <>
                {" "}
                <Link href={`/sign-in?next=/campaigns/${c.id}%23photos`}>Sign in</Link> to see the photos.
              </>
            ) : null}
          </p>
          {c.acts.map((a) => {
            const slots = [
              { key: "board", slot: "board" as const, label: "Board", photo: photos.find((p) => p.actId === a.id && p.campaignPlayerId === null) },
              ...c.players.map((p) => ({
                key: String(p.cpId),
                slot: p.cpId,
                label: p.name,
                photo: photos.find((ph) => ph.actId === a.id && ph.campaignPlayerId === p.cpId),
              })),
            ];
            return (
              <div key={a.id} className="photo-act">
                <h3 className="photo-act__title">Act {ROMAN[a.actNo]}</h3>
                <ul className="photo-grid">
                  {slots.map((s) => {
                    const what = s.slot === "board" ? `Act ${ROMAN[a.actNo]} board` : `Act ${ROMAN[a.actNo]}, ${s.label}'s tableau`;
                    const href =
                      s.slot === "board"
                        ? s.photo
                          ? `/campaigns/${c.id}/photos/${s.photo.id}`
                          : null
                        : `/campaigns/${c.id}/tableau/${a.actNo}/${s.slot}`;
                    const held = s.slot === "board" ? [] : (tags.get(tableauKey(a.id, s.slot)) ?? []);
                    const frame = !s.photo ? (
                      <span className="photo-slot__frame photo-slot__frame--empty">No photo</span>
                    ) : canView ? (
                      <span className="photo-slot__frame">
                        <img src={`/api/photos/${s.photo.id}/thumb`} alt={what} loading="lazy" decoding="async" />
                      </span>
                    ) : (
                      <span className="photo-slot__frame photo-slot__frame--empty">Photo for members</span>
                    );
                    return (
                      <li key={s.key} className="photo-slot">
                        <figure className="photo-slot__figure">
                          {href ? (
                            <Link href={href} className="photo-slot__link" aria-label={what}>
                              {frame}
                            </Link>
                          ) : (
                            frame
                          )}
                          <figcaption>
                            {s.slot === "board" ? "Board" : <>{s.label}&rsquo;s tableau</>}
                            {s.photo?.uploadedBy && canView ? <span className="muted"> · photo by {s.photo.uploadedBy}</span> : null}
                          </figcaption>
                        </figure>
                        {s.slot !== "board" ? (
                          <div className="photo-slot__tags small">
                            {held.length ? (
                              <>
                                {held.map((t, i) => (
                                  <span key={t.tagId}>
                                    {i > 0 ? ", " : ""}
                                    <Link href={`/cards/${t.cardId}`}>{t.name}</Link>
                                  </span>
                                ))}
                                {signedIn ? (
                                  <>
                                    {" · "}
                                    <Link href={href!} className="muted">
                                      Edit cards
                                    </Link>
                                  </>
                                ) : null}
                              </>
                            ) : signedIn ? (
                              <Link href={href!} className="btn btn--small btn--quiet">
                                Add cards
                              </Link>
                            ) : (
                              <span className="muted">No cards added</span>
                            )}
                          </div>
                        ) : null}
                        {canManage ? (
                          <div className="photo-slot__actions">
                            <PhotoUpload campaignId={c.id} actNo={a.actNo} slot={s.slot} label={what} replace={!!s.photo} />
                            {s.photo ? (
                              <details className="photo-slot__remove">
                                <summary className="link-button">Remove</summary>
                                <form action={deletePhotoAction}>
                                  <input type="hidden" name="campaignId" value={c.id} />
                                  <input type="hidden" name="photoId" value={s.photo.id} />
                                  <button className="btn btn--danger btn--small" type="submit">
                                    Remove photo
                                  </button>
                                </form>
                              </details>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
