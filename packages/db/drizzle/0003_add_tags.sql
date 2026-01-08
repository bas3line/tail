CREATE TABLE "tags" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "link_tags" (
  "link_id" text NOT NULL REFERENCES "links"("id") ON DELETE CASCADE,
  "tag_id" text NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("link_id", "tag_id")
);--> statement-breakpoint

CREATE INDEX "tags_user_id_idx" ON "tags" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_id_name_unique" ON "tags" USING btree ("user_id", "name");--> statement-breakpoint
CREATE INDEX "link_tags_link_id_idx" ON "link_tags" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "link_tags_tag_id_idx" ON "link_tags" USING btree ("tag_id");
