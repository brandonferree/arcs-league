/**
 * Seasons (spec section 5: moderators manage seasons). A season is a name and
 * optional dates; campaigns carry an optional season tag used by the stats
 * filters. Every change is moderator-only and audit-logged.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import { acts, campaigns, seasons } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { audit, dateString, NotFoundError, requireModerator, RuleError } from "./campaigns";

const optionalDate = z.union([z.literal(""), dateString]).optional().default("");

export const seasonInput = z
  .object({
    name: z.string().trim().min(1, "Give the season a name").max(60, "Keep the name under 60 characters"),
    startsOn: optionalDate,
    endsOn: optionalDate,
  })
  .refine((s) => !s.startsOn || !s.endsOn || s.endsOn >= s.startsOn, {
    message: "The season must end on or after its start date",
    path: ["endsOn"],
  });
export type SeasonInput = z.input<typeof seasonInput>;

function parseSeason(raw: unknown) {
  const r = seasonInput.safeParse(raw);
  if (!r.success) throw new RuleError(r.error.issues.map((i) => i.message));
  return { name: r.data.name, startsOn: r.data.startsOn || null, endsOn: r.data.endsOn || null };
}

async function assertNameFree(db: DbOrTx, name: string, exceptId?: number) {
  const clash = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(sql`lower(${seasons.name}) = lower(${name})`);
  if (clash.some((c) => c.id !== exceptId)) throw new RuleError([`There is already a season called "${name}".`]);
}

export interface SeasonRow {
  id: number;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  campaignCount: number;
}

export async function listSeasonsWithCounts(db: DbOrTx): Promise<SeasonRow[]> {
  return db
    .select({
      id: seasons.id,
      name: seasons.name,
      startsOn: seasons.startsOn,
      endsOn: seasons.endsOn,
      campaignCount: sql<number>`count(${campaigns.id})`.mapWith(Number),
    })
    .from(seasons)
    .leftJoin(campaigns, eq(campaigns.seasonId, seasons.id))
    .groupBy(seasons.id)
    .orderBy(desc(seasons.startsOn), asc(seasons.name));
}

export async function createSeason(db: DB, actor: Actor, raw: unknown): Promise<number> {
  requireModerator(actor);
  const s = parseSeason(raw);
  return db.transaction(async (tx) => {
    await assertNameFree(tx, s.name);
    const [row] = await tx.insert(seasons).values(s).returning({ id: seasons.id });
    await audit(tx, actor, { action: "season.create", entityType: "season", entityId: row.id, after: s });
    return row.id;
  });
}

export async function updateSeason(db: DB, actor: Actor, id: number, raw: unknown): Promise<void> {
  requireModerator(actor);
  const s = parseSeason(raw);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(seasons).where(eq(seasons.id, id));
    if (!before) throw new NotFoundError("Season not found.");
    await assertNameFree(tx, s.name, id);
    await tx.update(seasons).set(s).where(eq(seasons.id, id));
    await audit(tx, actor, {
      action: "season.update",
      entityType: "season",
      entityId: id,
      before: { name: before.name, startsOn: before.startsOn, endsOn: before.endsOn },
      after: s,
    });
  });
}

/** Deletes a season. Its campaigns keep their results and simply lose the tag. */
export async function deleteSeason(db: DB, actor: Actor, id: number): Promise<void> {
  requireModerator(actor);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(seasons).where(eq(seasons.id, id));
    if (!before) throw new NotFoundError("Season not found.");
    const tagged = await tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.seasonId, id));
    await tx.update(campaigns).set({ seasonId: null }).where(eq(campaigns.seasonId, id));
    await tx.delete(seasons).where(eq(seasons.id, id));
    await audit(tx, actor, {
      action: "season.delete",
      entityType: "season",
      entityId: id,
      before: { name: before.name, startsOn: before.startsOn, endsOn: before.endsOn, campaignIds: tagged.map((t) => t.id) },
    });
  });
}

/**
 * Tags every campaign that has no season yet and whose Act I falls within the
 * season's dates. Campaigns already tagged with any season are left alone.
 * Returns how many were tagged.
 */
export async function tagCampaignsBySeasonDates(db: DB, actor: Actor, id: number): Promise<number> {
  requireModerator(actor);
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(seasons).where(eq(seasons.id, id));
    if (!s) throw new NotFoundError("Season not found.");
    if (!s.startsOn || !s.endsOn) throw new RuleError(["Give the season a start and end date first."]);
    const matches = await tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .innerJoin(acts, and(eq(acts.campaignId, campaigns.id), eq(acts.actNo, 1)))
      .where(and(isNull(campaigns.seasonId), sql`${acts.playedOn} between ${s.startsOn} and ${s.endsOn}`));
    if (!matches.length) return 0;
    for (const m of matches) {
      await tx.update(campaigns).set({ seasonId: id, updatedAt: new Date() }).where(eq(campaigns.id, m.id));
      await audit(tx, actor, {
        action: "campaign.season",
        entityType: "campaign",
        entityId: m.id,
        campaignId: m.id,
        before: { seasonId: null },
        after: { seasonId: id, season: s.name },
      });
    }
    return matches.length;
  });
}
