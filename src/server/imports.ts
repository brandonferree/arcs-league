/**
 * Act imports (docs/ACT_SUMMARY_FORMAT.md, docs/FUTURE_BUILD.md).
 *
 * A summary arrives (meeples pushes it; later the Discord bot hands one over),
 * is stored once per platform game and act, and is then either saved straight
 * away or held for a person to confirm:
 *
 *  - Saved automatically only when it belongs to a known in-progress campaign,
 *    every player is recognised by Discord id or by a name someone confirmed
 *    before (an alias), it is the next act, and the fate rules pass.
 *  - Otherwise held, with the reasons shown on /imports/<id>. Confirming there
 *    says who is who, creates the campaign for an Act I if needed, saves the act
 *    as the person confirming, and remembers the names for next time.
 *
 * Imports never overwrite a saved act. A resend that matches the saved act is
 * accepted again; one that differs is held as a conflict for a moderator.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import {
  actImports,
  campaigns,
  cardTags,
  cards,
  fates,
  playerAliases,
  players,
  type ImportStatus,
} from "@/db/schema";
import {
  campaignKeyOf,
  findFate,
  gameWinners,
  leagueCampaignId,
  matchTableau,
  normaliseName,
  parseActSummary,
  winnerReason,
  type ActSummary,
  type FateRef,
} from "@/lib/import/act-summary";
import type { Actor } from "@/lib/permissions";
import { isParticipant } from "@/lib/permissions";
import type { ActNumber } from "@/lib/rules";
import {
  audit,
  createCampaign,
  getCampaign,
  NotFoundError,
  PermissionError,
  RuleError,
  saveAct,
  saveActAs,
  type ActInput,
  type CampaignDetail,
} from "./campaigns";

// ---------------------------------------------------------------------------
// Shared lookups

async function fateRefs(db: DbOrTx): Promise<FateRef[]> {
  return db.select({ id: fates.id, name: fates.name, cardId: fates.cardId }).from(fates);
}

/** Fate ids for each summary player, or the names that are not fates. */
export async function resolveFates(db: DbOrTx, s: ActSummary): Promise<{ ids: number[]; unknown: string[] }> {
  const refs = await fateRefs(db);
  const ids: number[] = [];
  const unknown: string[] = [];
  for (const p of s.players) {
    const f = findFate(refs, p.fate);
    if (f) ids.push(f.id);
    else unknown.push(p.fate.name);
  }
  return { ids, unknown };
}

interface CampaignLookup {
  campaign: CampaignDetail | null;
  /** Set when the summary named a campaign that cannot be used. */
  problem: string | null;
}

async function findCampaign(db: DbOrTx, s: ActSummary): Promise<CampaignLookup> {
  const named = leagueCampaignId(s.leagueCampaign);
  if (s.leagueCampaign != null && s.leagueCampaign !== "" && named == null) {
    return { campaign: null, problem: `"${s.leagueCampaign}" is not a link to a league campaign.` };
  }
  if (named != null) {
    const c = await getCampaign(db, named);
    return c ? { campaign: c, problem: null } : { campaign: null, problem: `League campaign #${named} does not exist.` };
  }
  const key = campaignKeyOf(s);
  if (!key) return { campaign: null, problem: null };
  const [row] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.sourcePlatform, s.source.platform), eq(campaigns.sourceCampaignKey, key)));
  return { campaign: row ? await getCampaign(db, row.id) : null, problem: null };
}

export type MatchVia = "discord" | "alias" | "name";

export interface PlayerMatch {
  playerId: number;
  name: string;
  via: MatchVia;
}

/**
 * Who each summary player is. Discord id and aliases are trusted; a matching
 * display name is only a suggestion. With a campaign, only its players count.
 */
