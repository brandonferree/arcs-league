ALTER TABLE "cards" ADD COLUMN "image_key" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "thumb_key" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "image_stale" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "image_copied_at" timestamp with time zone;