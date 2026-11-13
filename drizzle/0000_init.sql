CREATE TABLE "act_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"act_id" integer NOT NULL,
	"campaign_player_id" integer NOT NULL,
	"fate_id" integer NOT NULL,
	"score" integer NOT NULL,
	"success" boolean,
	"seat" smallint,
	CONSTRAINT "act_results_seat" CHECK ("act_results"."seat" is null or "act_results"."seat" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "acts" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"act_no" smallint NOT NULL,
	"played_on" date NOT NULL,
	"vod_url" text,
	"notes" text,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acts_act_no" CHECK ("acts"."act_no" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"campaign_id" integer,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "campaign_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"position" smallint NOT NULL,
	"is_winner" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"season_id" integer,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"player_count" smallint NOT NULL,
	"winner_overridden" boolean DEFAULT false NOT NULL,
	"winner_override_reason" text,
	"discord_thread_id" text,
	"photos_public" boolean DEFAULT false NOT NULL,
	"void_reason" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_status" CHECK ("campaigns"."status" in ('in_progress', 'closed', 'void')),
	CONSTRAINT "campaigns_player_count" CHECK ("campaigns"."player_count" between 3 and 4),
	CONSTRAINT "campaigns_override_reason" CHECK (not "campaigns"."winner_overridden" or "campaigns"."winner_override_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "fates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tier" text NOT NULL,
	"act" smallint NOT NULL,
	"card_id" text,
	"complexity" smallint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fates_name_unique" UNIQUE("name"),
	CONSTRAINT "fates_card_id_unique" UNIQUE("card_id"),
	CONSTRAINT "fates_tier" CHECK ("fates"."tier" in ('A', 'B', 'C')),
	CONSTRAINT "fates_act_matches_tier" CHECK (("fates"."tier" = 'A' and "fates"."act" = 1) or ("fates"."tier" = 'B' and "fates"."act" = 2) or ("fates"."tier" = 'C' and "fates"."act" = 3)),
	CONSTRAINT "fates_complexity" CHECK ("fates"."complexity" is null or "fates"."complexity" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"discord_id" text,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"is_guest" boolean DEFAULT false NOT NULL,
	"linked_player_id" integer,
	"is_moderator" boolean DEFAULT false NOT NULL,
	"last_sign_in_at" timestamp with time zone,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_discord_id_unique" UNIQUE("discord_id"),
	CONSTRAINT "players_guest_has_no_discord" CHECK (not ("players"."is_guest" and "players"."discord_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "act_results" ADD CONSTRAINT "act_results_act_id_acts_id_fk" FOREIGN KEY ("act_id") REFERENCES "public"."acts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "act_results" ADD CONSTRAINT "act_results_campaign_player_id_campaign_players_id_fk" FOREIGN KEY ("campaign_player_id") REFERENCES "public"."campaign_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "act_results" ADD CONSTRAINT "act_results_fate_id_fates_id_fk" FOREIGN KEY ("fate_id") REFERENCES "public"."fates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acts" ADD CONSTRAINT "acts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acts" ADD CONSTRAINT "acts_created_by_id_players_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acts" ADD CONSTRAINT "acts_updated_by_id_players_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_players_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_players" ADD CONSTRAINT "campaign_players_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_players" ADD CONSTRAINT "campaign_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_id_players_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_linked_player_id_players_id_fk" FOREIGN KEY ("linked_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_created_by_id_players_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "act_results_unique" ON "act_results" USING btree ("act_id","campaign_player_id");--> statement-breakpoint
CREATE INDEX "act_results_fate_idx" ON "act_results" USING btree ("fate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "acts_campaign_act_unique" ON "acts" USING btree ("campaign_id","act_no");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_campaign_idx" ON "audit_log" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_players_unique" ON "campaign_players" USING btree ("campaign_id","player_id");--> statement-breakpoint
CREATE INDEX "campaign_players_player_idx" ON "campaign_players" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaigns_last_activity_idx" ON "campaigns" USING btree ("last_activity_at");