async function matchPlayers(db: DbOrTx, s: ActSummary, campaign: CampaignDetail | null): Promise<(PlayerMatch | null)[]> {
  const discordIds = s.players.map((p) => p.discordId).filter((d): d is string => !!d);
  const byDiscord = new Map<string, { id: number; name: string; linked: number | null }>();
  if (discordIds.length) {
    for (const p of await db
      .select({ id: players.id, name: players.displayName, discordId: players.discordId, linked: players.linkedPlayerId })
      .from(players)
      .where(inArray(players.discordId, discordIds))) {
      byDiscord.set(p.discordId!, { id: p.id, name: p.name, linked: p.linked });
    }
  }
  const aliasRows = await db
    .select({ name: playerAliases.name, playerId: players.id, displayName: players.displayName, linked: players.linkedPlayerId })
    .from(playerAliases)
    .innerJoin(players, eq(players.id, playerAliases.playerId))
    .where(
      and(
        eq(playerAliases.platform, s.source.platform),
        inArray(
          playerAliases.name,
          s.players.map((p) => normaliseName(p.name)),
        ),
      ),
    );
  const byAlias = new Map(aliasRows.map((a) => [a.name, a]));

  // Display names to suggest from: the campaign's players, else every member and unlinked guest.
  const pool = campaign
    ? campaign.players.map((p) => ({ id: p.playerId, name: p.name }))
    : await db
        .select({ id: players.id, name: players.displayName })
        .from(players)
        .where(isNull(players.linkedPlayerId));
  const allIds = new Set(pool.map((p) => p.id));

  const names = new Map<number, string>(pool.map((p) => [p.id, p.name]));
  const followLink = async (id: number, linked: number | null) => {
    if (!linked) return id;
    const [p] = await db.select({ id: players.id, name: players.displayName }).from(players).where(eq(players.id, linked));
    if (p) names.set(p.id, p.name);
    return p?.id ?? id;
  };

  const out: (PlayerMatch | null)[] = [];
  for (const p of s.players) {
    let m: PlayerMatch | null = null;
    const d = p.discordId ? byDiscord.get(p.discordId) : undefined;
    const a = byAlias.get(normaliseName(p.name));
    if (d) {
      const id = await followLink(d.id, d.linked);
      m = { playerId: id, name: names.get(id) ?? d.name, via: "discord" };
    } else if (a) {
      const id = await followLink(a.playerId, a.linked);
      m = { playerId: id, name: names.get(id) ?? a.displayName, via: "alias" };
    } else {
      const same = pool.filter((x) => normaliseName(x.name) === normaliseName(p.name));
      if (same.length === 1) m = { playerId: same[0].id, name: same[0].name, via: "name" };
    }
    if (m && campaign && !allIds.has(m.playerId)) m = null;
    out.push(m);
  }
  // Two summary players cannot be the same person.
  const seen = new Map<number, number>();
  out.forEach((m, i) => {
    if (!m) return;
    if (seen.has(m.playerId)) {
      out[i] = null;
      out[seen.get(m.playerId)!] = null;
    } else seen.set(m.playerId, i);
  });
  return out;
}

/** The act form input for a summary, given each summary player's seat at the campaign. */
function toActInput(s: ActSummary, cpIds: number[], fateIds: number[]): ActInput {
  const winnerNames = gameWinners(s);
  const winners = winnerNames
    ? s.players.flatMap((p, i) => (winnerNames.includes(p.name) ? [cpIds[i]] : []))
    : null;
  return {
    playedOn: s.datePlayed,
    vodUrl: "",
    notes: s.notes ?? "",
    results: s.players.map((p, i) => ({
      campaignPlayerId: cpIds[i],
      fateId: fateIds[i],
      score: p.score,
      success: s.act < 3 ? (p.success ?? null) : null,
      seat: p.seat ?? null,
    })),
    winners,
    winnerReason: winners ? winnerReason(s.source.platform) : "",
  };
}

/** True when the saved act already holds exactly these results. */
function sameAsSaved(detail: CampaignDetail, s: ActSummary, cpIds: number[], fateIds: number[]): boolean {
  const act = detail.acts.find((a) => a.actNo === s.act);
  if (!act) return false;
  return s.players.every((p, i) => {
    const r = act.results[cpIds[i]];
    return (
      !!r &&
      r.fateId === fateIds[i] &&
      r.score === p.score &&
      (s.act === 3 || r.success === (p.success ?? null))
    );
  });
}

/** Adds the summary's tableau cards to the act. Returns the card names it could not match. */
async function tagTableaus(
  db: DbOrTx,
  actor: Actor | null,
  s: ActSummary,
  campaignId: number,
  actId: number,
  cpIds: number[],
): Promise<string[]> {
  if (!s.players.some((p) => p.tableau?.length)) return [];
  const known = await db.select({ id: cards.id, name: cards.name }).from(cards).where(isNull(cards.removedAt));
  const unmatched: string[] = [];
  const added: { player: string; cards: string[] }[] = [];
  for (const [i, p] of s.players.entries()) {
    const m = matchTableau(known, p.tableau);
    unmatched.push(...m.unmatched);
    if (!m.cardIds.length) continue;
    await db
      .insert(cardTags)
      .values(m.cardIds.map((cardId) => ({ actId, campaignPlayerId: cpIds[i], cardId, taggedById: actor?.playerId ?? null })))
      .onConflictDoNothing();
    added.push({ player: p.name, cards: m.cardIds });
  }
  if (added.length) {
    await audit(db, actor, {
      action: "card_tag.import",
      entityType: "act",
      entityId: actId,
      campaignId,
      after: { tableaus: added, unmatched },
    });
  }
  return unmatched;
}

