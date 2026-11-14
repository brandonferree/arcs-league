import Link from "next/link";
import { PhotoUpload } from "@/components/PhotoUpload";
import { ROMAN } from "@/lib/format";
import type { CampaignDetail } from "@/server/campaigns";
import type { PhotoTag } from "@/server/cards";
import type { PhotoView } from "@/server/photos";
import { deletePhotoAction, setPhotosPublicAction } from "../actions";

/**
 * Act photos on the campaign page: per act, the board and each player's tableau.
 * Members-only unless the campaign's photos are switched public.
 */
export function PhotosPanel({
  c,
  photos,
  tags,
  canView,
  canManage,
}: {
  c: CampaignDetail;
  photos: PhotoView[];
  /** Card tags per photo id. */
  tags: Map<number, PhotoTag[]>;
  canView: boolean;
  canManage: boolean;
}) {
  return (
    <section className="panel" id="photos" aria-labelledby="photos-h">
      <div className="panel__head">
        <h2 id="photos-h" className="panel__title">
          Photos
        </h2>
        <div className="actions small">
          <span className="muted">{c.photosPublic ? "Public: anyone can see these" : "Members only"}</span>
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

      {!canView ? (
        <p className="empty">
          Photos are for signed-in members. <Link href={`/sign-in?next=/campaigns/${c.id}%23photos`}>Sign in</Link> to
          see them.
        </p>
      ) : c.acts.length === 0 ? (
        <p className="empty">Photos can be added once an act is recorded.</p>
      ) : (
        <div className="photo-acts">
          {canManage ? (
            <p className="small muted" style={{ margin: 0 }}>
              One photo of the board and one of each player&rsquo;s tableau, per act. Photos are shrunk on your device
              before upload, which also removes location data.
            </p>
          ) : null}
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
                    return (
                      <li key={s.key} className="photo-slot">
                        <figure className="photo-slot__figure">
                          {s.photo ? (
                            <Link href={`/campaigns/${c.id}/photos/${s.photo.id}`} className="photo-slot__frame">
                              <img src={`/api/photos/${s.photo.id}/thumb`} alt={what} loading="lazy" decoding="async" />
                            </Link>
                          ) : (
                            <div className="photo-slot__frame photo-slot__frame--empty">No photo</div>
                          )}
                          <figcaption>
                            {s.slot === "board" ? "Board" : <>{s.label}&rsquo;s tableau</>}
                            {s.photo?.uploadedBy ? <span className="muted"> · by {s.photo.uploadedBy}</span> : null}
                          </figcaption>
                        </figure>
                        {s.photo && s.slot !== "board" ? (
                          <div className="photo-slot__tags small">
                            {(tags.get(s.photo.id) ?? []).map((t, i) => (
                              <span key={t.tagId}>
                                {i > 0 ? ", " : ""}
                                <Link href={`/cards/${t.cardId}`}>{t.name}</Link>
                              </span>
                            ))}
                            {(tags.get(s.photo.id) ?? []).length ? " · " : ""}
                            <Link href={`/campaigns/${c.id}/photos/${s.photo.id}`} className="muted">
                              {(tags.get(s.photo.id) ?? []).length ? "Tag more" : "Tag cards"}
                            </Link>
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
