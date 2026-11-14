"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { NotFoundError, PermissionError, RuleError } from "@/server/campaigns";
import { copyCardImages, fetchUpstreamCards, importCards, type CopyImagesResult } from "@/server/cards";
import { getPhotoStore, StorageNotConfiguredError } from "@/server/photo-store";
import { getSession, toActor } from "@/server/session";

const PAGE = "/admin/cards";

/** Fetches Buried Giant's card data now and applies it. Moderators only; never runs on its own. */
export async function importCardsAction() {
  let to: string;
  try {
    const session = await getSession();
    if (!session) throw new PermissionError("Sign in with Discord first.");
    const actor = toActor(session);
    if (!actor.isModerator) throw new PermissionError("Only moderators can import cards.");
    const upstream = await fetchUpstreamCards();
    const plan = await importCards(await getDb(), actor, upstream);
    revalidatePath("/", "layout");
    const parts = [
      `${plan.added.length} new`,
      `${plan.changed.length} changed`,
      `${plan.removed.length} removed`,
      plan.restored.length ? `${plan.restored.length} restored` : null,
    ].filter(Boolean);
    to = `${PAGE}?notice=${encodeURIComponent(`Imported ${plan.rows.length} cards: ${parts.join(", ")}.`)}`;
  } catch (err) {
    let message = "The import failed. Please try again.";
    if (err instanceof RuleError) message = err.errors.join(" ");
    else if (err instanceof PermissionError || err instanceof NotFoundError) message = err.message;
    else if (err instanceof Error && (err.name === "TimeoutError" || err.name === "TypeError")) {
      message = "Buried Giant's card database could not be reached. Please try again later.";
    } else console.error(err);
    to = `${PAGE}?error=${encodeURIComponent(message)}`;
  }
  redirect(to);
}

export type CopyImagesReply = ({ ok: true } & CopyImagesResult) | { ok: false; error: string };

/**
 * Copies one batch of card images. The page calls this repeatedly until none
 * are left, so each request stays short. `skip` holds ids that already failed
 * in this run, so a broken image is not retried forever.
 */
export async function copyCardImagesAction(skip: string[]): Promise<CopyImagesReply> {
  try {
    const session = await getSession();
    if (!session?.isModerator) throw new PermissionError("Only moderators can copy card images.");
    const r = await copyCardImages(await getDb(), getPhotoStore(), toActor(session), { limit: 25, skip: skip.slice(0, 500) });
    if (r.copied) revalidatePath("/", "layout");
    return { ok: true, ...r };
  } catch (err) {
    if (err instanceof PermissionError || err instanceof StorageNotConfiguredError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: "Copying images failed. Please try again." };
  }
}
