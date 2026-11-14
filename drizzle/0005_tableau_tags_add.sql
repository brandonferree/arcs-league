ALTER TABLE "card_tags" ADD COLUMN "act_id" integer;--> statement-breakpoint
ALTER TABLE "card_tags" ADD COLUMN "campaign_player_id" integer;--> statement-breakpoint
ALTER TABLE "card_tags" ADD CONSTRAINT "card_tags_act_id_acts_id_fk" FOREIGN KEY ("act_id") REFERENCES "public"."acts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_tags" ADD CONSTRAINT "card_tags_campaign_player_id_campaign_players_id_fk" FOREIGN KEY ("campaign_player_id") REFERENCES "public"."campaign_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Card tags move from photos to tableaux (act + player): copy each tag's slot from its photo.
UPDATE "card_tags" SET "act_id" = p."act_id", "campaign_player_id" = p."campaign_player_id"
FROM "photos" p WHERE p."id" = "card_tags"."photo_id";--> statement-breakpoint
DELETE FROM "card_tags" WHERE "act_id" IS NULL OR "campaign_player_id" IS NULL;--> statement-breakpoint
-- The owner dropped the base game's court cards (ARCS-BC01..31), 2026-11-14. Hidden, not deleted, so any tags survive.
UPDATE "cards" SET "removed_at" = now() WHERE "id" LIKE 'ARCS-BC%' AND "removed_at" IS NULL;
