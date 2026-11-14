CREATE TABLE "photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"act_id" integer NOT NULL,
	"campaign_player_id" integer,
	"full_key" text NOT NULL,
	"thumb_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"uploaded_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_act_id_acts_id_fk" FOREIGN KEY ("act_id") REFERENCES "public"."acts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_campaign_player_id_campaign_players_id_fk" FOREIGN KEY ("campaign_player_id") REFERENCES "public"."campaign_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_uploaded_by_id_players_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "photos_tableau_unique" ON "photos" USING btree ("act_id","campaign_player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photos_board_unique" ON "photos" USING btree ("act_id") WHERE "photos"."campaign_player_id" is null;