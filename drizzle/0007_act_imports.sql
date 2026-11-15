CREATE TABLE "act_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"game_id" text NOT NULL,
	"act_no" smallint NOT NULL,
	"campaign_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"campaign_id" integer,
	"act_id" integer,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by_id" integer,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "act_imports_status" CHECK ("act_imports"."status" in ('pending', 'saved', 'discarded')),
	CONSTRAINT "act_imports_act_no" CHECK ("act_imports"."act_no" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "player_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"name" text NOT NULL,
	"player_id" integer NOT NULL,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "source_platform" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "source_campaign_key" text;--> statement-breakpoint
ALTER TABLE "act_imports" ADD CONSTRAINT "act_imports_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "act_imports" ADD CONSTRAINT "act_imports_act_id_acts_id_fk" FOREIGN KEY ("act_id") REFERENCES "public"."acts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "act_imports" ADD CONSTRAINT "act_imports_resolved_by_id_players_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_aliases" ADD CONSTRAINT "player_aliases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_aliases" ADD CONSTRAINT "player_aliases_created_by_id_players_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "act_imports_unique" ON "act_imports" USING btree ("platform","game_id","act_no");--> statement-breakpoint
CREATE INDEX "act_imports_status_idx" ON "act_imports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "act_imports_campaign_idx" ON "act_imports" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_aliases_unique" ON "player_aliases" USING btree ("platform","name");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_source_unique" ON "campaigns" USING btree ("source_platform","source_campaign_key") WHERE "campaigns"."source_campaign_key" is not null;