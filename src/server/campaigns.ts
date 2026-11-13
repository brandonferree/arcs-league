/**
 * Campaign reads and writes. Every write re-validates with the shared rules
 * module, checks permissions, runs in a transaction and writes the audit log.
 * Functions take the database as a parameter so tests can use in-memory PGlite.
 */
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import {
  actResults,
  acts,
  auditLog,
  campaignPlayers,
  campaigns,
  fates,
  players,
  seasons,
  type CampaignStatus,
} from "@/db/schema";
import {
  canEditAct,
  canRecordAct,
  isParticipant,
  isStalled,
  STALLED_AFTER_DAYS,
  type Actor,
  type CampaignAccess,
} from "@/lib/permissions";
import {
  resolveWinners,
  tierLookupFrom,
  validateCampaign,
  validateFateRules,
  validateTableSize,
  type ActNumber,
  type PlayerRecord,
  type Tier,
} from "@/lib/rules";
import { pickChampion } from "@/lib/stats";

/** A rejected write. `errors` are user-facing messages. */
export class RuleError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "RuleError";
  }
}

export class PermissionError extends Error {
  constructor(message = "You are not allowed to do that.") {
    super(message);
    this.name = "PermissionError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

function zodMessages(err: z.ZodError): string[] {
  return err.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
}

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new RuleError(zodMessages(r.error));
  return r.data;
}

async function audit(
  db: DbOrTx,
  actor: Actor,
  e: { action: string; entityType: string; entityId: string | number; campaignId?: number | null; before?: unknown; after?: unknown },
) {
  await db.insert(auditLog).values({
    actorId: actor.playerId,
    action: e.action,
    entityType: e.entityType,
    entityId: String(e.entityId),
    campaignId: e.campaignId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
  });
}

// ---------------------------------------------------------------------------
// Reference data

export interface FateRow {
  id: number;
  name: string;
  tier: Tier;
  act: number;
}

export async function listFates(db: DbOrTx): Promise<FateRow[]> {
  return db
    .select({ id: fates.id, name: fates.name, tier: fates.tier, act: fates.act })
    .from(fates)
    .orderBy(asc(fates.sortOrder), asc(fates.name));
}

export async function listSeasons(db: DbOrTx) {
  return db.select().from(seasons).orderBy(desc(seasons.startsOn), asc(seasons.name));
}

/** Members and unlinked guests, for the campaign player picker. */
export async function listSelectablePlayers(db: DbOrTx) {
  return db
    .select({ id: players.id, name: players.displayName, isGuest: players.isGuest })
    .from(players)
    .where(isNull(players.linkedPlayerId))
    .orderBy(asc(players.isGuest), asc(sql`lower(${players.displayName})`));
}

// ---------------------------------------------------------------------------
// Create

export const createCampaignInput = z.object({
  title: z.string().trim().max(120).optional().default(""),
  seasonId: z.number().int().positive().nullable().optional(),
  players: z
    .array(
      z.union([
        z.object({ playerId: z.number().int().positive() }),
        z.object({ guestName: z.string().trim().min(1, "Guest name is required").max(40) }),
      ]),
    )
    .max(8),
});
export type CreateCampaignInput = z.input<typeof createCampaignInput>;

export async function createCampaign(db: DB, actor: Actor, raw: unknown): Promise<number> {
  const input = parse(createCampaignInput, raw);

  const sizeErrors = validateTableSize(input.players.length).map((v) => v.message);
  if (sizeErrors.length) throw new RuleError(sizeErrors);

  const ids = input.players.flatMap((p) => ("playerId" in p ? [p.playerId] : []));
  if (new Set(ids).size !== ids.length) throw new RuleError(["The same player is listed more than once."]);

  return db.transaction(async (tx) => {
    const known = ids.length
      ? await tx.select().from(players).where(inArray(players.id, ids))
      : [];
    const byId = new Map(known.map((p) => [p.id, p]));
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) throw new RuleError([`Unknown player #${id}.`]);
      if (p.linkedPlayerId) throw new RuleError([`${p.displayName} has been merged into another account.`]);
    }

    // Resolve each seat to a player id, reusing an unlinked guest with the same name.
    const resolved: { id: number; name: string }[] = [];
    for (const entry of input.players) {
      if ("playerId" in entry) {
        const p = byId.get(entry.playerId)!;
        resolved.push({ id: p.id, name: p.displayName });
        continue;
      }
      const name = entry.guestName;
      const [existing] = await tx
        .select()
        .from(players)
        .where(and(eq(players.isGuest, true), isNull(players.linkedPlayerId), sql`lower(${players.displayName}) = lower(${name})`))
        .limit(1);
      if (existing) {
        resolved.push({ id: existing.id, name: existing.displayName });
      } else {
        const [guest] = await tx
          .insert(players)
          .values({ displayName: name, isGuest: true, createdById: actor.playerId })
          .returning();
        await audit(tx, actor, { action: "player.create_guest", entityType: "player", entityId: guest.id, after: { name } });
        resolved.push({ id: guest.id, name: guest.displayName });
      }
    }

    const nameErrors = validateFateRules(resolved.map((r) => ({ name: r.name }))).map((v) => v.message);
    if (new Set(resolved.map((r) => r.id)).size !== resolved.length) {
      nameErrors.push("The same player is listed more than once.");
    }
    if (nameErrors.length) throw new RuleError(nameErrors);

    if (input.seasonId) {
      const [s] = await tx.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, input.seasonId));
      if (!s) throw new RuleError(["Unknown season."]);
    }

    const [c] = await tx
      .insert(campaigns)
      .values({
        title: input.title || "Untitled campaign",
        seasonId: input.seasonId ?? null,
        playerCount: resolved.length,
        createdById: actor.playerId,
      })
      .returning();
    let title = c.title;
    if (!input.title) {
      title = `Campaign #${c.id}`;
      await tx.update(campaigns).set({ title }).where(eq(campaigns.id, c.id));
    }
    await tx.insert(campaignPlayers).values(
      resolved.map((r, i) => ({ campaignId: c.id, playerId: r.id, position: i + 1 })),
    );
    await audit(tx, actor, {
      action: "campaign.create",
      entityType: "campaign",
      entityId: c.id,
      campaignId: c.id,
      after: { title, seasonId: input.seasonId ?? null, players: resolved.map((r) => r.name) },
    });
    return c.id;
  });
}

