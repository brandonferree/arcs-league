/**
 * Posts from the site to Discord (spec section 4.4): a thread per campaign, a
 * result card in it after each act, and an announcement in #arcs when a
 * campaign closes. Cards and announcements remember their message, so saving
 * an act again (an edit, or meeples resending it) edits the card in place.
 *
 * Nothing here may break a save: the app calls these after the response, and
 * failures are logged and dropped.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { acts, campaignPlayers, campaigns, players } from "@/db/schema";
import type { ActNumber } from "@/lib/rules";
import { audit, getCampaign } from "@/server/campaigns";
import { appUrl } from "@/server/discord";
import { botConfig, DiscordApiError, restApi, type BotConfig, type DiscordApi } from "./discord-api";
import { closeAnnouncement, resultCard, threadWelcome } from "./messages";

export interface BotDeps {
  db: DbOrTx;
  api: DiscordApi;
  cfg: Pick<BotConfig, "arcsChannelId">;
  /** Site address for links. */
  base: string;
}

async function seatsOf(db: DbOrTx, campaignId: number) {
  return db
    .select({
      cpId: campaignPlayers.id,
      name: players.displayName,
      isWinner: campaignPlayers.isWinner,
      discordId: players.discordId,
    })
    .from(campaignPlayers)
    .innerJoin(players, eq(players.id, campaignPlayers.playerId))
    .where(eq(campaignPlayers.campaignId, campaignId))
    .orderBy(asc(campaignPlayers.position));
}

/**
 * The campaign's thread, made on first need: from the lobby message when the
 * bot started the campaign, else as a new thread in #arcs (campaigns created
 * on the site or by an import). Posts the welcome message when it makes one.
 */
export async function ensureCampaignThread(
  d: BotDeps,
  campaignId: number,
  fromMessage?: { channelId: string; messageId: string },
): Promise<string | null> {
  const [c] = await d.db
    .select({ id: campaigns.id, title: campaigns.title, threadId: campaigns.discordThreadId, status: campaigns.status })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId));
  if (!c) return null;
  if (c.threadId) return c.threadId;

  const thread = fromMessage
    ? await d.api.startThreadFromMessage(fromMessage.channelId, fromMessage.messageId, c.title)
    : await d.api.startThread(d.cfg.arcsChannelId, c.title);
  const [won] = await d.db
    .update(campaigns)
    .set({ discordThreadId: thread.id })
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.discordThreadId)))
    .returning({ id: campaigns.id });
  if (!won) {
    // Another request made one first; use theirs.
    const [again] = await d.db.select({ t: campaigns.discordThreadId }).from(campaigns).where(eq(campaigns.id, campaignId));
    return again?.t ?? thread.id;
  }
  await audit(d.db, null, {
    action: "campaign.discord_thread",
    entityType: "campaign",
    entityId: campaignId,
    campaignId,
    after: { discordThreadId: thread.id },
  });
  await d.api.createMessage(thread.id, threadWelcome(c, await seatsOf(d.db, campaignId), d.base));
  return thread.id;
}

async function postOrEdit(
  d: BotDeps,
  channelId: string,
  existingId: string | null,
  body: Parameters<DiscordApi["createMessage"]>[1],
): Promise<string> {
  if (existingId) {
    try {
      await d.api.editMessage(channelId, existingId, body);
      return existingId;
    } catch (err) {
      // Deleted by someone in Discord: post a fresh one.
      if (!(err instanceof DiscordApiError && err.status === 404)) throw err;
    }
  }
  return (await d.api.createMessage(channelId, body)).id;
}

/** Posts (or updates) an act's result card, and the closing announcement after Act III. */
export async function postActResult(d: BotDeps, campaignId: number, actNo: ActNumber): Promise<void> {
  const threadId = await ensureCampaignThread(d, campaignId);
  const detail = await getCampaign(d.db, campaignId);
  if (!detail || !threadId || detail.status === "void") return;
  const card = resultCard({ ...detail, discordThreadId: threadId }, actNo, d.base);
  const act = detail.acts.find((a) => a.actNo === actNo);
  if (!card || !act) return;

  const [row] = await d.db.select({ messageId: acts.discordMessageId }).from(acts).where(eq(acts.id, act.id));
  const messageId = await postOrEdit(d, threadId, row?.messageId ?? null, card);
  if (messageId !== row?.messageId) await d.db.update(acts).set({ discordMessageId: messageId }).where(eq(acts.id, act.id));

  if (actNo === 3 && detail.status === "closed") {
    const [c] = await d.db.select({ id: campaigns.discordAnnouncementId }).from(campaigns).where(eq(campaigns.id, campaignId));
    const announcementId = await postOrEdit(
      d,
      d.cfg.arcsChannelId,
      c?.id ?? null,
      closeAnnouncement({ ...detail, discordThreadId: threadId }, d.base),
    );
    if (announcementId !== c?.id) {
      await d.db.update(campaigns).set({ discordAnnouncementId: announcementId }).where(eq(campaigns.id, campaignId));
    }
  }
}

// ---------------------------------------------------------------------------
// Entry points for the app. No-ops until the bot is configured; never throw.

async function withBot(what: string, fn: (d: BotDeps) => Promise<unknown>) {
  const cfg = botConfig();
  if (!cfg) return;
  try {
    await fn({ db: await getDb(), api: restApi(cfg), cfg, base: appUrl() });
  } catch (err) {
    console.error(`discord bot: ${what} failed`, err);
  }
}

/** After an act is saved anywhere: the form, a confirmed import, a meeples push. */
export function notifyActSaved(campaignId: number, actNo: ActNumber) {
  return withBot(`result card for campaign ${campaignId} act ${actNo}`, (d) => postActResult(d, campaignId, actNo));
}

/** After a campaign is created on the site: give it a thread straight away. */
export function notifyCampaignCreated(campaignId: number) {
  return withBot(`thread for campaign ${campaignId}`, (d) => ensureCampaignThread(d, campaignId));
}
