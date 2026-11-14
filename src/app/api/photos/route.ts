import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { NotFoundError, PermissionError, RuleError } from "@/server/campaigns";
import { getPhotoStore, StorageNotConfiguredError } from "@/server/photo-store";
import { PHOTO_LIMITS, savePhoto, type PhotoSlot } from "@/server/photos";
import { getSession, toActor } from "@/server/session";

/**
 * Upload one act photo: multipart form with campaignId, actNo, slot ("board" or
 * a campaign player id), and the browser-made `full` and `thumb` JPEGs.
 * A route handler rather than a server action, so the body limit is Vercel's
 * 4.5 MB rather than the 1 MB server-action default.
 */
export async function POST(req: NextRequest) {
  const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

  // The session cookie is SameSite=Lax, so cross-site posts arrive signed out;
  // checking the Origin as well costs nothing.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return fail("Cross-site upload refused.", 403);

  const session = await getSession();
  if (!session) return fail("Sign in with Discord first.", 401);

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > PHOTO_LIMITS.fullMaxBytes + PHOTO_LIMITS.thumbMaxBytes + 64_000) {
    return fail("That photo is too large to upload.", 413);
  }

  try {
    const form = await req.formData();
    const full = form.get("full");
    const thumb = form.get("thumb");
    if (!(full instanceof Blob) || !(thumb instanceof Blob)) return fail("The photo is missing.", 400);
    const slotRaw = String(form.get("slot") ?? "");
    const slot: PhotoSlot = slotRaw === "board" ? "board" : Number(slotRaw);
    const campaignId = Number(form.get("campaignId"));
    const actNo = Number(form.get("actNo"));
    if (!Number.isInteger(campaignId) || !Number.isInteger(actNo) || (slot !== "board" && !Number.isInteger(slot))) {
      return fail("Bad upload.", 400);
    }

    const id = await savePhoto(await getDb(), getPhotoStore(), toActor(session), {
      campaignId,
      actNo,
      slot,
      full: new Uint8Array(await full.arrayBuffer()),
      thumb: new Uint8Array(await thumb.arrayBuffer()),
    });
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (err instanceof RuleError) return fail(err.errors.join(" "), 400);
    if (err instanceof PermissionError) return fail(err.message, 403);
    if (err instanceof NotFoundError) return fail(err.message, 404);
    if (err instanceof StorageNotConfiguredError) return fail(err.message, 503);
    console.error(err);
    return fail("Something went wrong saving that photo. Please try again.", 500);
  }
}