// ---------------------------------------------------------------------------
// Read one

export interface ResultView {
  fateId: number;
  fate: string;
  tier: Tier;
  score: number;
  success: boolean | null;
  seat: number | null;
}

export interface ActView {
  id: number;
  actNo: ActNumber;
  playedOn: string;
  vodUrl: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  /** keyed by campaign player id */
  results: Record<number, ResultView>;
}

export interface CampaignPlayerView {
  cpId: number;
  playerId: number;
  name: string;
  isGuest: boolean;
  isWinner: boolean;
  position: number;
}

export interface CampaignDetail {
  id: number;
  title: string;
  status: CampaignStatus;
  stalled: boolean;
  playerCount: number;
  season: { id: number; name: string } | null;
  winnerOverridden: boolean;
  winnerOverrideReason: string | null;
  voidReason: string | null;
  discordThreadId: string | null;
  createdAt: Date;
  closedAt: Date | null;
  lastActivityAt: Date;
  createdById: number | null;
  createdBy: string | null;
  players: CampaignPlayerView[];
  acts: ActView[];
  access: CampaignAccess;
}

export async function getCampaign(db: DbOrTx, id: number, now = new Date()): Promise<CampaignDetail | null> {
  const [c] = await db
    .select({ c: campaigns, seasonName: seasons.name, createdBy: players.displayName })
    .from(campaigns)
    .leftJoin(seasons, eq(seasons.id, campaigns.seasonId))
    .leftJoin(players, eq(players.id, campaigns.createdById))
    .where(eq(campaigns.id, id));
  if (!c) return null;

  const cps = await db
    .select({
      cpId: campaignPlayers.id,
      playerId: campaignPlayers.playerId,
      name: players.displayName,
      isGuest: players.isGuest,
      isWinner: campaignPlayers.isWinner,
      position: campaignPlayers.position,
    })
    .from(campaignPlayers)
    .innerJoin(players, eq(players.id, campaignPlayers.playerId))
    .where(eq(campaignPlayers.campaignId, id))
    .orderBy(asc(campaignPlayers.position));

  const creator = alias(players, "creator");
  const updater = alias(players, "updater");
  const actRows = await db
    .select({ act: acts, createdBy: creator.displayName, updatedBy: updater.displayName })
    .from(acts)
    .leftJoin(creator, eq(creator.id, acts.createdById))
    .leftJoin(updater, eq(updater.id, acts.updatedById))
    .where(eq(acts.campaignId, id))
    .orderBy(asc(acts.actNo));

  const resultRows = actRows.length
    ? await db
        .select({
          actId: actResults.actId,
          cpId: actResults.campaignPlayerId,
          fateId: actResults.fateId,
          fate: fates.name,
          tier: fates.tier,
          score: actResults.score,
          success: actResults.success,
          seat: actResults.seat,
        })
        .from(actResults)
        .innerJoin(fates, eq(fates.id, actResults.fateId))
        .where(inArray(actResults.actId, actRows.map((a) => a.act.id)))
    : [];

  const actViews: ActView[] = actRows.map(({ act, createdBy, updatedBy }) => {
    const results: Record<number, ResultView> = {};
    for (const r of resultRows.filter((r) => r.actId === act.id)) {
      results[r.cpId] = { fateId: r.fateId, fate: r.fate, tier: r.tier, score: r.score, success: r.success, seat: r.seat };
    }
    return {
      id: act.id,
      actNo: act.actNo as ActNumber,
      playedOn: act.playedOn,
      vodUrl: act.vodUrl,
      notes: act.notes,
      createdAt: act.createdAt,
      updatedAt: act.updatedAt,
      createdBy,
      updatedBy,
      results,
    };
  });

  const camp = c.c;
  return {
    id: camp.id,
    title: camp.title,
    status: camp.status,
    stalled: isStalled(camp.status, camp.lastActivityAt, now),
    playerCount: camp.playerCount,
    season: camp.seasonId && c.seasonName ? { id: camp.seasonId, name: c.seasonName } : null,
    winnerOverridden: camp.winnerOverridden,
    winnerOverrideReason: camp.winnerOverrideReason,
    voidReason: camp.voidReason,
    discordThreadId: camp.discordThreadId,
    createdAt: camp.createdAt,
    closedAt: camp.closedAt,
    lastActivityAt: camp.lastActivityAt,
    createdById: camp.createdById,
    createdBy: c.createdBy,
    players: cps,
    acts: actViews,
    access: { status: camp.status, createdById: camp.createdById, playerIds: cps.map((p) => p.playerId) },
  };
}

