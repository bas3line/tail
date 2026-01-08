ALTER TABLE "links" ADD COLUMN "redirect_type" integer DEFAULT 302 NOT NULL;--> statement-breakpoint
CREATE INDEX "links_redirect_type_idx" ON "links" USING btree ("redirect_type");
