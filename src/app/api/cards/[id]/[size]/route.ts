import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { cardImageKeys } from "@/server/cards";
import { getPhotoStore, StorageNotConfiguredError } from "@/server/photo-store";

type Params = Promise<{ id: string; size: string }>;

/**
 * Our copy of a card image (Buried Giant Studios, used with permission). Public.
 * Links carry ?v=<copy time>, so a response never changes for its URL and the
 * CDN and browsers may keep it for a year; a new copy gets a new URL.
 */
export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { id, size } = await params;
  if (size !== "full" && size !== "thumb") return new NextResponse("Not found", { status: 404 });
  const keys = await cardImageKeys(await getDb(), decodeURIComponent(id));
  const key = size === "full" ? keys?.imageKey : keys?.thumbKey;
  if (!key) return new NextResponse("Not found", { status: 404 });
  try {
    const file = await getPhotoStore().get(key);
    if (!file) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(file.body as BodyInit, {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return new NextResponse(err.message, { status: 503 });
    throw err;
  }
}
