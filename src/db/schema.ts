/**
 * Database schema (spec sections 3-5).
 *
 * Kept deliberately raw so stats (and a rating system, if ever wanted) can be
 * recomputed from it: every act result keeps fate, score, success and seat, and
 * every act keeps its date.
 *
 * Later phases add tables that hang off these without changing them:
 *   - photos      (act_id, campaign_player_id null = board photo, blob keys)   phase 4
 *   - cards       (Buried Giant card id, name, text, tags, meta, blob keys)    phase 5
 *   - card_tags   (photo_id, card_id, tagged_by)                                phase 5
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
