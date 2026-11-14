/**
 * Cards (phase 5): the moderator-run import from Buried Giant Studios' card
 * database, the card reference, and card tags on tableau photos.
 *
 * Copy, credit, never hotlink, never auto-sync: cards are fetched only when a
 * moderator asks, stored in Postgres, and every card page links back to
 * Buried Giant. Text only for now; images come later (spec section 11).
 */
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { acts, actResults, auditLog, campaignPlayers, campaigns, cards, cardTags, fates, photos, players } from "@/db/schema";
import {
  BURIED_GIANT_CARDS_URL,
  BURIED_GIANT_VERSION_URL,
  parseUpstream,
  planCardImport,
  type CardImportPlan,
  type PickerCard,
  type UpstreamCard,
} from "@/lib/cards";
import { canRemoveCardTag, canTagCards, type Actor } from "@/lib/permissions";
import type { ActNumber, Tier } from "@/lib/rules";
import { audit, getCampaign, NotFoundError, PermissionError, requireModerator, RuleError } from "./campaigns";

// ---------------------------------------------------------------------------
// Import

export interface Upstream {
  cards: UpstreamCard[];
  skipped: number;
  /** Hash of cards.json from version.json; null if version.json could not be read. */
  version: string | null;
}

/** Fetches Buried Giant's built card data. Only ever called on a moderator's request. */
export async function fetchUpstreamCards(fetcher: typeof fetch = fetch): Promise<Upstream> {
  const get = (url: string) => fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const [cardsRes, versionRes] = await Promise.all([get(BURIED_GIANT_CARDS_URL), get(BURIED_GIANT_VERSION_URL).catch(() => null)]);
  if (!cardsRes.ok) throw new RuleError([`Buried Giant's card data could not be fetched (HTTP ${cardsRes.status}).`]);
  const { cards: list, skipped } = parseUpstream(await cardsRes.json());
  if (list.length === 0) throw new RuleError(["Buried Giant's card data had no ARCS cards; nothing was imported."]);
  let version: string | null = null;
  if (versionRes?.ok) {
    const v = (await versionRes.json().catch(() => null)) as { files?: Record<string, string> } | null;
    version = v?.files?.["cards.json"] ?? null;
  }
  return { cards: list, skipped, version };
}

async function fateIdsByName(db: DbOrTx) {
  return new Map((await db.select({ id: fates.id, name: fates.name }).from(fates)).map((f) => [f.name, f.id]));
}

export async function previewCardImport(db: DbOrTx, upstream: Upstream): Promise<CardImportPlan> {
  const existing = await db.select({ id: cards.id, name: cards.name, source: cards.source, removedAt: cards.removedAt }).from(cards);
  return planCardImport(existing, upstream.cards, await fateIdsByName(db));
}

/** Applies an import: upserts every card, marks missing ones removed, fills fate complexity, audits. */
export async function importCards(db: DB, actor: Actor, upstream: Upstream): Promise<CardImportPlan> {
  requireModerator(actor);
  return db.transaction(async (tx) => {
    const plan = await previewCardImport(tx, upstream);
    const now = new Date();
    for (let i = 0; i < plan.rows.length; i += 200) {
      const chunk = plan.rows.slice(i, i + 200);
      await tx
        .insert(cards)
        .values(chunk.map((r) => ({ ...r, importedAt: now, updatedAt: now })))
        .onConflictDoUpdate({
          target: cards.id,
          set: {
            name: sql`excluded.name`,
            text: sql`excluded.text`,
            type: sql`excluded.type`,
            product: sql`excluded.product`,
            tags: sql`excluded.tags`,
            fateId: sql`excluded.fate_id`,
            act: sql`excluded.act`,
            keys: sql`excluded.keys`,
            flipSideId: sql`excluded.flip_side_id`,
            source: sql`excluded.source`,
            removedAt: sql`null`,
            updatedAt: sql`case when ${cards.source} is distinct from excluded.source or ${cards.removedAt} is not null then excluded.updated_at else ${cards.updatedAt} end`,
          },
        });
    }
    if (plan.removed.length) {
      await tx.update(cards).set({ removedAt: now }).where(inArray(cards.id, plan.removed.map((r) => r.id)));
    }
    // Fate complexity comes from the fate cards (ARCS-FATE01..24).
    for (const c of upstream.cards) {
      const complexity = c.meta?.complexity;
      if (c.tags[1] === "Fate" && typeof complexity === "number" && complexity >= 1 && complexity <= 3) {
        await tx.update(fates).set({ complexity, updatedAt: now }).where(eq(fates.cardId, c.id));
      }
    }
    const list = (xs: { id: string }[]) => xs.slice(0, 100).map((x) => x.id);
    await audit(tx, actor, {
      action: "cards.import",
      entityType: "cards",
      entityId: "buried-giant",
      after: {
        version: upstream.version,
        total: plan.rows.length,
        added: plan.added.length,
        changed: list(plan.changed),
        removed: list(plan.removed),
        restored: list(plan.restored),
        skipped: upstream.skipped,
      },
    });
    return plan;
  });
}

