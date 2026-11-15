/**
 * Handles one Discord interaction (spec section 9). Discord wants an answer
 * within 3 seconds, so anything touching the database is deferred: the handler
 * returns the immediate response plus `work`, which the route runs after
 * replying and which then edits the reply. Commands work only in the league's
 * server, in #arcs and its threads.
 */
import { eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { campaigns, players } from "@/db/schema";
import { fateSlug } from "@/lib/format";
import { fateSummaries, playerSummaries } from "@/lib/stats";
import { listCampaigns, NotFoundError, PermissionError, RuleError } from "@/server/campaigns";
import { listStatFates, loadStatGames } from "@/server/stats";
import { EPHEMERAL, type BotConfig, type DiscordApi, type MessageBody } from "./discord-api";
import {
  ensureMemberPlayer,
  getLobbyView,
  joinLobby,
  leaveLobby,
  openLobby,
  setLobbyMessage,
  startLobby,
  type MemberIdentity,
} from "./lobby";
import { fateStatsMessage, lobbyMessage, notice, playerStatsMessage, statusMessage } from "./messages";
import { ensureCampaignThread } from "./notify";

// Interaction and response types (Discord API v10).
const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const AUTOCOMPLETE = 4;

const PONG = 1;
const MESSAGE = 4;
const DEFERRED_MESSAGE = 5;
const DEFERRED_UPDATE = 6;
const AUTOCOMPLETE_RESULT = 8;

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  focused?: boolean;
  options?: CommandOption[];
}

export interface Interaction {
  id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  channel?: { id: string; type?: number; parent_id?: string | null };
  member?: { user: DiscordUser; nick?: string | null; avatar?: string | null; roles: string[] };
  data?: {
    name?: string;
    options?: CommandOption[];
    custom_id?: string;
    resolved?: { users?: Record<string, DiscordUser> };
  };
  message?: { id: string; channel_id?: string };
}

export type InteractionResponse =
  | { type: typeof PONG }
  | { type: typeof MESSAGE | typeof DEFERRED_MESSAGE; data?: MessageBody }
  | { type: typeof DEFERRED_UPDATE }
  | { type: typeof AUTOCOMPLETE_RESULT; data: { choices: { name: string; value: string }[] } };

export interface Handled {
  response: InteractionResponse;
  /** Runs after the response is sent. Must not throw. */
  work?: () => Promise<void>;
}

export interface HandlerDeps {
  /** Opened lazily: pings and refusals never touch the database. */
  db: () => Promise<DbOrTx>;
  api: DiscordApi;
  cfg: BotConfig;
  base: string;
}

const reply = (text: string): Handled => ({ response: { type: MESSAGE, data: notice(text) } });

export function memberIdentity(i: Interaction, cfg: Pick<BotConfig, "guildId" | "modRoleId">): MemberIdentity | null {
  const m = i.member;
  if (!m?.user) return null;
  const u = m.user;
  const avatarUrl = m.avatar
    ? `https://cdn.discordapp.com/guilds/${cfg.guildId}/users/${u.id}/avatars/${m.avatar}.png?size=64`
    : u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
      : null;
  return {
    discordId: u.id,
    displayName: m.nick || u.global_name || u.username,
    avatarUrl,
    isModerator: !!cfg.modRoleId && m.roles.includes(cfg.modRoleId),
  };
}

/** Messages for errors the person can act on; anything else is logged. */
function userMessage(err: unknown): string {
  if (err instanceof RuleError) return err.errors.join(" ");
  if (err instanceof PermissionError || err instanceof NotFoundError) return err.message;
  console.error("discord bot: interaction failed", err);
  return "Something went wrong. Please try again.";
}

function subcommand(i: Interaction): { group: string; name: string; options: CommandOption[] } {
  const sub = i.data?.options?.find((o) => o.type === 1);
  return { group: i.data?.name ?? "", name: sub?.name ?? "", options: sub?.options ?? [] };
}