/** Builds rule-checker input from a campaign, optionally replacing one act. */
export function toPlayerRecords(
  detail: Pick<CampaignDetail, "players" | "acts">,
  replace?: { actNo: ActNumber; results: Record<number, { fate: string; success: boolean | null; score: number }> },
): PlayerRecord[] {
  return detail.players.map((p) => {
    const rec: PlayerRecord = { name: p.name };
    for (const n of [1, 2, 3] as const) {
      const src = replace?.actNo === n ? replace.results[p.cpId] : detail.acts.find((a) => a.actNo === n)?.results[p.cpId];
      if (src) rec[`act${n}`] = { fate: src.fate, success: src.success, score: src.score };
    }
    return rec;
  });
}

// ---------------------------------------------------------------------------
// Save an act

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Not a valid date");

export const actInput = z.object({
  playedOn: dateString,
  vodUrl: z
    .string()
    .trim()
    .max(500)
    .refine((s) => s === "" || /^https?:\/\/\S+$/i.test(s), "VOD link must be an http(s) URL")
    .optional()
    .default(""),
  notes: z.string().trim().max(4000).optional().default(""),
  results: z.array(
    z.object({
      campaignPlayerId: z.number().int().positive(),
      fateId: z.number().int().positive("Choose a fate"),
      score: z.number().int("Score must be a whole number").min(0, "Score cannot be negative").max(999),
      success: z.boolean().nullable().optional(),
      seat: z.number().int().min(1).max(4).nullable().optional(),
    }),
  ),
  /** Act III only: campaign player ids of the winner(s) when overriding the default. */
  winners: z.array(z.number().int().positive()).nullable().optional(),
  winnerReason: z.string().trim().max(500).optional().default(""),
});
export type ActInput = z.input<typeof actInput>;

