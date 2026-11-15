/**
 * Database schema (spec sections 3-5).
 *
 * Kept deliberately raw so stats (and a rating system, if ever wanted) can be
 * recomputed from it: every act result keeps fate, score, success and seat, and
 * every act keeps its date.
 *
 * Later phases add tables that hang off these without changing them:
 *   - photos      (act_id, campaign_player_id null = board photo, blob keys)   phase 4 (below)
 *   - cards       (Buried Giant card id, name, text, tags, meta, blob keys)    phase 5 (below)
 *   - card_tags   (act_id, campaign_player_id, card_id, tagged_by)              phase 5 (below)
 * `fates.card_id` already holds the ARCS-FATExx id to join fates to cards.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** Discord members and guests. */
export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    /** Discord user id; null for guests. */
    discordId: text("discord_id").unique(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    isGuest: boolean("is_guest").notNull().default(false),
    /**
     * When a moderator links a guest to a real account, the guest's campaign
     * entries are moved to that account and this points at it.
     */
    linkedPlayerId: integer("linked_player_id").references((): AnyPgColumn => players.id),
    /** Cached from the moderator role at last sign-in. */
    isModerator: boolean("is_moderator").notNull().default(false),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    createdById: integer("created_by_id").references((): AnyPgColumn => players.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("players_guest_has_no_discord", sql`not (${t.isGuest} and ${t.discordId} is not null)`),
  ],
);

export const seasons = pgTable("seasons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  createdAt: createdAt(),
});

/** The 24 fates. Seed data, editable by moderators. */
export const fates = pgTable(
  "fates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    tier: text("tier", { enum: ["A", "B", "C"] }).notNull(),
    /** The act the fate card belongs to; equals the tier (A=1, B=2, C=3). */
    act: smallint("act").notNull(),
    /** Buried Giant card id (ARCS-FATE01..24), for joining to imported cards. */
    cardId: text("card_id").unique(),
    /** 1-3, from the card data (phase 5). */
    complexity: smallint("complexity"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("fates_tier", sql`${t.tier} in ('A', 'B', 'C')`),
    check(
      "fates_act_matches_tier",
      sql`(${t.tier} = 'A' and ${t.act} = 1) or (${t.tier} = 'B' and ${t.act} = 2) or (${t.tier} = 'C' and ${t.act} = 3)`,
    ),
    check("fates_complexity", sql`${t.complexity} is null or ${t.complexity} between 1 and 3`),
  ],
);

