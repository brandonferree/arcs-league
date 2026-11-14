"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import type { ActNumber } from "@/lib/rules";
import {
  createCampaign,
  deleteCampaign,
  NotFoundError,
  PermissionError,
  reopenCampaign,
  RuleError,
  saveAct,
  voidCampaign,
  type ActInput,
  type CreateCampaignInput,
} from "@/server/campaigns";
import { getPhotoStore, StorageNotConfiguredError } from "@/server/photo-store";
import { campaignPhotoKeys, deletePhoto, setPhotosPublic } from "@/server/photos";
import { getSession, toActor } from "@/server/session";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; errors: string[] };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof RuleError) return { ok: false, errors: err.errors };
    if (err instanceof PermissionError || err instanceof NotFoundError || err instanceof StorageNotConfiguredError) {
      return { ok: false, errors: [err.message] };
    }
    console.error(err);
    return { ok: false, errors: ["Something went wrong saving that. Please try again."] };
  }
}

async function requireActor() {
  const session = await getSession();
  if (!session) throw new PermissionError("Sign in with Discord first.");
  return toActor(session);
}

export async function createCampaignAction(input: CreateCampaignInput): Promise<ActionResult<{ id: number }>> {
  return run(async () => {
    const actor = await requireActor();
    const id = await createCampaign(await getDb(), actor, input);
    revalidatePath("/");
    revalidatePath("/campaigns");
    return { id };
  });
}

export async function saveActAction(
  campaignId: number,
  actNo: ActNumber,
  input: ActInput,
): Promise<ActionResult<{ closed: boolean }>> {
  return run(async () => {
    const actor = await requireActor();
    const result = await saveAct(await getDb(), actor, campaignId, actNo, input);
    revalidatePath("/");
    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return result;
  });
}

/** Form actions on the campaign page (moderator tools, photos). Errors come back as a query string. */
async function modAction(campaignId: number, fn: () => Promise<void>, after = `/campaigns/${campaignId}`) {
  const r = await run(fn);
  revalidatePath("/");
  revalidatePath("/campaigns");
  if (!r.ok) redirect(`/campaigns/${campaignId}?error=${encodeURIComponent(r.errors.join(" "))}`);
  redirect(after);
}

export async function voidCampaignAction(formData: FormData) {
  const id = Number(formData.get("campaignId"));
  await modAction(id, async () => voidCampaign(await getDb(), await requireActor(), id, String(formData.get("reason") ?? "")));
}

export async function reopenCampaignAction(formData: FormData) {
  const id = Number(formData.get("campaignId"));
  await modAction(id, async () => reopenCampaign(await getDb(), await requireActor(), id));
}

export async function deleteCampaignAction(formData: FormData) {
  const id = Number(formData.get("campaignId"));
  if (formData.get("confirm") !== "delete") {
    redirect(`/campaigns/${id}?error=${encodeURIComponent('Type "delete" to confirm.')}`);
  }
  await modAction(
    id,
    async () => {
      const db = await getDb();
      const keys = await campaignPhotoKeys(db, id);
      await deleteCampaign(db, await requireActor(), id);
      // The rows went with the campaign; now the files. Best effort: a leftover file is only wasted space.
      if (keys.length) await getPhotoStore().del(keys).catch((e) => console.error("photo cleanup failed", e));
    },
    "/campaigns",
  );
}

export async function deletePhotoAction(formData: FormData) {
  const campaignId = Number(formData.get("campaignId"));
  const photoId = Number(formData.get("photoId"));
  await modAction(campaignId, async () => {
    await deletePhoto(await getDb(), getPhotoStore(), await requireActor(), photoId);
  }, `/campaigns/${campaignId}#photos`);
}

export async function setPhotosPublicAction(formData: FormData) {
  const campaignId = Number(formData.get("campaignId"));
  await modAction(campaignId, async () =>
    setPhotosPublic(await getDb(), await requireActor(), campaignId, formData.get("public") === "1"),
  `/campaigns/${campaignId}#photos`);
}