/** Records the platform's campaign key on a campaign that does not have one yet. */
async function claimSource(db: DbOrTx, campaign: CampaignDetail, s: ActSummary) {
  const key = campaignKeyOf(s);
  if (!key) return;
  const [row] = await db
    .select({ platform: campaigns.sourcePlatform, key: campaigns.sourceCampaignKey })
    .from(campaigns)
    .where(eq(campaigns.id, campaign.id));
  if (row?.key) return;
  const [taken] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.sourcePlatform, s.source.platform), eq(campaigns.sourceCampaignKey, key)));
  if (taken) return;
  await db
    .update(campaigns)
    .set({ sourcePlatform: s.source.platform, sourceCampaignKey: key })
    .where(eq(campaigns.id, campaign.id));
}

// ---------------------------------------------------------------------------
// Receive

export type ReceiveOutcome =
  | { status: "saved"; importId: number; campaignId: number; actNo: ActNumber }
  | { status: "pending"; importId: number; problems: string[] }
  | { status: "conflict"; importId: number; campaignId: number; actNo: ActNumber }
  | { status: "invalid"; errors: string[] };

const roman = (n: number) => ["I", "II", "III"][n - 1];

/**
 * Stores a summary and saves it if nothing needs a person. `raw` is the request
 * body (JSON text or a parsed value).
 */