export const CAMPAIGN_STATUSES = ["in_progress", "closed", "void"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const campaigns = pgTable(
  "campaigns",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    seasonId: integer("season_id").references(() => seasons.id, { onDelete: "set null" }),
    /**
     * in_progress until Act III is saved with a winner, then closed. "Stalled"
     * is not stored: it is in_progress with last_activity_at over 60 days ago.
     * A moderator reopens a stalled campaign by touching last_activity_at.
     */
    status: text("status", { enum: CAMPAIGN_STATUSES }).notNull().default("in_progress"),
    playerCount: smallint("player_count").notNull(),
    /** True when the stored winner(s) differ from the highest Act III score. */
    winnerOverridden: boolean("winner_overridden").notNull().default(false),
    winnerOverrideReason: text("winner_override_reason"),
    /** Discord thread the bot created for this campaign (phase 3). */
    discordThreadId: text("discord_thread_id"),
    /** Photos are members-only unless this is set (phase 4). */
    photosPublic: boolean("photos_public").notNull().default(false),
    voidReason: text("void_reason"),
    /**
     * Where the campaign was played when it came in by import ("meeples", "tts",
     * "screenshot"); null when entered by hand. `sourceCampaignKey` is the
     * platform's id for the campaign (its Act I game id), so later acts attach.
     */
    sourcePlatform: text("source_platform"),
    sourceCampaignKey: text("source_campaign_key"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdById: integer("created_by_id").references(() => players.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("campaigns_status", sql`${t.status} in ('in_progress', 'closed', 'void')`),
    check("campaigns_player_count", sql`${t.playerCount} between 3 and 4`),
    check(
      "campaigns_override_reason",
      sql`not ${t.winnerOverridden} or ${t.winnerOverrideReason} is not null`,
    ),
    index("campaigns_status_idx").on(t.status),
    index("campaigns_last_activity_idx").on(t.lastActivityAt),
    uniqueIndex("campaigns_source_unique")
      .on(t.sourcePlatform, t.sourceCampaignKey)
      .where(sql`${t.sourceCampaignKey} is not null`),
  ],
);

/** A player's seat at a campaign's table, and the explicit winner flag. */
export const campaignPlayers = pgTable(
  "campaign_players",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    playerId: integer("player_id").notNull().references(() => players.id),
    /** Display order on the campaign page. */
    position: smallint("position").notNull(),
    isWinner: boolean("is_winner").notNull().default(false),
  },
  (t) => [
    uniqueIndex("campaign_players_unique").on(t.campaignId, t.playerId),
    index("campaign_players_player_idx").on(t.playerId),
  ],
);

export const acts = pgTable(
  "acts",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    actNo: smallint("act_no").notNull(),
    playedOn: date("played_on").notNull(),
    vodUrl: text("vod_url"),
    notes: text("notes"),
    createdById: integer("created_by_id").references(() => players.id),
    /** When the act was first saved; players may edit for 24 hours after this. */
    createdAt: createdAt(),
    updatedById: integer("updated_by_id").references(() => players.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("acts_campaign_act_unique").on(t.campaignId, t.actNo),
    check("acts_act_no", sql`${t.actNo} between 1 and 3`),
  ],
);

/** One row per player per act. */
export const actResults = pgTable(
  "act_results",
  {
    id: serial("id").primaryKey(),
    actId: integer("act_id").notNull().references(() => acts.id, { onDelete: "cascade" }),
    campaignPlayerId: integer("campaign_player_id")
      .notNull()
      .references(() => campaignPlayers.id, { onDelete: "cascade" }),
    fateId: integer("fate_id").notNull().references(() => fates.id),
    score: integer("score").notNull(),
    /** Acts I and II only; null in Act III (succeeding in Act III means winning). */
    success: boolean("success"),
    /** Optional seat / initiative order, 1-based. */
    seat: smallint("seat"),
  },
  (t) => [
    uniqueIndex("act_results_unique").on(t.actId, t.campaignPlayerId),
    index("act_results_fate_idx").on(t.fateId),
    check("act_results_seat", sql`${t.seat} is null or ${t.seat} between 1 and 4`),
  ],
);

/**
 * Act photos (phase 4): one board photo per act (campaign_player_id null) and
 * one tableau photo per player per act. Each has a full-size and a thumbnail
 * copy in storage, both JPEG, downscaled in the browser before upload.
 * Replacing a photo inserts a new row, so photo URLs can be cached forever.
 */
export const photos = pgTable(
  "photos",
  {
    id: serial("id").primaryKey(),
    actId: integer("act_id").notNull().references(() => acts.id, { onDelete: "cascade" }),
    /** Whose tableau this is; null for the board photo. */
    campaignPlayerId: integer("campaign_player_id").references(() => campaignPlayers.id, { onDelete: "cascade" }),
    fullKey: text("full_key").notNull(),
    thumbKey: text("thumb_key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    uploadedById: integer("uploaded_by_id").references(() => players.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("photos_tableau_unique").on(t.actId, t.campaignPlayerId),
    uniqueIndex("photos_board_unique").on(t.actId).where(sql`${t.campaignPlayerId} is null`),
  ],
);

/**
 * ARCS cards copied from Buried Giant Studios' card database (phase 5), with
 * permission. Imported by a moderator, never synced automatically. Setup cards
 * and player aids are not imported. Images are copied into our storage after
 * the import; the text is kept for search.
 */
export const cards = pgTable(
  "cards",
  {
    /** Buried Giant id, e.g. ARCS-F103. */
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Rules text in Buried Giant's markup (**bold**, *italic*, `symbol:x`). */
    text: text("text"),
    /** The card's kind: the second Buried Giant tag (Guild, Vox, Lore, Base Court, Fate...). */
    type: text("type").notNull(),
    /** arcsbasegame, blightedreach or leaders-lore. */
    product: text("product").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull(),
    /** The fate this card belongs to, from its tags. */
    fateId: integer("fate_id").references(() => fates.id),
    act: smallint("act"),
    keys: smallint("keys"),
    flipSideId: text("flip_side_id"),
    /** The upstream record as imported, to detect changes on the next import. */
    source: jsonb("source").notNull(),
    /** Set when a later import no longer has the card; kept so tags survive. */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    /** Our copies of the card image in storage (full as published, and a small thumbnail). Never hotlinked. */
    imageKey: text("image_key"),
    thumbKey: text("thumb_key"),
    /** True until the current image has been copied: new or changed cards on import. */
    imageStale: boolean("image_stale").notNull().default(true),
    imageCopiedAt: timestamp("image_copied_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [index("cards_fate_idx").on(t.fateId), index("cards_type_idx").on(t.type)],
);

/**
 * A card in a player's tableau at the end of an act (phase 5). Belongs to the
 * tableau (act + player), not to a photo: a photo helps but is not required,
 * and replacing or removing the photo keeps the cards.
 */
export const cardTags = pgTable(
  "card_tags",
  {
    id: serial("id").primaryKey(),
    actId: integer("act_id").notNull().references(() => acts.id, { onDelete: "cascade" }),
    campaignPlayerId: integer("campaign_player_id")
      .notNull()
      .references(() => campaignPlayers.id, { onDelete: "cascade" }),
    cardId: text("card_id").notNull().references(() => cards.id),
    taggedById: integer("tagged_by_id").references(() => players.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("card_tags_unique").on(t.actId, t.campaignPlayerId, t.cardId),
    index("card_tags_card_idx").on(t.cardId),
  ],
);

/**
 * A name a player uses on another platform (e.g. their meeples name), learned
 * when someone confirms an import, so later imports match them automatically.
 */
export const playerAliases = pgTable(
  "player_aliases",
  {
    id: serial("id").primaryKey(),
    platform: text("platform").notNull(),
    /** Stored lower-cased and trimmed. */
    name: text("name").notNull(),
    playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    createdById: integer("created_by_id").references(() => players.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("player_aliases_unique").on(t.platform, t.name)],
);

export const IMPORT_STATUSES = ["pending", "saved", "discarded"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/**
 * Act summaries received from other platforms (docs/ACT_SUMMARY_FORMAT.md).
 * One row per platform game and act, so a resend replaces the row instead of
 * duplicating it. `payload` keeps the summary exactly as received, including
 * fields the site does not use yet (favors, extras).
 */
export const actImports = pgTable(
  "act_imports",
  {
    id: serial("id").primaryKey(),
    platform: text("platform").notNull(),
    gameId: text("game_id").notNull(),
    actNo: smallint("act_no").notNull(),
    /** The platform's id for the whole campaign: campaignGameId, else gameId. */
    campaignKey: text("campaign_key").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: IMPORT_STATUSES }).notNull().default("pending"),
    /** Why it was held for a person to confirm, as shown on the confirm page. */
    problems: jsonb("problems").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    campaignId: integer("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    actId: integer("act_id").references(() => acts.id, { onDelete: "set null" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedById: integer("resolved_by_id").references(() => players.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("act_imports_unique").on(t.platform, t.gameId, t.actNo),
    index("act_imports_status_idx").on(t.status),
    index("act_imports_campaign_idx").on(t.campaignId),
    check("act_imports_status", sql`${t.status} in ('pending', 'saved', 'discarded')`),
    check("act_imports_act_no", sql`${t.actNo} between 1 and 3`),
  ],
);

/** Every change: who, when, before and after. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorId: integer("actor_id").references(() => players.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** Set for anything inside a campaign, to show a campaign's history. */
    campaignId: integer("campaign_id"),
    before: jsonb("before"),
    after: jsonb("after"),
  },
  (t) => [
    index("audit_log_at_idx").on(t.at),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_campaign_idx").on(t.campaignId),
  ],
);

export type Player = typeof players.$inferSelect;
export type Fate = typeof fates.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Act = typeof acts.$inferSelect;
export type ActResult = typeof actResults.$inferSelect;
export type Season = typeof seasons.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type Card = typeof cards.$inferSelect;