export interface ImportRecord {
  at: Date;
  by: string | null;
  version: string | null;
  total: number;
}

export async function lastCardImport(db: DbOrTx): Promise<ImportRecord | null> {
  const [row] = await db
    .select({ at: auditLog.at, after: auditLog.after, by: players.displayName })
    .from(auditLog)
    .leftJoin(players, eq(players.id, auditLog.actorId))
    .where(eq(auditLog.action, "cards.import"))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(1);
  if (!row) return null;
  const after = (row.after ?? {}) as { version?: string | null; total?: number };
  return { at: row.at, by: row.by, version: after.version ?? null, total: after.total ?? 0 };
}

// ---------------------------------------------------------------------------
// Reference

export interface CardStats {
  /** Tableau photos tagged with the card, in campaigns that are not void. */
  tagged: number;
  /** Players in closed campaigns with the card tagged in any act. */
  holders: number;
  wins: number;
}

const NO_STATS: CardStats = { tagged: 0, holders: 0, wins: 0 };

async function statsByCard(db: DbOrTx, cardIds?: string[]): Promise<Map<string, CardStats>> {
  if (cardIds && !cardIds.length) return new Map();
  const rows = await db
    .select({
      cardId: cardTags.cardId,
      tagged: sql<number>`count(distinct ${cardTags.photoId})`.mapWith(Number),
      holders: sql<number>`count(distinct ${campaignPlayers.id}) filter (where ${campaigns.status} = 'closed')`.mapWith(Number),
      wins: sql<number>`count(distinct ${campaignPlayers.id}) filter (where ${campaigns.status} = 'closed' and ${campaignPlayers.isWinner})`.mapWith(Number),
    })
    .from(cardTags)
    .innerJoin(photos, eq(photos.id, cardTags.photoId))
    .innerJoin(campaignPlayers, eq(campaignPlayers.id, photos.campaignPlayerId))
    .innerJoin(acts, eq(acts.id, photos.actId))
    .innerJoin(campaigns, eq(campaigns.id, acts.campaignId))
    .where(and(sql`${campaigns.status} <> 'void'`, cardIds ? inArray(cardTags.cardId, cardIds) : undefined))
    .groupBy(cardTags.cardId);
  return new Map(rows.map((r) => [r.cardId, { tagged: r.tagged, holders: r.holders, wins: r.wins }]));
}

export interface CardListFilters {
  q?: string;
  type?: string;
  fateId?: number;
  product?: string;
}

export interface CardListRow {
  id: string;
  name: string;
  type: string;
  product: string;
  act: number | null;
  keys: number | null;
  fate: { name: string; tier: Tier } | null;
  stats: CardStats;
}

export async function listCards(db: DbOrTx, f: CardListFilters = {}): Promise<CardListRow[]> {
  const conds = [isNull(cards.removedAt)];
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(cards.name, like), ilike(cards.text, like), ilike(cards.id, like))!);
  }
  if (f.type) conds.push(eq(cards.type, f.type));
  if (f.fateId) conds.push(eq(cards.fateId, f.fateId));
  if (f.product) conds.push(eq(cards.product, f.product));
  const rows = await db
    .select({
      id: cards.id,
      name: cards.name,
      type: cards.type,
      product: cards.product,
      act: cards.act,
      keys: cards.keys,
      fateName: fates.name,
      fateTier: fates.tier,
    })
    .from(cards)
    .leftJoin(fates, eq(fates.id, cards.fateId))
    .where(and(...conds))
    .orderBy(asc(cards.type), asc(cards.name), asc(cards.id));
  const stats = await statsByCard(db);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    product: r.product,
    act: r.act,
    keys: r.keys,
    fate: r.fateName && r.fateTier ? { name: r.fateName, tier: r.fateTier } : null,
    stats: stats.get(r.id) ?? NO_STATS,
  }));
}

