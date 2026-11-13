/**
 * Discord OAuth2 (authorization code flow) with server-membership and
 * moderator-role checks. Guild and role ids come from the environment.
 *
 * Scopes: identify (who you are) and guilds.members.read (your membership and
 * roles in our server, without listing your other servers).
 */
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { auditLog, players } from "@/db/schema";

const API = "https://discord.com/api/v10";

export interface DiscordConfig {
  clientId: string;
  clientSecret: string;
  guildId: string;
  modRoleId: string | null;
  redirectUri: string;
}

export function appUrl(): string {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

export function discordConfig(): DiscordConfig | null {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!clientId || !clientSecret || !guildId) return null;
  return {
    clientId,
    clientSecret,
    guildId,
    modRoleId: process.env.DISCORD_MOD_ROLE_ID?.trim() || null,
    redirectUri: `${appUrl()}/api/auth/callback`,
  };
}

export function authorizeUrl(cfg: DiscordConfig, state: string): string {
  const u = new URL("https://discord.com/oauth2/authorize");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("scope", "identify guilds.members.read");
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "none");
  return u.toString();
}

export async function exchangeCode(cfg: DiscordConfig, code: string): Promise<string> {
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Discord token exchange failed (${res.status}).`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Discord token exchange returned no access token.");
  return body.access_token;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

interface DiscordMember {
  nick: string | null;
  avatar: string | null;
  roles: string[];
  user?: DiscordUser;
}

export interface DiscordIdentity {
  discordId: string;
  displayName: string;
  avatarUrl: string | null;
  isMember: boolean;
  isModerator: boolean;
}

export async function fetchIdentity(cfg: DiscordConfig, accessToken: string): Promise<DiscordIdentity> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const userRes = await fetch(`${API}/users/@me`, { headers });
  if (!userRes.ok) throw new Error(`Could not read your Discord profile (${userRes.status}).`);
  const user = (await userRes.json()) as DiscordUser;

  const memberRes = await fetch(`${API}/users/@me/guilds/${cfg.guildId}/member`, { headers });
  const member = memberRes.ok ? ((await memberRes.json()) as DiscordMember) : null;
  if (!memberRes.ok && memberRes.status !== 404) {
    throw new Error(`Could not check server membership (${memberRes.status}).`);
  }

  const avatarUrl = member?.avatar
    ? `https://cdn.discordapp.com/guilds/${cfg.guildId}/users/${user.id}/avatars/${member.avatar}.png?size=64`
    : user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
      : null;

  return {
    discordId: user.id,
    displayName: member?.nick || user.global_name || user.username,
    avatarUrl,
    isMember: !!member,
    isModerator: !!member && !!cfg.modRoleId && member.roles.includes(cfg.modRoleId),
  };
}

/** Creates or refreshes the player row for a Discord account. */
export async function upsertDiscordPlayer(
  db: DB,
  id: Pick<DiscordIdentity, "discordId" | "displayName" | "avatarUrl" | "isModerator">,
) {
  const now = new Date();
  const [existing] = await db.select().from(players).where(eq(players.discordId, id.discordId));
  if (existing) {
    const [row] = await db
      .update(players)
      .set({
        displayName: id.displayName,
        avatarUrl: id.avatarUrl,
        isModerator: id.isModerator,
        lastSignInAt: now,
        updatedAt: now,
      })
      .where(eq(players.id, existing.id))
      .returning();
    if (existing.isModerator !== id.isModerator) {
      await db.insert(auditLog).values({
        actorId: row.id,
        action: "player.moderator_change",
        entityType: "player",
        entityId: String(row.id),
        before: { isModerator: existing.isModerator },
        after: { isModerator: id.isModerator },
      });
    }
    return row;
  }
  const [row] = await db
    .insert(players)
    .values({
      discordId: id.discordId,
      displayName: id.displayName,
      avatarUrl: id.avatarUrl,
      isModerator: id.isModerator,
      lastSignInAt: now,
    })
    .returning();
  await db.insert(auditLog).values({
    actorId: row.id,
    action: "player.create",
    entityType: "player",
    entityId: String(row.id),
    after: { name: row.displayName, isModerator: row.isModerator },
  });
  return row;
}

/** The localhost-only development sign-in stub. */
export function devStubEnabled(hostname: string): boolean {
  return (
    process.env.DEV_AUTH_STUB === "1" &&
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)
  );
}
