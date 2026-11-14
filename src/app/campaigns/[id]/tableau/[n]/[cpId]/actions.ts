"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { NotFoundError, PermissionError, RuleError } from "@/server/campaigns";
import { addCardTag, removeCardTag, type TableauRef } from "@/server/cards";
import { getSession, toActor } from "@/server/session";

export type TagResult = { ok: true } | { ok: false; error: string };

const tableauPath = (t: TableauRef) => `/campaigns/${t.campaignId}/tableau/${t.actNo}/${t.campaignPlayerId}`;

function message(err: unknown): string {
  if (err instanceof RuleError) return err.errors.join(" ");
  if (err instanceof PermissionError || err instanceof NotFoundError) return err.message;
  console.error(err);
  return "Something went wrong saving that. Please try again.";
}

export async function addCardTagAction(tableau: TableauRef, cardId: string): Promise<TagResult> {
  try {
    const session = await getSession();
    const ref = {
      campaignId: Number(tableau.campaignId),
      actNo: Number(tableau.actNo),
      campaignPlayerId: Number(tableau.campaignPlayerId),
    };
    await addCardTag(await getDb(), session ? toActor(session) : null, ref, String(cardId));
    revalidatePath(`/campaigns/${ref.campaignId}`);
    revalidatePath(tableauPath(ref));
    revalidatePath(`/cards/${cardId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export async function removeCardTagAction(form: FormData) {
  const back = String(form.get("back") ?? "/campaigns");
  let to = back.startsWith("/campaigns/") ? back : "/campaigns";
  try {
    const session = await getSession();
    const ref = await removeCardTag(await getDb(), session ? toActor(session) : null, Number(form.get("tagId")));
    revalidatePath(`/campaigns/${ref.campaignId}`);
    revalidatePath("/cards", "layout");
    to = tableauPath(ref);
  } catch (err) {
    to = `${to}?error=${encodeURIComponent(message(err))}`;
  }
  redirect(to);
}