function actSnapshot(
  detail: CampaignDetail,
  act: { actNo: number; playedOn: string; vodUrl: string | null; notes: string | null },
  results: Record<number, ResultView>,
) {
  return {
    actNo: act.actNo,
    playedOn: act.playedOn,
    vodUrl: act.vodUrl,
    notes: act.notes,
    results: detail.players
      .filter((p) => results[p.cpId])
      .map((p) => ({
        player: p.name,
        fate: results[p.cpId].fate,
        score: results[p.cpId].score,
        success: results[p.cpId].success,
        seat: results[p.cpId].seat,
      })),
  };
}

export async function saveAct(
  db: DB,
  actor: Actor,
  campaignId: number,
  actNo: ActNumber,
  raw: unknown,
  now = new Date(),
): Promise<{ closed: boolean }> {
  if (![1, 2, 3].includes(actNo)) throw new NotFoundError("There are only three acts.");
  const input = parse(actInput, raw);

  return db.transaction(async (tx) => {
    // Lock the campaign row so two people saving at once cannot interleave.
    await tx.execute(sql`select id from campaigns where id = ${campaignId} for update`);
    const detail = await getCampaign(tx, campaignId, now);
    if (!detail) throw new NotFoundError("Campaign not found.");

    const existing = detail.acts.find((a) => a.actNo === actNo);
    if (existing) {
      if (!canEditAct(actor, detail.access, existing.createdAt, now)) {
        throw new PermissionError(
          isParticipant(actor, detail.access)
            ? "The 24-hour edit window for this act has closed. Ask a moderator to change it."
            : "Only players in this campaign or moderators can edit it.",
        );
      }
    } else {
      if (!canRecordAct(actor, detail.access)) {
        throw new PermissionError(
          detail.status !== "in_progress"
            ? "This campaign is not in progress."
            : "Only players in this campaign or moderators can record acts.",
        );
      }
      if (actNo !== detail.acts.length + 1) {
        throw new RuleError([`Record Act ${["I", "II"][detail.acts.length] ?? "III"} first.`]);
      }
    }

    // Every player exactly once.
    const errors: string[] = [];
    const cpIds = new Set(detail.players.map((p) => p.cpId));
    const given = input.results.map((r) => r.campaignPlayerId);
    if (given.length !== cpIds.size || new Set(given).size !== given.length || !given.every((g) => cpIds.has(g))) {
      throw new RuleError(["Enter one result for each player in the campaign."]);
    }

    const allFates = await listFates(tx);
    const fateById = new Map(allFates.map((f) => [f.id, f]));
    const nameOf = new Map(detail.players.map((p) => [p.cpId, p.name]));

    for (const r of input.results) {
      const nm = nameOf.get(r.campaignPlayerId)!;
      if (!fateById.has(r.fateId)) errors.push(`${nm}: choose a fate.`);
      if (actNo < 3 && typeof r.success !== "boolean") errors.push(`${nm}: say whether the fate succeeded in this act.`);
    }
    const seats = input.results.map((r) => r.seat).filter((s): s is number => s != null);
    if (new Set(seats).size !== seats.length) errors.push("Two players cannot share a seat.");
    if (seats.some((s) => s > detail.playerCount)) errors.push(`Seats run from 1 to ${detail.playerCount}.`);
    if (errors.length) throw new RuleError(errors);

    const newResults: Record<number, ResultView> = {};
    for (const r of input.results) {
      const f = fateById.get(r.fateId)!;
      newResults[r.campaignPlayerId] = {
        fateId: f.id,
        fate: f.name,
        tier: f.tier,
        score: r.score,
        success: actNo < 3 ? (r.success as boolean) : null,
        seat: r.seat ?? null,
      };
    }

    const violations = validateCampaign(
      toPlayerRecords(detail, { actNo, results: newResults }),
      tierLookupFrom(allFates),
    );
    if (violations.length) throw new RuleError(violations.map((v) => v.message));

    // Winner (Act III).
    let decision: ReturnType<typeof resolveWinners> | null = null;
    if (actNo === 3) {
      const chosen = input.winners?.map((cp) => {
        const n = nameOf.get(cp);
        if (!n) throw new RuleError(["A chosen winner is not a player in this campaign."]);
        return n;
      });
      decision = resolveWinners(
        detail.players.map((p) => ({ name: p.name, score: newResults[p.cpId].score })),
        chosen ?? null,
        input.winnerReason,
      );
      if (decision.errors.length) throw new RuleError(decision.errors);
    }

    // Write.
    const values = {
      playedOn: input.playedOn,
      vodUrl: input.vodUrl || null,
      notes: input.notes || null,
    };
    let actId: number;
    if (existing) {
      await tx
        .update(acts)
        .set({ ...values, updatedById: actor.playerId, updatedAt: now })
        .where(eq(acts.id, existing.id));
      actId = existing.id;
    } else {
      const [row] = await tx
        .insert(acts)
        .values({ ...values, campaignId, actNo, createdById: actor.playerId, createdAt: now, updatedAt: now })
        .returning({ id: acts.id });
      actId = row.id;
    }

    for (const [cpId, r] of Object.entries(newResults)) {
      const row = { fateId: r.fateId, score: r.score, success: r.success, seat: r.seat };
      await tx
        .insert(actResults)
        .values({ actId, campaignPlayerId: Number(cpId), ...row })
        .onConflictDoUpdate({ target: [actResults.actId, actResults.campaignPlayerId], set: row });
    }

    const campaignUpdate: Partial<typeof campaigns.$inferInsert> = { lastActivityAt: now, updatedAt: now };
    let closed = false;
    if (decision) {
      const winnerNames = new Set(decision.winners);
      for (const p of detail.players) {
        await tx
          .update(campaignPlayers)
          .set({ isWinner: winnerNames.has(p.name) })
          .where(eq(campaignPlayers.id, p.cpId));
      }
      campaignUpdate.winnerOverridden = decision.overridden;
      campaignUpdate.winnerOverrideReason = decision.reason;
      if (detail.status === "in_progress") {
        campaignUpdate.status = "closed";
        campaignUpdate.closedAt = now;
        closed = true;
      }
    }
    await tx.update(campaigns).set(campaignUpdate).where(eq(campaigns.id, campaignId));

    const before = existing ? actSnapshot(detail, existing, existing.results) : null;
    const after = {
      ...actSnapshot(detail, { actNo, ...values }, newResults),
      ...(decision ? { winners: decision.winners, winnerOverridden: decision.overridden, winnerReason: decision.reason } : {}),
    };
    if (before && actNo === 3) {
      Object.assign(before, {
        winners: detail.players.filter((p) => p.isWinner).map((p) => p.name),
        winnerOverridden: detail.winnerOverridden,
        winnerReason: detail.winnerOverrideReason,
      });
    }
    await audit(tx, actor, {
      action: existing ? "act.update" : "act.create",
      entityType: "act",
      entityId: actId,
      campaignId,
      before,
      after,
    });
    if (closed) {
      await audit(tx, actor, {
        action: "campaign.close",
        entityType: "campaign",
        entityId: campaignId,
        campaignId,
        before: { status: "in_progress" },
        after: { status: "closed", winners: decision!.winners },
      });
    }
    return { closed };
  });
}

