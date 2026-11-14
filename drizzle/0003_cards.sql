CREATE TABLE "card_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"photo_id" integer NOT NULL,
	"card_id" text NOT NULL,
	"tagged_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"text" text,
	"type" text NOT NULL,
	"product" text NOT NULL,
	"tags" jsonb NOT NULL,
	"fate_id" integer,
	"act" smallint,
	"keys" smallint,
	"flip_side_id" text,
	"source" jsonb NOT NULL,
	"removed_at" timestamp with time zone,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_tags" ADD CONSTRAINT "card_tags_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_tags" ADD CONSTRAINT "card_tags_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_tags" ADD CONSTRAINT "card_tags_tagged_by_id_players_id_fk" FOREIGN KEY ("tagged_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_fate_id_fates_id_fk" FOREIGN KEY ("fate_id") REFERENCES "public"."fates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_tags_unique" ON "card_tags" USING btree ("photo_id","card_id");--> statement-breakpoint
CREATE INDEX "card_tags_card_idx" ON "card_tags" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "cards_fate_idx" ON "cards" USING btree ("fate_id");--> statement-breakpoint
CREATE INDEX "cards_type_idx" ON "cards" USING btree ("type");