/** Card types and how many cards each has, for the type filter. */
export async function cardTypes(db: DbOrTx) {
  return db
    .select({ type: cards.type, n: sql<number>`count(*)`.mapWith(Number) })
    .from(cards)
    .where(isNull(cards.removedAt))
    .groupBy(cards.type)
    .orderBy(asc(cards.type));
}

export async function cardCount(db: DbOrTx): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(cards).where(isNull(cards.removedAt));
  return r?.n ?? 0;
}

export interface CardSighting {
  photoId: number;
  campaignId: number;
  campaignTitle: string;
  actNo: ActNumber;
  player: string;
  isWinner: boolean;
  status: string;
}

export async function getCard(db: DbOrTx, id: string) {
  const [row] = await db
    .select({ card: cards, fateName: fates.name, fateTier: fates.tier })
    .from(cards)
    .leftJoin(fates, eq(fates.id, cards.fateId))
    .where(eq(cards.id, id));
  if (!row) return null;
  const flip = row.card.flipSideId
    ? ((await db.select({ id: cards.id, name: cards.name }).from(cards).where(eq(cards.id, row.card.flipSideId)))[0] ?? null)
    : null;
  const sightings = await db
    .select({
      photoId: photos.id,
      campaignId: campaigns.id,
      campaignTitle: campaigns.title,
      actNo: acts.actNo,
      player: players.displayName,
      isWinner: campaignPlayers.isWinner,
      status: campaigns.status,
    })
    .from(cardTags)
    .innerJoin(photos, eq(photos.id, cardTags.photoId))
    .innerJoin(acts, eq(acts.id, photos.actId))
    .innerJoin(campaigns, eq(campaigns.id, acts.campaignId))
    .innerJoin(campaignPlayers, eq(campaignPlayers.id, photos.campaignPlayerId))
    .innerJoin(players, eq(players.id, campaignPlayers.playerId))
    .where(and(eq(cardTags.cardId, id), sql`${campaigns.status} <> 'void'`))
    .orderBy(desc(campaigns.id), asc(acts.actNo));
  return {
    ...row.card,
    fate: row.fateName && row.fateTier ? { name: row.fateName, tier: row.fateTier } : null,
    flip,
    stats: (await statsByCard(db, [id])).get(id) ?? NO_STATS,
    sightings: sightings.map((s) => ({ ...s, actNo: s.actNo as ActNumber })) as CardSighting[],
  };
}

/** A fate's own cards (its fate card included), for the fate page. */
export async function fateCards(db: DbOrTx, fateId: number) {
  return db
    .select({ id: cards.id, name: cards.name, type: cards.type, act: cards.act, text: cards.text, keys: cards.keys })
    .from(cards)
    .where(and(eq(cards.fateId, fateId), isNull(cards.removedAt)))
    .orderBy(asc(cards.act), asc(cards.id));
}

// ---------------------------------------------------------------------------
// Tags

export interface PhotoTag {
  tagId: number;
  cardId: string;
  name: string;
  type: string;
  taggedById: number | null;
  taggedBy: string | null;
}

export async function tagsForPhotos(db: DbOrTx, photoIds: number[]): Promise<Map<number, PhotoTag[]>> {
  const m = new Map<number, PhotoTag[]>();
  if (!photoIds.length) return m;
  const rows = await db
    .select({
      photoId: cardTags.photoId,
      tagId: cardTags.id,
      cardId: cardTags.cardId,
      name: cards.name,
      type: cards.type,
      taggedById: cardTags.taggedById,
      taggedBy: players.displayName,
    })
    .from(cardTags)
    .innerJoin(cards, eq(cards.id, cardTags.cardId))
    .leftJoin(players, eq(players.id, cardTags.taggedById))
    .where(inArray(cardTags.photoId, photoIds))
    .orderBy(asc(cards.name));
  for (const { photoId, ...t } of rows) m.set(photoId, [...(m.get(photoId) ?? []), t]);
  return m;
}