// ---------------------------------------------------------------------------
// Moderator actions

function requireModerator(actor: Actor) {
  if (!actor.isModerator) throw new PermissionError("Only moderators can do that.");
}

export async function voidCampaign(db: DB, actor: Actor, campaignId: number, reason: string) {
  requireModerator(actor);
  const why = reason.trim();
  if (!why) throw new RuleError(["Give a reason for voiding the campaign."]);
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!c) throw new NotFoundError("Campaign not found.");
    if (c.status === "void") return;
    await tx.update(campaigns).set({ status: "void", voidReason: why, updatedAt: new Date() }).where(eq(campaigns.id, campaignId));
    await audit(tx, actor, {
      action: "campaign.void", entityType: "campaign", entityId: campaignId, campaignId,
      before: { status: c.status }, after: { status: "void", reason: why },
    });
  });
}

/** Un-voids a campaign, or un-stalls an in-progress one by resetting its activity clock. */
export async function reopenCampaign(db: DB, actor: Actor, campaignId: number) {
  requireModerator(actor);
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!c) throw new NotFoundError("Campaign not found.");
    const [act3] = await tx
      .select({ id: acts.id })
      .from(acts)
      .where(and(eq(acts.campaignId, campaignId), eq(acts.actNo, 3)));
    const status: CampaignStatus = act3 ? "closed" : "in_progress";
    const now = new Date();
    await tx
      .update(campaigns)
      .set({ status, voidReason: null, lastActivityAt: now, updatedAt: now })
      .where(eq(campaigns.id, campaignId));
    await audit(tx, actor, {
      action: "campaign.reopen", entityType: "campaign", entityId: campaignId, campaignId,
      before: { status: c.status, lastActivityAt: c.lastActivityAt, voidReason: c.voidReason },
      after: { status, lastActivityAt: now },
    });
  });
}

