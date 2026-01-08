-- Advanced expiry fields
ALTER TABLE "links" ADD COLUMN "starts_at" timestamp;
ALTER TABLE "links" ADD COLUMN "timezone" text;
ALTER TABLE "links" ADD COLUMN "grace_period" integer;
ALTER TABLE "links" ADD COLUMN "auto_archive" boolean DEFAULT false NOT NULL;

-- Metadata preview fields
ALTER TABLE "links" ADD COLUMN "og_title" text;
ALTER TABLE "links" ADD COLUMN "og_description" text;
ALTER TABLE "links" ADD COLUMN "og_image" text;
ALTER TABLE "links" ADD COLUMN "og_image_width" integer;
ALTER TABLE "links" ADD COLUMN "og_image_height" integer;
ALTER TABLE "links" ADD COLUMN "metadata_fetched_at" timestamp;
ALTER TABLE "links" ADD COLUMN "metadata_error" text;

-- Enhanced analytics fields
ALTER TABLE "link_clicks" ADD COLUMN "session_id" text;
ALTER TABLE "link_clicks" ADD COLUMN "hour" integer;

-- Indexes
CREATE INDEX "links_starts_at_idx" ON "links" USING btree ("starts_at");
CREATE INDEX "links_expires_at_idx" ON "links" USING btree ("expires_at");
CREATE INDEX "link_clicks_session_id_idx" ON "link_clicks" USING btree ("session_id");
CREATE INDEX "link_clicks_hour_idx" ON "link_clicks" USING btree ("hour");
