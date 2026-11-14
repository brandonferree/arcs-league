import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { ROMAN } from "@/lib/format";
import { canViewPhotos } from "@/lib/permissions";
import { photoInfo } from "@/server/photos";
import { getSession } from "@/server/session";

type Params = Promise<{ id: string; photoId: string }>;

async function load(id: string, photoId: string) {
  const pid = Number(photoId);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const p = await photoInfo(await getDb(), pid);
  return p && String(p.campaignId) === id ? p : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id, photoId } = await params;
  const p = await load(id, photoId);
  return { title: p ? `Board, Act ${ROMAN[p.actNo]}` : "Photo" };
}

/** A board photo. Tableau photos live on their tableau page, with the cards. */
export default async function PhotoPage({ params }: { params: Params }) {
  const [{ id, photoId }, session] = await Promise.all([params, getSession()]);
  const p = await load(id, photoId);
  if (!p) notFound();
  if (p.campaignPlayerId) redirect(`/campaigns/${p.campaignId}/tableau/${p.actNo}/${p.campaignPlayerId}`);
  const here = `/campaigns/${p.campaignId}/photos/${p.id}`;

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">
          <Link href={`/campaigns/${p.campaignId}#photos`}>{p.campaignTitle}</Link> · Act {ROMAN[p.actNo]}
        </div>
        <h1>Board</h1>
      </div>
      <section className="panel photo-page__photo" aria-label="Board photo">
        {canViewPhotos(!!session, p.photosPublic) ? (
          <>
            <a href={`/api/photos/${p.id}/full`} target="_blank" rel="noopener">
              <img src={`/api/photos/${p.id}/full`} alt={`Board, Act ${ROMAN[p.actNo]}`} width={p.width} height={p.height} />
            </a>
            <p className="small muted" style={{ margin: "10px 0 0" }}>
              <a href={`/api/photos/${p.id}/full`} target="_blank" rel="noopener">
                Open full size
              </a>
            </p>
          </>
        ) : (
          <p className="empty" style={{ margin: 0 }}>
            Photos are for signed-in members. <Link href={`/sign-in?next=${here}`}>Sign in</Link> to see this one.
          </p>
        )}
      </section>
    </>
  );
}