export async function deleteCampaign(db: DB, actor: Actor, campaignId: number) {
  requireModerator(actor);
  await db.transaction(async (tx) => {
    const detail = await getCampaign(tx, campaignId);
    if (!detail) throw new NotFoundError("Campaign not found.");
    await tx.delete(campaigns).where(eq(campaigns.id, campaignId));
    await audit(tx, actor, {
      action: "campaign.delete", entityType: "campaign", entityId: campaignId, campaignId,
      before: {
        title: detail.title,
        status: detail.status,
        players: detail.players.map((p) => ({ name: p.name, winner: p.isWinner })),
        acts: detail.acts.map((a) => actSnapshot(detail, a, a.results)),
      },
    });
  });
}

export async function campaignHistory(db: DbOrTx, campaignId: number) {
  return db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      action: auditLog.action,
      actor: players.displayName,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .leftJoin(players, eq(players.id, auditLog.actorId))
    .where(eq(auditLog.campaignId, campaignId))
    .orderBy(desc(auditLog.at), desc(auditLog.id));
}

// ---------------------------------------------------------------------------
// Lists

export type StatusFilter = "all" | "in_progress" | "closed" | "stalled" | "void";

export interface CampaignListFilters {
  status?: StatusFilter;
  seasonId?: number | null;
  playerCount?: 3 | 4 | null;
  limit?: number;
}

export interface CampaignListRow {
  id: number;
  title: string;
  status: CampaignStatus;
  stalled: boolean;
  playerCount: number;
  season: string | null;
  actsRecorded: number;
  lastPlayedOn: string | null;
  lastActivityAt: Date;
  closedAt: Date | null;
  players: { name: string; isGuest: boolean; isWinner: boolean }[];
  winners: string[];
  topScore: number | null;
  /** Fate path of the (first) winner: Act I, II, III. */
  winnerPath: { fate: string; tier: Tier }[];
}

export async function listCampaigns(db: DbOrTx, f: CampaignListFilters = {}, now = new Date()): Promise<CampaignListRow[]> {
  const stallCutoff = new Date(now.getTime() - STALLED_AFTER_DAYS * 86_400_000);
  const conds = [];
  switch (f.status ?? "all") {
    case "in_progress":
      conds.push(eq(campaigns.status, "in_progress"), sql`${campaigns.lastActivityAt} >= ${stallCutoff}`);
      break;
    case "stalled":
      conds.push(eq(campaigns.status, "in_progress"), lt(campaigns.lastActivityAt, stallCutoff));
      break;
    case "closed":
      conds.push(eq(campaigns.status, "closed"));
      break;
    case "void":
      conds.push(eq(campaigns.status, "void"));
      break;
  }
  if (f.seasonId) conds.push(eq(campaigns.seasonId, f.seasonId));
  if (f.playerCount) conds.push(eq(campaigns.playerCount, f.playerCount));

  const rows = await db
    .select({ c: campaigns, season: seasons.name })
    .from(campaigns)
    .leftJoin(seasons, eq(seasons.id, campaigns.seasonId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(sql`coalesce(${campaigns.closedAt}, ${campaigns.lastActivityAt})`), desc(campaigns.id))
    .limit(f.limit ?? 200);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.c.id);

  const cps = await db
    .select({
      campaignId: campaignPlayers.campaignId,
      cpId: campaignPlayers.id,
      name: players.displayName,
      isGuest: players.isGuest,
      isWinner: campaignPlayers.isWinner,
    })
    .from(campaignPlayers)
    .innerJoin(players, eq(players.id, campaignPlayers.playerId))
    .where(inArray(campaignPlayers.campaignId, ids))
    .orderBy(asc(campaignPlayers.position));

  const actRows = await db
    .select({ id: acts.id, campaignId: acts.campaignId, actNo: acts.actNo, playedOn: acts.playedOn })
    .from(acts)
    .where(inArray(acts.campaignId, ids));

  const results = actRows.length
    ? await db
        .select({
          actId: actResults.actId,
          cpId: actResults.campaignPlayerId,
          score: actResults.score,
          fate: fates.name,
          tier: fates.tier,
        })
        .from(actResults)
        .innerJoin(fates, eq(fates.id, actResults.fateId))
        .where(inArray(actResults.actId, actRows.map((a) => a.id)))
    : [];

  return rows.map(({ c, season }) => {
    const mine = cps.filter((p) => p.campaignId === c.id);
    const myActs = actRows.filter((a) => a.campaignId === c.id).sort((a, b) => a.actNo - b.actNo);
    const act3 = myActs.find((a) => a.actNo === 3);
    const act3Scores = act3 ? results.filter((r) => r.actId === act3.id).map((r) => r.score) : [];
    const firstWinner = mine.find((p) => p.isWinner);
    const winnerPath = firstWinner
      ? myActs.flatMap((a) => results.filter((r) => r.actId === a.id && r.cpId === firstWinner.cpId)).map((r) => ({ fate: r.fate, tier: r.tier }))
      : [];
    return {
      id: c.id,
      title: c.title,
      status: c.status,
      stalled: isStalled(c.status, c.lastActivityAt, now),
      playerCount: c.playerCount,
      season,
      actsRecorded: myActs.length,
      lastPlayedOn: myActs.length ? myActs[myActs.length - 1].playedOn : null,
      lastActivityAt: c.lastActivityAt,
      closedAt: c.closedAt,
      players: mine.map((p) => ({ name: p.name, isGuest: p.isGuest, isWinner: p.isWinner })),
      winners: mine.filter((p) => p.isWinner).map((p) => p.name),
      topScore: act3Scores.length ? Math.max(...act3Scores) : null,
      winnerPath,
    };
  });
}

