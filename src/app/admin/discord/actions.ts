"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { audit } from "@/server/campaigns";
import { botConfig } from "@/server/bot/discord-api";
import { registerCommands } from "@/server/bot/register";
import { getSession, toActor } from "@/server/session";

const PAGE = "/admin/discord";

export async function registerCommandsAction() {
  let to: string;
  try {
    const session = await getSession();
    if (!session?.isModerator) throw new Error("Only moderators can register the bot's commands.");
    const cfg = botConfig();
    if (!cfg) throw new Error("Set every bot variable first.");
    const names = await registerCommands(cfg);
    await audit(await getDb(), toActor(session), {
      action: "discord.register_commands",
      entityType: "discord",
      entityId: "commands",
      after: { commands: names },
    });
    to = `${PAGE}?notice=${encodeURIComponent(`Registered /${names.join(", /")}.`)}`;
  } catch (err) {
    console.error(err);
    to = `${PAGE}?error=${encodeURIComponent(err instanceof Error ? err.message : "Registering failed.")}`;
  }
  redirect(to);
}
