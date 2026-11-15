/**
 * The Discord bot against in-memory Postgres (PGlite) and a fake Discord that
 * records what the bot sends.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connectPglite, type DB } from "@/db";
import { acts, campaigns, discordLobbies, fates, players } from "@/db/schema";
import { createCampaign, getCampaign, saveAct } from "@/server/campaigns";
import { DiscordApiError, verifyDiscordRequest, type BotConfig, type DiscordApi, type MessageBody } from "./discord-api";
import { handleInteraction, type Interaction } from "./interactions";
import { escapeMd, lobbyMessage, resultCard } from "./messages";
import { ensureCampaignThread, postActResult, type BotDeps } from "./notify";
import { BOT_PERMISSIONS } from "./register";

// ---------------------------------------------------------------------------
// Signatures

describe("request signatures", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubHex = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
  const now = Date.parse("2026-11-15T12:00:00Z");
  const ts = String(now / 1000);
  const body = '{"type":1}';
  const sig = sign(null, Buffer.from(ts + body), privateKey).toString("hex");

  it("accepts Discord's signature over timestamp + body", () => {
    expect(verifyDiscordRequest(pubHex, sig, ts, body, now)).toBe(true);
  });

  it("rejects a changed body, a missing or malformed signature, and a stale timestamp", () => {
    expect(verifyDiscordRequest(pubHex, sig, ts, '{"type":2}', now)).toBe(false);
    expect(verifyDiscordRequest(pubHex, null, ts, body, now)).toBe(false);
    expect(verifyDiscordRequest(pubHex, "zz", ts, body, now)).toBe(false);
    expect(verifyDiscordRequest(pubHex, sig, ts, body, now + 10 * 60_000)).toBe(false);
    const other = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
    expect(verifyDiscordRequest(other, sig, ts, body, now)).toBe(false);
  });
});

describe("setup", () => {
  it("asks for exactly the permissions the bot uses", () => {
    expect(BOT_PERMISSIONS).toBe("309237730304");
  });
});

// ---------------------------------------------------------------------------
// Fake Discord

interface Call {
  op: string;
  channelId?: string;
  messageId?: string;
  token?: string;
  name?: string;
  body?: MessageBody;
}

function fakeApi() {
  const calls: Call[] = [];
  let n = 0;
  const deleted = new Set<string>();
  const api: DiscordApi = {
    async createMessage(channelId, body) {
      calls.push({ op: "create", channelId, body });
      return { id: `m${++n}` };
    },
    async editMessage(channelId, messageId, body) {
      if (deleted.has(messageId)) throw new DiscordApiError(404, "Unknown Message");
      calls.push({ op: "edit", channelId, messageId, body });
    },
    async startThreadFromMessage(channelId, messageId, name) {
      calls.push({ op: "threadFromMessage", channelId, messageId, name });
      return { id: `t${++n}` };
    },
    async startThread(channelId, name) {
      calls.push({ op: "thread", channelId, name });
      return { id: `t${++n}` };
    },
    async editOriginal(token, body) {
      calls.push({ op: "original", token, body });
      return { id: "lobby-msg" };
    },
    async followup(token, body) {
      calls.push({ op: "followup", token, body });
    },
  };
  return { api, calls, deleted, of: (op: string) => calls.filter((c) => c.op === op) };
}

const cfg: BotConfig = {
  applicationId: "app",
  publicKey: "0".repeat(64),
  botToken: "token",
  guildId: "guild",
  arcsChannelId: "arcs",
  modRoleId: "modrole",
};
const BASE = "https://league.test";

let db: DB;
let discord: ReturnType<typeof fakeApi>;
let fateId: Record<string, number>;

beforeEach(async () => {
  db = await connectPglite();
  discord = fakeApi();
  fateId = Object.fromEntries((await db.select().from(fates)).map((f) => [f.name, f.id]));
});

const deps = () => ({ db: async () => db, api: discord.api, cfg, base: BASE });
const botDeps = (): BotDeps => ({ db, api: discord.api, cfg, base: BASE });

let seq = 0;
function interaction(userId: string, extra: Partial<Interaction>): Interaction {
  return {
    id: `i${++seq}`,
    type: 2,
    token: `tok${seq}`,
    guild_id: "guild",
    channel_id: "arcs",
    channel: { id: "arcs", parent_id: null },
    member: { user: { id: userId, username: `user${userId}`, global_name: `Player ${userId}` }, roles: [] },
    ...extra,
  };
}

const command = (userId: string, group: string, sub: string, options: Interaction["data"] = {}) =>
  interaction(userId, { type: 2, data: { name: group, options: [{ type: 1, name: sub, options: options.options }], resolved: options.resolved } });

const press = (userId: string, customId: string) =>
  interaction(userId, { type: 3, data: { custom_id: customId }, message: { id: "lobby-msg" } });

async function run(i: Interaction) {
  const h = await handleInteraction(deps(), i);
  await h.work?.();
  return h;
}

const lastBody = (op: string) => discord.of(op).at(-1)?.body;
const text = (b: MessageBody | undefined) => JSON.stringify(b ?? {});

// ---------------------------------------------------------------------------

describe("interactions: gatekeeping", () => {
  it("answers Discord's ping", async () => {
    const h = await handleInteraction(deps(), { id: "p", type: 1, token: "t" });
    expect(h.response).toEqual({ type: 1 });
  });

  it("works only in the league's server and in #arcs or its threads", async () => {
    const other = await run({ ...command("1", "campaign", "status"), guild_id: "elsewhere" });
    expect(other.response).toMatchObject({ type: 4, data: { flags: 64 } });

    const wrong = await run({ ...command("1", "campaign", "status"), channel_id: "general", channel: { id: "general" } });
    expect(text((wrong.response as { data: MessageBody }).data)).toContain("<#arcs>");

    const thread = await run({ ...command("1", "campaign", "status"), channel_id: "t9", channel: { id: "t9", parent_id: "arcs" } });
    expect(thread.response).toEqual({ type: 5 });

    const lobbyInThread = await run({ ...command("1", "campaign", "start"), channel_id: "t9", channel: { id: "t9", parent_id: "arcs" } });
    expect(text((lobbyInThread.response as { data: MessageBody }).data)).toContain("not in a thread");
  });
});

describe("lobby to campaign", () => {
  it("opens a lobby, takes joins, starts the campaign and makes its thread", async () => {
    const opened = await run(command("100", "campaign", "start"));
    expect(opened.response).toEqual({ type: 5 });
    const lobby = (await db.select().from(discordLobbies))[0];
    expect(lobby).toMatchObject({ status: "open", messageId: "lobby-msg", channelId: "arcs" });
    expect(text(lastBody("original"))).toContain(`lobby:join:${lobby.id}`);

    // Too few to start.
    await run(press("100", `lobby:start:${lobby.id}`));
    expect(text(lastBody("followup"))).toContain("needs 3 or 4 players");

    await run(press("200", `lobby:join:${lobby.id}`));
    await run(press("200", `lobby:join:${lobby.id}`));
    expect(text(lastBody("followup"))).toContain("already in this lobby");
    await run(press("300", `lobby:join:${lobby.id}`));

    // Someone outside the lobby cannot start it.
    await run(press("999", `lobby:start:${lobby.id}`));
    expect(text(lastBody("followup"))).toContain("Only players in this lobby");

    const started = await run(press("300", `lobby:start:${lobby.id}`));
    expect(started.response).toEqual({ type: 6 });

    const [row] = await db.select().from(discordLobbies);
    expect(row.status).toBe("started");
    const c = (await getCampaign(db, row.campaignId!))!;
    expect(c.players.map((p) => p.name)).toEqual(["Player 100", "Player 200", "Player 300"]);
    expect(c.title).toBe(`Campaign #${c.id}`);

    expect(discord.of("threadFromMessage")).toEqual([
      { op: "threadFromMessage", channelId: "arcs", messageId: "lobby-msg", name: c.title },
    ]);
    expect(c.discordThreadId).toMatch(/^t/);
    const welcome = discord.of("create").find((x) => x.channelId === c.discordThreadId)!;
    expect(welcome.body!.content).toContain("<@100>");
    expect(welcome.body!.allowed_mentions).toEqual({ users: ["100", "200", "300"] });

    const lobbyNow = text(lastBody("original"));
    expect(lobbyNow).toContain("has started");
    expect(lobbyNow).toContain(`<#${c.discordThreadId}>`);

    // Buttons on a started lobby do nothing.
    await run(press("400", `lobby:join:${lobby.id}`));
    expect(text(lastBody("followup"))).toContain("already started");
  });

  it("creates players for members who never signed in, and keeps their names current", async () => {
    await run(command("100", "campaign", "start"));
    const [p] = await db.select().from(players).where(eq(players.discordId, "100"));
    expect(p).toMatchObject({ displayName: "Player 100", isGuest: false });
    await run({ ...command("100", "campaign", "status"), member: { user: { id: "100", username: "u", global_name: "Renamed" }, nick: "Nick", roles: [] } });
    // status does not touch players; a lobby action does
    const lobby = (await db.select().from(discordLobbies))[0];
    await run({ ...press("100", `lobby:leave:${lobby.id}`), member: { user: { id: "100", username: "u" }, nick: "Nick", roles: [] } });
    const [after] = await db.select().from(players).where(eq(players.discordId, "100"));
    expect(after.displayName).toBe("Nick");
  });

  it("closes the lobby when the last player leaves, and caps it at four", async () => {
    await run(command("1", "campaign", "start"));
    const id = (await db.select().from(discordLobbies))[0].id;
    for (const u of ["2", "3", "4"]) await run(press(u, `lobby:join:${id}`));
    await run(press("5", `lobby:join:${id}`));
    expect(text(lastBody("followup"))).toContain("full");
    for (const u of ["1", "2", "3", "4"]) await run(press(u, `lobby:leave:${id}`));
    expect((await db.select().from(discordLobbies))[0].status).toBe("closed");
    expect(text(lastBody("original"))).toContain("lobby closed");
  });

  it("lets a moderator start a lobby they are not in", async () => {
    await run(command("1", "campaign", "start"));
    const id = (await db.select().from(discordLobbies))[0].id;
    await run(press("2", `lobby:join:${id}`));
    await run(press("3", `lobby:join:${id}`));
    await run({ ...press("9", `lobby:start:${id}`), member: { user: { id: "9", username: "mod" }, roles: ["modrole"] } });
    expect((await db.select().from(discordLobbies))[0].status).toBe("started");
  });
});

// ---------------------------------------------------------------------------
// Result cards

async function playedCampaign(threadId: string | null = "t-existing") {
  const rows = await db
    .insert(players)
    .values(["Emma", "Chris", "Mark"].map((n, i) => ({ displayName: n, discordId: `d${i}` })))
    .returning();
  const actor = { playerId: rows[0].id, isModerator: false };
  const id = await createCampaign(db, actor, { players: rows.map((r) => ({ playerId: r.id })) });
  if (threadId) await db.update(campaigns).set({ discordThreadId: threadId }).where(eq(campaigns.id, id));
  const cps = (await getCampaign(db, id))!.players.map((p) => p.cpId);
  const act = (rows2: [string, number, boolean | null][]) => ({
    playedOn: "2026-11-10",
    results: rows2.map(([f, score, success], i) => ({ campaignPlayerId: cps[i], fateId: fateId[f], score, success })),
  });
  return {
    id,
    actor,
    act1: () => saveAct(db, actor, id, 1, act([["Steward", 6, true], ["Founder", 3, false], ["Magnate", -2, false]])),
    act2: () => saveAct(db, actor, id, 2, act([["Steward", 9, true], ["Pirate", 5, true], ["Hegemon", 2, false]])),
    act3: () => saveAct(db, actor, id, 3, act([["Steward", 20, null], ["Pirate", 15, null], ["Overlord", 10, null]])),
  };
}

describe("result cards", () => {
  it("posts a card per act in the thread, edits it when the act is saved again, and announces the winner", async () => {
    const g = await playedCampaign();
    await g.act1();
    await postActResult(botDeps(), g.id, 1);
    const card = discord.of("create")[0];
    expect(card.channelId).toBe("t-existing");
    expect(text(card.body)).toContain("Act I");
    expect(text(card.body)).toContain("Steward (A)");
    expect(text(card.body)).toContain("Record Act II");
    const [a1] = await db.select().from(acts).where(eq(acts.actNo, 1));
    expect(a1.discordMessageId).toBe("m1");

    // Saving again (an edit, or meeples resending) edits the same card.
    await postActResult(botDeps(), g.id, 1);
    expect(discord.of("create")).toHaveLength(1);
    expect(discord.of("edit")).toEqual([expect.objectContaining({ channelId: "t-existing", messageId: "m1" })]);

    await g.act2();
    await postActResult(botDeps(), g.id, 2);
    await g.act3();
    await postActResult(botDeps(), g.id, 3);
    const posts = discord.of("create");
    expect(posts).toHaveLength(4);
    expect(text(posts[2].body)).toContain("🏆");
    const announcement = posts[3];
    expect(announcement.channelId).toBe("arcs");
    expect(announcement.body!.embeds![0].title).toBe(`Emma wins Campaign #${g.id}`);
    expect(text(announcement.body)).toContain("Steward (A) → Steward (A) → Steward (A)");
    expect(text(announcement.body)).toContain("<#t-existing>");
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, g.id));
    expect(c.discordAnnouncementId).toBe("m4");

    // Act III saved again: card and announcement are edited, nothing new is posted.
    await postActResult(botDeps(), g.id, 3);
    expect(discord.of("create")).toHaveLength(4);
    expect(discord.of("edit").map((e) => e.messageId)).toEqual(["m1", "m3", "m4"]);
  });

  it("posts a fresh card if the old one was deleted in Discord", async () => {
    const g = await playedCampaign();
    await g.act1();
    await postActResult(botDeps(), g.id, 1);
    discord.deleted.add("m1");
    await postActResult(botDeps(), g.id, 1);
    const [a1] = await db.select().from(acts).where(eq(acts.actNo, 1));
    expect(a1.discordMessageId).toBe("m2");
  });

  it("gives a campaign made on the site its own thread in #arcs", async () => {
    const g = await playedCampaign(null);
    const threadId = await ensureCampaignThread(botDeps(), g.id);
    expect(discord.of("thread")).toEqual([{ op: "thread", channelId: "arcs", name: `Campaign #${g.id}` }]);
    expect(await ensureCampaignThread(botDeps(), g.id)).toBe(threadId);
    expect(discord.of("thread")).toHaveLength(1);
    await g.act1();
    await postActResult(botDeps(), g.id, 1);
    expect(discord.of("create").at(-1)!.channelId).toBe(threadId);
  });

  it("escapes Discord formatting in names", () => {
    expect(escapeMd("*Star*_Lord_")).toBe("\\*Star\\*\\_Lord\\_");
  });
});

describe("lobby message", () => {
  it("enables Start at three players and disables Join at four", () => {
    const view = (n: number) =>
      lobbyMessage(
        { id: 7, status: "open", openedBy: "Emma", campaign: null, players: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, discordId: `${i}` })) },
        BASE,
      ).components![0].components;
    expect(view(2).map((b) => !!b.disabled)).toEqual([false, false, true]);
    expect(view(3).map((b) => !!b.disabled)).toEqual([false, false, false]);
    expect(view(4).map((b) => !!b.disabled)).toEqual([true, false, false]);
  });
});

// ---------------------------------------------------------------------------
// Status and stats

describe("status and stats commands", () => {
  it("lists campaigns in progress with their threads", async () => {
    await run(command("1", "campaign", "status"));
    expect(text(lastBody("original"))).toContain("No campaigns are in progress");
    const g = await playedCampaign();
    await g.act1();
    await run(command("1", "campaign", "status"));
    const body = text(lastBody("original"));
    expect(body).toContain(`Campaign #${g.id}`);
    expect(body).toContain("1 of 3 acts, next: Act II");
    expect(body).toContain("<#t-existing>");
  });

  it("shows a player's record, counting closed campaigns only", async () => {
    const g = await playedCampaign();
    await g.act1();
    await run(command("d0", "stats", "player"));
    expect(text(lastBody("original"))).toContain("You have not finished a league campaign yet");
    await g.act2();
    await g.act3();
    await run(
      command("d1", "stats", "player", {
        options: [{ type: 6, name: "member", value: "d0" }],
        resolved: { users: { d0: { id: "d0", username: "emma" } } },
      }),
    );
    const e = lastBody("original")!.embeds![0];
    expect(e.title).toBe("Emma");
    expect(e.fields!.find((f) => f.name === "Wins")!.value).toBe("1");
    expect(e.fields!.find((f) => f.name === "Win rate")!.value).toBe("100%");
  });

  it("shows a fate's record, matching names loosely, and autocompletes fate names", async () => {
    const g = await playedCampaign();
    await g.act1();
    await g.act2();
    await g.act3();
    await run(command("1", "stats", "fate", { options: [{ type: 3, name: "name", value: "steward" }] }));
    const e = lastBody("original")!.embeds![0];
    expect(e.title).toBe("Steward (A)");
    expect(e.url).toBe(`${BASE}/fates/steward`);
    expect(e.fields!.find((f) => f.name === "Plays (I / II / III)")!.value).toBe("1 / 1 / 1");

    await run(command("1", "stats", "fate", { options: [{ type: 3, name: "name", value: "Nobody" }] }));
    expect(lastBody("original")!.content).toBe('There is no fate called "Nobody".');

    const ac = await handleInteraction(
      deps(),
      interaction("1", { type: 4, data: { name: "stats", options: [{ type: 1, name: "fate", options: [{ type: 3, name: "name", value: "pla", focused: true }] }] } }),
    );
    expect(ac.response).toEqual({ type: 8, data: { choices: [{ name: "Planet Breaker (B)", value: "Planet Breaker" }] } });
  });
});

describe("result card wording", () => {
  it("returns nothing for an act that is not saved", async () => {
    const g = await playedCampaign();
    expect(resultCard((await getCampaign(db, g.id))!, 1, BASE)).toBeNull();
  });
});