export async function receiveImport(db: DbOrTx, raw: unknown, now = new Date()): Promise<ReceiveOutcome> {
  const parsed = parseActSummary(raw);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors };
  const s = parsed.summary;
  const fateCheck = await resolveFates(db, s);
  if (fateCheck.unknown.length) {
    return { status: "invalid", errors: fateCheck.unknown.map((n) => `"${n}" is not one of the 24 fates.`) };
  }
  const fateIds = fateCheck.ids;
  const gameId = s.source.gameId ?? crypto.randomUUID();
  const actNo = s.act as ActNumber;

  return db.transaction(async (tx) => {
    const [prior] = await tx
      .select()
      .from(actImports)
      .where(and(eq(actImports.platform, s.source.platform), eq(actImports.gameId, gameId), eq(actImports.actNo, actNo)))
      .for("update");

    const { campaign, problem } = await findCampaign(tx, s);
    const matches = await matchPlayers(tx, s, campaign);
    const strong = matches.every((m) => m && m.via !== "name");
    const cpIds = campaign && strong ? matches.map((m) => campaign.players.find((p) => p.playerId === m!.playerId)!.cpId) : null;

    // Stores the row as pending with these problems.
    const hold = async (problems: string[]) => {
      const values = {
        campaignKey: campaignKeyOf(s) ?? gameId,
        payload: s,
        status: "pending" as ImportStatus,
        problems,
        campaignId: campaign?.id ?? null,
        receivedAt: now,
        resolvedById: null,
        resolvedAt: null,
      };
      let id: number;
      if (prior) {
        await tx.update(actImports).set(values).where(eq(actImports.id, prior.id));
        id = prior.id;
      } else {
        const [row] = await tx
          .insert(actImports)
          .values({ ...values, platform: s.source.platform, gameId, actNo })
          .returning({ id: actImports.id });
        id = row.id;
      }
      await audit(tx, null, {
        action: prior ? "import.resend" : "import.receive",
        entityType: "act_import",
        entityId: id,
        campaignId: campaign?.id ?? null,
        after: { platform: s.source.platform, gameId, act: actNo, status: "pending", problems },
      });
      return id;
    };

    // Already saved (by an import or by hand): accept an identical resend, flag a different one.
    const savedAct = campaign?.acts.find((a) => a.actNo === actNo);
    if (campaign && savedAct && cpIds) {
      if (sameAsSaved(campaign, s, cpIds, fateIds)) {
        if (prior?.status === "saved") return { status: "saved", importId: prior.id, campaignId: campaign.id, actNo };
        const id = await hold([]);
        await tx
          .update(actImports)
          .set({ status: "saved", actId: savedAct.id, resolvedAt: now })
          .where(eq(actImports.id, id));
        return { status: "saved", importId: id, campaignId: campaign.id, actNo };
      }
      const id = await hold([
        `Act ${roman(actNo)} of this campaign is already saved with different results. A moderator can edit the act, or discard this import.`,
      ]);
      return { status: "conflict", importId: id, campaignId: campaign.id, actNo };
    }
    if (prior?.status === "saved" && campaign) {
      // Saved before, but the act has since been changed or the players no longer match.
      const id = await hold([
        `Act ${roman(actNo)} was imported before and has since changed on the site. A moderator can edit the act, or discard this import.`,
      ]);
      return { status: "conflict", importId: id, campaignId: campaign.id, actNo };
    }

    const problems: string[] = [];
    if (problem) problems.push(problem);
    if (!campaign) {
      if (actNo === 1 && !problem) {
        problems.push("This is a new campaign. Confirm who each player is to create it.");
      } else if (!problem) {
        problems.push(
          `No league campaign is linked to this game. Add the campaign's link in ${s.source.platform} and send again, or record the act by hand.`,
        );
      }
    } else {
      s.players.forEach((p, i) => {
        const m = matches[i];
        if (!m) problems.push(`Who is ${p.name}? They are not yet matched to a player in this campaign.`);
        else if (m.via === "name") problems.push(`Confirm that ${p.name} is ${m.name}.`);
      });
    }
    if (problems.length || !campaign || !cpIds) return { status: "pending", importId: await hold(problems), problems };

    // Everything is known: try to save it as the site.
    try {
      const { actId } = await saveActAs(tx, null, campaign.id, actNo, toActInput(s, cpIds, fateIds), now);
      const id = await hold([]);
      const unmatched = await tagTableaus(tx, null, s, campaign.id, actId, cpIds);
      await claimSource(tx, campaign, s);
      await tx
        .update(actImports)
        .set({ status: "saved", actId, resolvedAt: now, problems: unmatched.length ? [`Cards not matched: ${unmatched.join(", ")}`] : [] })
        .where(eq(actImports.id, id));
      await audit(tx, null, {
        action: "import.auto_save",
        entityType: "act_import",
        entityId: id,
        campaignId: campaign.id,
        after: { act: actNo, actId },
      });
      return { status: "saved", importId: id, campaignId: campaign.id, actNo };
    } catch (err) {
      if (!(err instanceof RuleError)) throw err;
      const id = await hold(err.errors);
      return { status: "pending", importId: id, problems: err.errors };
    }
  });
}

// ---------------------------------------------------------------------------
// Read

export interface ImportRowView {
  index: number;
  name: string;
  color: string | null;
  seat: number | null;
  fate: string;
  score: number;
  success: boolean | null;
  winner: boolean | null;
  tableau: string[];
  match: PlayerMatch | null;
}

export interface ImportView {
  id: number;
  platform: string;
  gameId: string;
  actNo: ActNumber;
  status: ImportStatus;
  problems: string[];
  receivedAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  datePlayed: string;
  sourceUrl: string | null;
  notes: string | null;
  campaign: { id: number; title: string; status: CampaignDetail["status"]; players: { playerId: number; name: string }[] } | null;
  /** The act this import saved, or that it clashes with. */
  actId: number | null;
  rows: ImportRowView[];
  /** Members and unlinked guests to choose from when the import creates a campaign. */
  choices: { id: number; name: string; isGuest: boolean }[];
  access: CampaignDetail["access"] | null;
}

function summaryOf(payload: unknown): ActSummary {
  const r = parseActSummary(payload);
  if (!r.ok) throw new Error(`Stored import is no longer valid: ${r.errors.join("; ")}`);
  return r.summary;
}