export interface HomeStats {
  closedCount: number;
  inProgressCount: number;
  memberCount: number;
  rankedCount: number;
  topAct3: { score: number; player: string; fate: string; campaignId: number } | null;
  champion: { name: string; wins: number; games: number } | null;
}

/** Headline numbers. Only closed campaigns count; guests never rank. */
export async function homeStats(db: DbOrTx, now = new Date()): Promise<HomeStats> {
  const stallCutoff = new Date(now.getTime() - STALLED_AFTER_DAYS * 86_400_000);
  const [counts] = await db
    .select({
      closed: sql<number>`count(*) filter (where ${campaigns.status} = 'closed')`.mapWith(Number),
      open: sql<number>`count(*) filter (where ${campaigns.status} = 'in_progress' and ${campaigns.lastActivityAt} >= ${stallCutoff})`.mapWith(Number),
    })
    .from(campaigns);

  const [members] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(players)
    .where(and(eq(players.isGuest, false)));

  const [top] = await db
    .select({ score: actResults.score, player: players.displayName, fate: fates.name, campaignId: campaigns.id })
    .from(actResults)
    .innerJoin(acts, eq(acts.id, actResults.actId))
    .innerJoin(campaigns, eq(campaigns.id, acts.campaignId))
    .innerJoin(campaignPlayers, eq(campaignPlayers.id, actResults.campaignPlayerId))
    .innerJoin(players, eq(players.id, campaignPlayers.playerId))
    .innerJoin(fates, eq(fates.id, actResults.fateId))
    .where(and(eq(acts.actNo, 3), eq(campaigns.status, "closed")))
    .orderBy(desc(actResults.score), asc(acts.playedOn))
    .limit(1);

  const standings = await db
    .select({
      name: players.displayName,
      games: sql<number>`count(*)`.mapWith(Number),
      wins: sql<number>`count(*) filter (where ${campaignPlayers.isWinner})`.mapWith(Number),
    })
    .from(campaignPlayers)
    .innerJoin(campaigns, eq(campaigns.id, campaignPlayers.campaignId))
    .innerJoin(players, eq(players.id, campaignPlayers.playerId))
    .where(and(eq(campaigns.status, "closed"), eq(players.isGuest, false)))
    .groupBy(players.id, players.displayName);

  const champ = pickChampion(standings);

  return {
    closedCount: counts?.closed ?? 0,
    inProgressCount: counts?.open ?? 0,
    memberCount: members?.n ?? 0,
    rankedCount: standings.length,
    topAct3: top ?? null,
    champion: champ,
  };
}
