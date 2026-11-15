CREATE TABLE "discord_lobbies" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"opened_by_id" integer NOT NULL,
	"player_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"campaign_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_lobbies_status" CHECK ("discord_lobbies"."status" in ('open', 'started', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "acts" ADD COLUMN "discord_message_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "discord_announcement_id" text;--> statement-breakpoint
ALTER TABLE "discord_lobbies" ADD CONSTRAINT "discord_lobbies_opened_by_id_players_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_lobbies" ADD CONSTRAINT "discord_lobbies_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;