export async function getImport(db: DbOrTx, id: number): Promise<ImportView | null> {
  const [row] = await db
    .select({ i: actImports, resolvedBy: players.displayName })
    .from(actImports)
    .leftJoin(players, eq(players.id, actImports.resolvedById))
    .where(eq(actImports.id, id));
  if (!row) return null;
  const s = summaryOf(row.i.payload);
  const { campaign } = await findCampaign(db, s);
  const matches = await matchPlayers(db, s, campaign);
  const choices = campaign
    ? []
    : await db
        .select({ id: players.id, name: players.displayName, isGuest: players.isGuest })
        .from(players)
        .where(isNull(players.linkedPlayerId))
        .orderBy(players.isGuest, players.displayName);
  return {
    id: row.i.id,
    platform: row.i.platform,
    gameId: row.i.gameId,
    actNo: row.i.actNo as ActNumber,
    status: row.i.status,
    problems: row.i.problems,
    receivedAt: row.i.receivedAt,
    resolvedAt: row.i.resolvedAt,
    resolvedBy: row.resolvedBy,
    datePlayed: s.datePlayed,
    sourceUrl: s.source.url && /^https?:\/\//i.test(s.source.url) ? s.source.url : null,
    notes: s.notes ?? null,
    campaign: campaign
      ? {
          id: campaign.id,
          title: campaign.title,
          status: campaign.status,
          players: campaign.players.map((p) => ({ playerId: p.playerId, name: p.name })),
        }
      : null,
    actId: row.i.actId ?? campaign?.acts.find((a) => a.actNo === row.i.actNo)?.id ?? null,
    rows: s.players.map((p, i) => ({
      index: i,
      name: p.name,
      color: p.color ?? null,
      seat: p.seat ?? null,
      fate: p.fate.name,
      score: p.score,
      success: p.success ?? null,
      winner: p.winner ?? null,
      tableau: (p.tableau ?? []).map((t) => t.name || t.cardId || "?"),
      match: matches[i],
    })),
    choices,
    access: campaign?.access ?? null,
  };
}

export interface ImportListRow {
  id: number;
  platform: string;
  actNo: number;
  status: ImportStatus;
  problems: string[];
  receivedAt: Date;
  campaignId: number | null;
  campaignTitle: string | null;
  players: string[];
}

export async function listImports(db: DbOrTx, opts: { status?: ImportStatus; campaignId?: number } = {}): Promise<ImportListRow[]> {
  const where = and(
    opts.status ? eq(actImports.status, opts.status) : undefined,
    opts.campaignId ? eq(actImports.campaignId, opts.campaignId) : undefined,
  );
  const rows = await db
    .select({ i: actImports, title: campaigns.title })
    .from(actImports)
    .leftJoin(campaigns, eq(campaigns.id, actImports.campaignId))
    .where(where)
    .orderBy(desc(actImports.receivedAt))
    .limit(200);
  return rows.map(({ i, title }) => {
    const ps = (i.payload as { players?: { name?: unknown }[] }).players ?? [];
    return {
      id: i.id,
      platform: i.platform,
      actNo: i.actNo,
      status: i.status,
      problems: i.problems,
      receivedAt: i.receivedAt,
      campaignId: i.campaignId,
      campaignTitle: title,
      players: ps.map((p) => String(p.name ?? "?")),
    };
  });
}

// ---------------------------------------------------------------------------
// Confirm and discard

export type PlayerChoice = { playerId: number } | { guestName: string };

async function lockPending(db: DbOrTx, id: number) {
  const [row] = await db.select().from(actImports).where(eq(actImports.id, id)).for("update");
  if (!row) throw new NotFoundError("Import not found.");
  if (row.status !== "pending") throw new RuleError([`This import has already been ${row.status}.`]);
  return row;
}

/**
 * A member says who each summary player is; the act is saved as them. For an
 * Act I with no campaign yet, the campaign is created first.
 */
