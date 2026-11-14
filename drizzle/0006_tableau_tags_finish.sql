ALTER TABLE "card_tags" DROP CONSTRAINT "card_tags_photo_id_photos_id_fk";
--> statement-breakpoint
DROP INDEX "card_tags_unique";--> statement-breakpoint
ALTER TABLE "card_tags" ALTER COLUMN "act_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "card_tags" ALTER COLUMN "campaign_player_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "card_tags_unique" ON "card_tags" USING btree ("act_id","campaign_player_id","card_id");--> statement-breakpoint
ALTER TABLE "card_tags" DROP COLUMN "photo_id";