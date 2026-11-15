"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getDb } from "@/db";
import { NotFoundError, PermissionError, RuleError } from "@/server/campaigns";
import { confirmImport, discardImport, type PlayerChoice } from "@/server/imports";
import { getSession, toActor } from "@/server/session";
import { notifyActSaved } from "@/server/bot/notify";
import type { ActNumber } from "@/lib/rules";

export type ImportActionResult<T = undefined> = { ok: true; data: T } | { ok: false; errors: string[] };

async function run<T>(fn: () => Promise<T>): Promise<ImportActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof RuleError) return { ok: false, errors: err.errors };
    if (err instanceof PermissionError || err instanceof NotFoundError) return { ok: false, errors: [err.message] };
    console.error(err);
    return { ok: false, errors: ["Something went wrong. Please try again."] };
  }
}

async function requireActor() {
  const session = await getSession();
  if (!session) throw new PermissionError("Sign in with Discord first.");
  return toActor(session);
}

export async function confirmImportAction(
  importId: number,
  choices: PlayerChoice[],
): Promise<ImportActionResult<{ campaignId: number; actNo: number }>> {
  return run(async () => {
    const actor = await requireActor();
    const res = await confirmImport(await getDb(), actor, importId, choices);
    revalidatePath("/");
    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${res.campaignId}`);
    revalidatePath("/imports");
    after(() => notifyActSaved(res.campaignId, res.actNo as ActNumber));
    return res;
  });
}

export async function discardImportAction(importId: number): Promise<ImportActionResult> {
  return run(async () => {
    const actor = await requireActor();
    await discardImport(await getDb(), actor, importId);
    revalidatePath("/imports");
    return undefined;
  });
}