export async function handleInteraction(d: HandlerDeps, i: Interaction): Promise<Handled> {
  if (i.type === PING) return { response: { type: PONG } };

  const arcs = `<#${d.cfg.arcsChannelId}>`;
  if (i.guild_id !== d.cfg.guildId || !i.member) {
    if (i.type === AUTOCOMPLETE) return { response: { type: AUTOCOMPLETE_RESULT, data: { choices: [] } } };
    return reply("The ARCS League bot works only in the league's Discord server.");
  }
  const inArcs = i.channel_id === d.cfg.arcsChannelId;
  const inArcsThread = !!i.channel?.parent_id && i.channel.parent_id === d.cfg.arcsChannelId;

  if (i.type === AUTOCOMPLETE) return autocomplete(d, i);
  if (!inArcs && !inArcsThread) return reply(`Use the ARCS League commands in ${arcs}.`);
  if (i.type === MESSAGE_COMPONENT) return component(d, i);
  if (i.type !== APPLICATION_COMMAND) return reply("That is not something this bot can do.");

  const { group, name, options } = subcommand(i);
  const key = `${group} ${name}`;
  if (key === "campaign start") {
    if (!inArcs) return reply(`Open campaign lobbies in ${arcs} itself, not in a thread.`);
    return deferred(d, i, async (db) => {
      const me = await ensureMemberPlayer(db, memberIdentity(i, d.cfg)!);
      const lobbyId = await openLobby(db, i.channel_id!, me.id);
      const posted = await d.api.editOriginal(i.token, lobbyMessage(await getLobbyView(db, lobbyId), d.base));
      await setLobbyMessage(db, lobbyId, posted.id);
      return null;
    });
  }
  if (key === "campaign status") {
    return deferred(d, i, async (db) => {
      const rows = await listCampaigns(db, { status: "in_progress", limit: 15 });
      const threads = rows.length
        ? await db
            .select({ id: campaigns.id, threadId: campaigns.discordThreadId })
            .from(campaigns)
            .where(inArray(campaigns.id, rows.map((r) => r.id)))
        : [];
      const threadOf = new Map(threads.map((t) => [t.id, t.threadId]));
      return statusMessage(rows.map((r) => ({ ...r, threadId: threadOf.get(r.id) ?? null })), d.base);
    });
  }
  if (key === "stats player") {
    return deferred(d, i, async (db) => {
      const target = String(options.find((o) => o.name === "member")?.value ?? i.member!.user.id);
      const user = i.data?.resolved?.users?.[target];
      const [p] = await db.select({ id: players.id, name: players.displayName }).from(players).where(eq(players.discordId, target));
      const summary = p ? playerSummaries(await loadStatGames(db)).find((s) => s.playerId === p.id) : undefined;
      if (!summary) {
        const who = target === i.member!.user.id ? "You have" : `${p?.name ?? user?.global_name ?? user?.username ?? "They"} has`;
        return notice(`${who} not finished a league campaign yet.`, false);
      }
      return playerStatsMessage(summary, d.base);
    });
  }
  if (key === "stats fate") {
    return deferred(d, i, async (db) => {
      const asked = String(options.find((o) => o.name === "name")?.value ?? "").trim();
      const fates = await listStatFates(db);
      const fate = fates.find((f) => f.name.toLowerCase() === asked.toLowerCase() || fateSlug(f.name) === fateSlug(asked));
      if (!fate) return notice(`There is no fate called "${asked.slice(0, 50)}".`, false);
      const summary = fateSummaries(await loadStatGames(db), fates).find((f) => f.id === fate.id)!;
      return fateStatsMessage(summary, d.base);
    });
  }
  return reply("Unknown command. The commands may need registering again.");
}

/** "Thinking…" now; the result replaces it. `run` returns the message, or null if it posted itself. */
function deferred(d: HandlerDeps, i: Interaction, run: (db: DbOrTx) => Promise<MessageBody | null>): Handled {
  return {
    response: { type: DEFERRED_MESSAGE },
    work: async () => {
      let body: MessageBody | null;
      try {
        body = await run(await d.db());
      } catch (err) {
        body = notice(userMessage(err), false);
      }
      if (body) await d.api.editOriginal(i.token, body).catch((e) => console.error("discord bot: reply failed", e));
    },
  };
}

async function autocomplete(d: HandlerDeps, i: Interaction): Promise<Handled> {
  const focused = subcommand(i).options.find((o) => o.focused);
  const q = String(focused?.value ?? "").toLowerCase();
  let choices: { name: string; value: string }[] = [];
  try {
    const fates = await listStatFates(await d.db());
    choices = fates
      .filter((f) => f.name.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
      .slice(0, 25)
      .map((f) => ({ name: `${f.name} (${f.tier})`, value: f.name }));
  } catch (err) {
    console.error("discord bot: autocomplete failed", err);
  }
  return { response: { type: AUTOCOMPLETE_RESULT, data: { choices } } };
}

/** Lobby buttons: `lobby:<join|leave|start>:<id>`. */
function component(d: HandlerDeps, i: Interaction): Handled {
  const m = /^lobby:(join|leave|start):(\d+)$/.exec(i.data?.custom_id ?? "");
  if (!m) return reply("That button no longer works.");
  const [, action, idText] = m;
  const lobbyId = Number(idText);
  const messageId = i.message?.id;
  return {
    response: { type: DEFERRED_UPDATE },
    work: async () => {
      try {
        const db = await d.db();
        const ident = memberIdentity(i, d.cfg)!;
        const me = await ensureMemberPlayer(db, ident);
        if (action === "join") await joinLobby(db, lobbyId, me.id, messageId);
        else if (action === "leave") await leaveLobby(db, lobbyId, me.id, messageId);
        else {
          const campaignId = await startLobby(db, lobbyId, { playerId: me.id, isModerator: ident.isModerator }, messageId);
          if (messageId && i.channel_id) {
            await ensureCampaignThread({ db, api: d.api, cfg: d.cfg, base: d.base }, campaignId, {
              channelId: i.channel_id,
              messageId,
            }).catch((e) => console.error("discord bot: thread creation failed", e));
          }
        }
        await d.api.editOriginal(i.token, lobbyMessage(await getLobbyView(db, lobbyId), d.base));
      } catch (err) {
        await d.api
          .followup(i.token, { ...notice(userMessage(err)), flags: EPHEMERAL })
          .catch((e) => console.error("discord bot: followup failed", e));
      }
    },
  };
}
