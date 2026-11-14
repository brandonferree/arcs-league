"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { NotFoundError, PermissionError, RuleError } from "@/server/campaigns";
import { addCardTag, removeCardTag } from "@/server/cards";
import { getSession, toActor } from "@/server/session";

export type TagResult = { ok: true } | { ok: false, error: string };

function message(err: unknown): string {
  if (err instanceof RuleError) return err.errors.join(" ");
  if (err instanceof PermissionError || err instanceof NotFoundError) return err.message;
  console.error(err);
  return "Something went wrong saving that. Please try again.";
}

export async function addCardTagAction(campaignId: number, photoId: number, cardId: string): Promise<TagResult> {
  try {
    const session = await getSession();
    await addCardTag(await getDb(), session ? toActor(session) : null, photoId, cardId);
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath(`/campaigns/${campaignId}/photos/${photoId}`);
    revalidatePath(`/cards/${cardId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function removeCardTagAction(form: FormData) {
  const campaignId = Number(form.get("campaignId"));
  const photoId = Number(form.get("photoId"));
  const back = `/campaigns/${campaignId}/photos/${photoId}`;
  let to = back;
  try {
    const session = await getSession();
    await removeCardTag(await getDb(), session ? toActor(session) : null, Number(form.get("tagId")));
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/cards", "layout");
  } catch (err) {
    to = `${back}?error=${encodeURIComponent(message(err))}`;
  }
  redirect(to);
}
