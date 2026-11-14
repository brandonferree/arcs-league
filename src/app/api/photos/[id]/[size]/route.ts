import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { canViewPhotos } from "@/lib/permissions";
import { getPhotoStore, StorageNotConfiguredError } from "@/server/photo-store";
import { photoForServing } from "@/server/photos";
import { getSession } from "@/server/session";

type Params = Promise<{ id: string; size: string }>;

/**
 * Serves a photo from private storage: to signed-in members, or to anyone once
 * the campaign's photos are public. A replaced photo gets a new id, so a URL's
 * content never changes and browsers may keep it; it is cached privately (in
 * the browser only) so that switching photos back to members-only takes effect.
 */
export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { id, size } = await params;
  const photoId = Number(id);
  if (!Number.isInteger(photoId) || photoId <= 0 || (size !== "full" && size !== "thumb")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const [row, session] = await Promise.all([photoForServing(await getDb(), photoId), getSession()]);
  if (!row) return new NextResponse("Not found", { status: 404 });
  if (!canViewPhotos(!!session, row.photosPublic)) {
    return new NextResponse("Sign in to see this photo.", { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const file = await getPhotoStore().get(size === "full" ? row.fullKey : row.thumbKey);
    if (!file) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(file.body as BodyInit, {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="photo-${photoId}-${size}.jpg"`,
      },
    });
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return new NextResponse(err.message, { status: 503 });
    throw err;
  }
}
