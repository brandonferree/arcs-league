/**
 * `/campaign start` lobbies (spec section 4.1). State is in `discord_lobbies`;
 * every change locks the row, so two people pressing buttons at once cannot
 * lose a join. Start creates the campaign with the usual rules (3–4 players,
 * unique names) and audit log.
 */
import { eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { campaigns, discordLobbies, players } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { audit, createCampaign, NotFoundError, PermissionError, RuleError } from "@/server/campaigns";
import { LOBBY_MAX, LOBBY_MIN, type LobbyView } from "./messages";

export interface MemberIdentity {
  discordId: string;
  displayName: string;
  avatarUrl: string | null;
  isModerator: boolean;
}

/**
 * The league player for a server member who pressed a button or used a
 * command, created on first use so members need not have signed in to the
 * site. An existing player's name and avatar follow Discord.
 */
export async function ensureMemberPlayer(db: DbOrTx, m: MemberIdentity) {
  const [existing] = await db.select().from(players).where(eq(players.discordId, m.discordId));
  if (existing) {
    if (existing.displayName !== m.displayName || existing.avatarUrl !== m.avatarUrl) {
      await db
        .update(players)
        .set({ displayName: m.displayName, avatarUrl: m.avatarUrl, updatedAt: new Date() })
        .where(eq(players.id, existing.id));
    }
    return { id: existing.id, displayName: m.displayName };
  }
  const [row] = await db
    .insert(players)
    .values({ discordId: m.discordId, displayName: m.displayName, avatarUrl: m.avatarUrl, isModerator: m.isModerator })
    .onConflictDoNothing({ target: players.discordId })
    .returning();
  if (!row) {
    // Created by a simultaneous request.
    const [again] = await db.select().from(players).where(eq(players.discordId, m.discordId));
    return { id: again.id, displayName: again.displayName };
  }
  await audit(db, { playerId: row.id, isModerator: m.isModerator }, {
    action: "player.create",
    entityType: "player",
    entityId: row.id,
    after: { name: row.displayName, via: "discord bot" },
  });
  return { id: row.id, displayName: row.displayName };
}

export async function openLobby(db: DbOrTx, channelId: string, openerId: number): Promise<number> {
  const [row] = await db
    .insert(discordLobbies)
    .values({ channelId, openedById: openerId, playerIds: [openerId] })
    .returning({ id: discordLobbies.id });
  return row.id;
}

/** Remembers the lobby's message (the reply to /campaign start). */
export async function setLobbyMessage(db: DbOrTx, id: number, messageId: string) {
  await db.update(discordLobbies).set({ messageId }).where(eq(discordLobbies.id, id));
}

async function lockOpen(tx: DbOrTx, id: number) {
  const [l] = await tx.select().from(discordLobbies).where(eq(discordLobbies.id, id)).for("update");
  if (!l) throw new NotFoundError("This lobby no longer exists.");
  if (l.status === "started") throw new RuleError(["This lobby has already started its campaign."]);
  if (l.status === "closed") throw new RuleError(["This lobby is closed. Use /campaign start to open a new one."]);
  return l;
}

export async function joinLobby(db: DbOrTx, id: number, playerId: number, messageId?: string) {
  await db.transaction(async (tx) => {
    const l = await lockOpen(tx, id);
    if (l.playerIds.includes(playerId)) throw new RuleError(["You are already in this lobby."]);
    if (l.playerIds.length >= LOBBY_MAX) throw new RuleError([`The lobby is full (${LOBBY_MAX} players).`]);
    await tx
      .update(discordLobbies)
      .set({ playerIds: [...l.playerIds, playerId], messageId: messageId ?? l.messageId, updatedAt: new Date() })
      .where(eq(discordLobbies.id, id));
  });
}

/** Leaving the last seat closes the lobby. */
export async function leaveLobby(db: DbOrTx, id: number, playerId: number, messageId?: string) {
  await db.transaction(async (tx) => {
    const l = await lockOpen(tx, id);
    if (!l.playerIds.includes(playerId)) throw new RuleError(["You are not in this lobby."]);
    const rest = l.playerIds.filter((p) => p !== playerId);
    await tx
      .update(discordLobbies)
      .set({
        playerIds: rest,
        status: rest.length ? "open" : "closed",
        messageId: messageId ?? l.messageId,
        updatedAt: new Date(),
      })
      .where(eq(discordLobbies.id, id));
  });
}

/** Any player in the lobby, or a moderator, starts it. Returns the new campaign. */
export async function startLobby(db: DbOrTx, id: number, actor: Actor, messageId?: string): Promise<number> {
  return db.transaction(async (tx) => {
    const l = await lockOpen(tx, id);
    if (!l.playerIds.includes(actor.playerId) && !actor.isModerator) {
      throw new PermissionError("Only players in this lobby can start it.");
    }
    if (l.playerIds.length < LOBBY_MIN) {
      throw new RuleError([`A campaign needs ${LOBBY_MIN} or ${LOBBY_MAX} players; ${l.playerIds.length} have joined.`]);
    }
    const campaignId = await createCampaign(tx, actor, { players: l.playerIds.map((playerId) => ({ playerId })) });
    await tx
      .update(discordLobbies)
      .set({ status: "started", campaignId, messageId: messageId ?? l.messageId, updatedAt: new Date() })
      .where(eq(discordLobbies.id, id));
    return campaignId;
  });
}

export async function getLobbyView(db: DbOrTx, id: number): Promise<LobbyView & { channelId: string; messageId: string | null }> {
  const [l] = await db.select().from(discordLobbies).where(eq(discordLobbies.id, id));
  if (!l) throw new NotFoundError("This lobby no longer exists.");
  const ids = [...new Set([l.openedById, ...l.playerIds])];
  const rows = await db
    .select({ id: players.id, name: players.displayName, discordId: players.discordId })
    .from(players)
    .where(inArray(players.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  let campaign: LobbyView["campaign"] = null;
  if (l.campaignId) {
    const [c] = await db
      .select({ id: campaigns.id, title: campaigns.title, threadId: campaigns.discordThreadId })
      .from(campaigns)
      .where(eq(campaigns.id, l.campaignId));
    campaign = c ?? null;
  }
  return {
    id: l.id,
    status: l.status,
    channelId: l.channelId,
    messageId: l.messageId,
    openedBy: byId.get(l.openedById)?.name ?? "someone",
    players: l.playerIds.map((p) => ({ name: byId.get(p)?.name ?? "?", discordId: byId.get(p)?.discordId ?? null })),
    campaign,
  };
}
