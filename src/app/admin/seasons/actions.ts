"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { NotFoundError, PermissionError, RuleError } from "@/server/campaigns";
import { createSeason, deleteSeason, tagCampaignsBySeasonDates, updateSeason } from "@/server/seasons";
import { getSession, toActor } from "@/server/session";

const PAGE = "/admin/seasons";

/** Runs a moderator change, then comes back to the page with a notice or an error. */
async function seasonAction(fn: (actor: ReturnType<typeof toActor>) => Promise<string>) {
  let to: string;
  try {
    const session = await getSession();
    if (!session) throw new PermissionError("Sign in with Discord first.");
    const notice = await fn(toActor(session));
    revalidatePath("/", "layout");
    to = `${PAGE}?notice=${encodeURIComponent(notice)}`;
  } catch (err) {
    let message = "Something went wrong saving that. Please try again.";
    if (err instanceof RuleError) message = err.errors.join(" ");
    else if (err instanceof PermissionError || err instanceof NotFoundError) message = err.message;
    else console.error(err);
    to = `${PAGE}?error=${encodeURIComponent(message)}`;
  }
  redirect(to);
}

function fields(form: FormData) {
  return {
    name: String(form.get("name") ?? ""),
    startsOn: String(form.get("startsOn") ?? ""),
    endsOn: String(form.get("endsOn") ?? ""),
  };
}

export async function createSeasonAction(form: FormData) {
  await seasonAction(async (actor) => {
    const input = fields(form);
    await createSeason(await getDb(), actor, input);
    return `Created ${input.name.trim()}.`;
  });
}

export async function updateSeasonAction(form: FormData) {
  await seasonAction(async (actor) => {
    await updateSeason(await getDb(), actor, Number(form.get("id")), fields(form));
    return "Season saved.";
  });
}

export async function tagSeasonAction(form: FormData) {
  await seasonAction(async (actor) => {
    const n = await tagCampaignsBySeasonDates(await getDb(), actor, Number(form.get("id")));
    return n ? `Tagged ${n} ${n === 1 ? "campaign" : "campaigns"}.` : "No untagged campaigns fall within those dates.";
  });
}

export async function deleteSeasonAction(form: FormData) {
  await seasonAction(async (actor) => {
    if (form.get("confirm") !== "delete") throw new RuleError(['Type "delete" to confirm.']);
    await deleteSeason(await getDb(), actor, Number(form.get("id")));
    return "Season deleted. Its campaigns keep their results and lose the tag.";
  });
}