export async function confirmImport(
  db: DbOrTx,
  actor: Actor,
  id: number,
  choices: PlayerChoice[],
  now = new Date(),
): Promise<{ campaignId: number; actNo: ActNumber }> {
  const done = await db.transaction(async (tx) => {
    const row = await lockPending(tx, id);
    const s = summaryOf(row.payload);
    const actNo = s.act as ActNumber;
    if (choices.length !== s.players.length) throw new RuleError(["Say who each player is."]);
    const fateCheck = await resolveFates(tx, s);
    if (fateCheck.unknown.length) throw new RuleError(fateCheck.unknown.map((n) => `"${n}" is not one of the 24 fates.`));
    const fateIds = fateCheck.ids;

    let { campaign, problem } = await findCampaign(tx, s);
    if (problem) throw new RuleError([problem]);
    let created = false;
    if (!campaign) {
      if (actNo !== 1) {
        throw new RuleError(["No league campaign is linked to this game, so only an Act I can start one."]);
      }
      const campaignId = await createCampaign(
        tx,
        actor,
        { players: choices },
        { source: { platform: s.source.platform, key: campaignKeyOf(s) ?? row.gameId } },
      );
      campaign = (await getCampaign(tx, campaignId, now))!;
      created = true;
    }

    // Each summary player's seat at the campaign, in summary order.
    let cpIds: number[];
    if (created) {
      cpIds = campaign.players.map((p) => p.cpId);
    } else {
      const ids = choices.map((c) => ("playerId" in c ? c.playerId : null));
      if (ids.some((x) => x == null)) throw new RuleError(["Choose a player from this campaign for everyone."]);
      if (new Set(ids).size !== ids.length) throw new RuleError(["Two players cannot be the same person."]);
      cpIds = ids.map((pid) => {
        const cp = campaign!.players.find((p) => p.playerId === pid);
        if (!cp) throw new RuleError(["Everyone must be a player in this campaign."]);
        return cp.cpId;
      });
    }

    let actId: number;
    const saved = campaign.acts.find((a) => a.actNo === actNo);
    if (saved) {
      if (!sameAsSaved(campaign, s, cpIds, fateIds)) {
        throw new RuleError([
          `Act ${roman(actNo)} is already saved with different results. Edit it on the act page, or discard this import.`,
        ]);
      }
      actId = saved.id;
    } else {
      ({ actId } = await saveAct(tx, actor, campaign.id, actNo, toActInput(s, cpIds, fateIds), now));
      await tagTableaus(tx, actor, s, campaign.id, actId, cpIds);
    }
    await claimSource(tx, campaign, s);

    // Remember these names so this player's next import matches on its own.
    for (const [i, p] of s.players.entries()) {
      const playerId = campaign.players.find((cp) => cp.cpId === cpIds[i])!.playerId;
      await tx
        .insert(playerAliases)
        .values({ platform: s.source.platform, name: normaliseName(p.name), playerId, createdById: actor.playerId })
        .onConflictDoUpdate({ target: [playerAliases.platform, playerAliases.name], set: { playerId } });
    }

    await tx
      .update(actImports)
      .set({ status: "saved", campaignId: campaign.id, actId, resolvedById: actor.playerId, resolvedAt: now })
      .where(eq(actImports.id, id));
    await audit(tx, actor, {
      action: "import.confirm",
      entityType: "act_import",
      entityId: id,
      campaignId: campaign.id,
      after: {
        act: actNo,
        actId,
        createdCampaign: created,
        players: s.players.map((p, i) => ({ name: p.name, player: campaign!.players.find((cp) => cp.cpId === cpIds[i])!.name })),
      },
    });
    return { campaignId: campaign.id, actNo, platform: row.platform, campaignKey: row.campaignKey };
  });
  await recheckWaiting(db, done.platform, done.campaignKey, now);
  return { campaignId: done.campaignId, actNo: done.actNo };
}

/**
 * Runs the campaign's other waiting imports through again, in act order: an
 * Act II that arrived before Act I was confirmed can now save on its own.
 */
export async function recheckWaiting(db: DbOrTx, platform: string, campaignKey: string, now = new Date()) {
  const waiting = await db
    .select({ id: actImports.id, payload: actImports.payload })
    .from(actImports)
    .where(and(eq(actImports.platform, platform), eq(actImports.campaignKey, campaignKey), eq(actImports.status, "pending")))
    .orderBy(actImports.actNo);
  for (const w of waiting) {
    try {
      await receiveImport(db, w.payload, now);
    } catch (err) {
      console.error(`recheck of import ${w.id} failed`, err);
    }
  }
}

/** Who may discard: moderators, the campaign's participants, or any member when there is no campaign yet. */
export function canDiscardImport(actor: Actor | null, access: CampaignDetail["access"] | null): boolean {
  if (!actor) return false;
  if (actor.isModerator || !access) return true;
  return isParticipant(actor, access);
}

export async function discardImport(db: DbOrTx, actor: Actor, id: number, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lockPending(tx, id);
    const { campaign } = await findCampaign(tx, summaryOf(row.payload));
    if (!canDiscardImport(actor, campaign?.access ?? null)) {
      throw new PermissionError("Only players in this campaign or moderators can discard its imports.");
    }
    await tx
      .update(actImports)
      .set({ status: "discarded", resolvedById: actor.playerId, resolvedAt: now })
      .where(eq(actImports.id, id));
    await audit(tx, actor, {
      action: "import.discard",
      entityType: "act_import",
      entityId: id,
      campaignId: campaign?.id ?? null,
      before: { status: "pending", problems: row.problems },
      after: { status: "discarded" },
    });
  });
}

