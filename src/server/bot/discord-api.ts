/**
 * The bot's side of Discord (spec section 2): no gateway connection. Discord
 * calls /api/discord/interactions for commands and buttons, and the bot writes
 * to channels with its token over REST. Ids come from the environment, never
 * the repository.
 */
import { createPublicKey, verify } from "node:crypto";

const API = "https://discord.com/api/v10";

export interface BotConfig {
  /** The application id; the same as the OAuth client id. */
  applicationId: string;
  publicKey: string;
  botToken: string;
  guildId: string;
  /** #arcs: commands work there and in its threads; campaign threads are made there. */
  arcsChannelId: string;
  modRoleId: string | null;
}

/** Null until every bot variable is set; the bot is then switched off. */
export function botConfig(): BotConfig | null {
  const env = (k: string) => process.env[k]?.trim() || "";
  const cfg = {
    applicationId: env("DISCORD_CLIENT_ID"),
    publicKey: env("DISCORD_PUBLIC_KEY"),
    botToken: env("DISCORD_BOT_TOKEN"),
    guildId: env("DISCORD_GUILD_ID"),
    arcsChannelId: env("DISCORD_ARCS_CHANNEL_ID"),
    modRoleId: env("DISCORD_MOD_ROLE_ID") || null,
  };
  if (!cfg.applicationId || !cfg.publicKey || !cfg.botToken || !cfg.guildId || !cfg.arcsChannelId) return null;
  return cfg;
}

// ---------------------------------------------------------------------------
// Request signatures

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
/** Reject requests whose signed timestamp is further than this from now (replays). */
const MAX_SKEW_SECONDS = 5 * 60;

/**
 * Checks Discord's Ed25519 signature over timestamp + raw body. Discord tests
 * the endpoint with bad signatures when it is saved, and expects a 401.
 */
export function verifyDiscordRequest(
  publicKeyHex: string,
  signatureHex: string | null,
  timestamp: string | null,
  body: string,
  nowMs = Date.now(),
): boolean {
  if (!signatureHex || !timestamp) return false;
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowMs / 1000 - ts) > MAX_SKEW_SECONDS) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Messages and REST

export interface Embed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}

export interface Button {
  type: 2;
  /** 1 primary, 2 secondary, 3 success, 4 danger, 5 link. */
  style: 1 | 2 | 3 | 4 | 5;
  label: string;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

export interface MessageBody {
  content?: string;
  embeds?: Embed[];
  components?: { type: 1; components: Button[] }[];
  allowed_mentions?: { parse?: readonly ("users" | "roles" | "everyone")[]; users?: string[] };
  /** 64 = only the person who used the command sees it. */
  flags?: number;
}

export const EPHEMERAL = 64;

export class DiscordApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "DiscordApiError";
  }
}

/** Everything the bot sends to Discord; a fake stands in for it in tests. */
export interface DiscordApi {
  createMessage(channelId: string, body: MessageBody): Promise<{ id: string }>;
  editMessage(channelId: string, messageId: string, body: MessageBody): Promise<void>;
  /** A public thread hanging off a message (the lobby). */
  startThreadFromMessage(channelId: string, messageId: string, name: string): Promise<{ id: string }>;
  /** A public thread with no starter message (campaigns made on the site). */
  startThread(channelId: string, name: string): Promise<{ id: string }>;
  /** Replaces the deferred reply to an interaction. */
  editOriginal(interactionToken: string, body: MessageBody): Promise<{ id: string }>;
  /** A further reply to an interaction, e.g. a private error after a button press. */
  followup(interactionToken: string, body: MessageBody): Promise<void>;
}

/** Thread names are capped at 100 characters. */
export function threadName(title: string): string {
  return title.length > 100 ? `${title.slice(0, 99)}…` : title;
}

/** Threads archive after a week without messages; posting reopens them. */
const ARCHIVE_MINUTES = 10080;

export function restApi(cfg: Pick<BotConfig, "applicationId" | "botToken">): DiscordApi {
  async function call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "DiscordBot (arcs-league, 1.0)",
          ...(auth ? { Authorization: `Bot ${cfg.botToken}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429 && attempt < 2) {
        const wait = Number((await res.json().catch(() => ({})) as { retry_after?: number }).retry_after ?? 1);
        await new Promise((r) => setTimeout(r, Math.min(wait, 5) * 1000));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new DiscordApiError(res.status, `Discord ${method} ${path.split("?")[0]} failed (${res.status}): ${text.slice(0, 300)}`);
      }
      return (res.status === 204 ? undefined : await res.json()) as T;
    }
  }
  const hook = (token: string) => `/webhooks/${cfg.applicationId}/${token}`;
  return {
    createMessage: (channelId, body) => call("POST", `/channels/${channelId}/messages`, body),
    editMessage: async (channelId, messageId, body) => {
      await call("PATCH", `/channels/${channelId}/messages/${messageId}`, body);
    },
    startThreadFromMessage: (channelId, messageId, name) =>
      call("POST", `/channels/${channelId}/messages/${messageId}/threads`, {
        name: threadName(name),
        auto_archive_duration: ARCHIVE_MINUTES,
      }),
    startThread: (channelId, name) =>
      call("POST", `/channels/${channelId}/threads`, { name: threadName(name), type: 11, auto_archive_duration: ARCHIVE_MINUTES }),
    editOriginal: (token, body) => call("PATCH", `${hook(token)}/messages/@original`, body, false),
    followup: async (token, body) => {
      await call("POST", hook(token), body, false);
    },
  };
}