/** Every current card, slimmed for the picker. */
export async function pickerCards(db: DbOrTx): Promise<PickerCard[]> {
  return db
    .select({ id: cards.id, name: cards.name, type: cards.type, fateId: cards.fateId, fate: fates.name, act: cards.act })
    .from(cards)
    .leftJoin(fates, eq(fates.id, cards.fateId))
    .where(isNull(cards.removedAt));
}

/** A photo with what the tagging page needs: its campaign, act, whose tableau, and that player's fate in that act. */
export async function photoForTagging(db: DbOrTx, photoId: number) {
  const [row] = await db
    .select({
      id: photos.id,
      actId: photos.actId,
      campaignPlayerId: photos.campaignPlayerId,
      width: photos.width,
      height: photos.height,
      campaignId: acts.campaignId,
      actNo: acts.actNo,
    })
    .from(photos)
    .innerJoin(acts, eq(acts.id, photos.actId))
    .where(eq(photos.id, photoId));
  if (!row) return null;
  const c = await getCampaign(db, row.campaignId);
  if (!c) return null;
  const player = row.campaignPlayerId ? (c.players.find((p) => p.cpId === row.campaignPlayerId) ?? null) : null;
  let fate: { id: number; name: string; tier: Tier } | null = null;
  if (row.campaignPlayerId) {
    const [r] = await db
      .select({ id: fates.id, name: fates.name, tier: fates.tier })
      .from(actResults)
      .innerJoin(fates, eq(fates.id, actResults.fateId))
      .where(and(eq(actResults.actId, row.actId), eq(actResults.campaignPlayerId, row.campaignPlayerId)));
    fate = r ?? null;
  }
  return { ...row, actNo: row.actNo as ActNumber, campaign: c, player, fate };
}

export async function addCardTag(db: DB, actor: Actor | null, photoId: number, cardId: string): Promise<void> {
  if (!canTagCards(actor) || !actor) throw new PermissionError("Sign in with Discord to tag cards.");
  const p = await photoForTagging(db, photoId);
  if (!p) throw new NotFoundError("Photo not found.");
  if (!p.campaignPlayerId) throw new RuleError(["Cards are tagged on tableau photos, not the board photo."]);
  const [card] = await db.select({ id: cards.id, name: cards.name, removedAt: cards.removedAt }).from(cards).where(eq(cards.id, cardId));
  if (!card || card.removedAt) throw new NotFoundError("Card not found.");
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(cardTags)
      .values({ photoId, cardId, taggedById: actor.playerId })
      .onConflictDoNothing()
      .returning({ id: cardTags.id });
    if (!inserted.length) return; // already tagged
    await audit(tx, actor, {
      action: "card_tag.add",
      entityType: "card_tag",
      entityId: inserted[0].id,
      campaignId: p.campaign.id,
      after: { photoId, act: p.actNo, of: p.player?.name ?? null, card: cardId, name: card.name },
    });
  });
}

export async function removeCardTag(db: DB, actor: Actor | null, tagId: number): Promise<{ campaignId: number; photoId: number }> {
  const [t] = await db
    .select({ tag: cardTags, campaignId: acts.campaignId, cardName: cards.name })
    .from(cardTags)
    .innerJoin(photos, eq(photos.id, cardTags.photoId))
    .innerJoin(acts, eq(acts.id, photos.actId))
    .innerJoin(cards, eq(cards.id, cardTags.cardId))
    .where(eq(cardTags.id, tagId));
  if (!t) throw new NotFoundError("Tag not found.");
  const c = await getCampaign(db, t.campaignId);
  if (!c) throw new NotFoundError("Campaign not found.");
  if (!canRemoveCardTag(actor, t.tag.taggedById, c.access) || !actor) {
    throw new PermissionError("Only whoever added a tag, the campaign's players or a moderator can remove it.");
  }
  await db.transaction(async (tx) => {
    await tx.delete(cardTags).where(eq(cardTags.id, tagId));
    await audit(tx, actor, {
      action: "card_tag.delete",
      entityType: "card_tag",
      entityId: tagId,
      campaignId: c.id,
      before: { photoId: t.tag.photoId, card: t.tag.cardId, name: t.cardName },
    });
  });
  return { campaignId: c.id, photoId: t.tag.photoId };
}
