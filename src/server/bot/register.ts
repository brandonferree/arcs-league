/**
 * Bot setup helpers shared by `npm run discord:register` and /admin/discord.
 */
import type { BotConfig } from "./discord-api";
import { COMMANDS } from "./commands";

/**
 * View Channel, Send Messages, Embed Links, Read Message History, Create
 * Public Threads, Send Messages in Threads.
 */
export const BOT_PERMISSIONS = (
  (1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 16n) | (1n << 35n) | (1n << 38n)
).toString();

export function inviteUrl(applicationId: string): string {
  const u = new URL("https://discord.com/oauth2/authorize");
  u.searchParams.set("client_id", applicationId);
  u.searchParams.set("scope", "bot applications.commands");
  u.searchParams.set("permissions", BOT_PERMISSIONS);
  return u.toString();
}

export const BOT_ENV_VARS = [
  "DISCORD_CLIENT_ID",
  "DISCORD_PUBLIC_KEY",
  "DISCORD_BOT_TOKEN",
  "DISCORD_GUILD_ID",
  "DISCORD_ARCS_CHANNEL_ID",
] as const;

/** Names of the bot variables that are not set (never their values). */
export function missingBotEnv(): string[] {
  return BOT_ENV_VARS.filter((k) => !process.env[k]?.trim());
}

/**
 * Registers the slash commands on the league's server only (guild commands
 * appear at once; global ones can take an hour). Replaces the whole set, so it
 * is safe to run again after a change.
 */
export async function registerCommands(cfg: Pick<BotConfig, "applicationId" | "botToken" | "guildId">): Promise<string[]> {
  const res = await fetch(`https://discord.com/api/v10/applications/${cfg.applicationId}/guilds/${cfg.guildId}/commands`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bot ${cfg.botToken}` },
    body: JSON.stringify(COMMANDS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 403 || text.includes("Missing Access")) {
      throw new Error("Discord refused (Missing Access). Invite the bot to the server with the invite link first.");
    }
    if (res.status === 401) throw new Error("Discord rejected the bot token. Check DISCORD_BOT_TOKEN.");
    throw new Error(`Registering commands failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as { name: string }[];
  return body.map((c) => c.name);
}
