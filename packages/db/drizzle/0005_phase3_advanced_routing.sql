-- Routing rules table for geo-based routing
CREATE TABLE "link_routing_rules" (
  "id" text PRIMARY KEY,
  "link_id" text NOT NULL REFERENCES "links"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "countries" text,
  "destination_url" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "link_routing_rules_link_id_idx" ON "link_routing_rules" USING btree ("link_id");
CREATE INDEX "link_routing_rules_priority_idx" ON "link_routing_rules" USING btree ("priority");

-- A/B testing variants table
CREATE TABLE "link_variants" (
  "id" text PRIMARY KEY,
  "link_id" text NOT NULL REFERENCES "links"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "destination_url" text NOT NULL,
  "weight" integer DEFAULT 50 NOT NULL,
  "clicks" integer DEFAULT 0 NOT NULL,
  "conversions" integer DEFAULT 0,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "link_variants_link_id_idx" ON "link_variants" USING btree ("link_id");
CREATE INDEX "link_variants_active_idx" ON "link_variants" USING btree ("active");

-- Link aliases table (multiple slugs → same link)
CREATE TABLE "link_aliases" (
  "id" text PRIMARY KEY,
  "link_id" text NOT NULL REFERENCES "links"("id") ON DELETE CASCADE,
  "slug" text NOT NULL UNIQUE,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "link_aliases_link_id_idx" ON "link_aliases" USING btree ("link_id");
CREATE INDEX "link_aliases_slug_idx" ON "link_aliases" USING btree ("slug");

-- Add variant tracking to link_clicks
ALTER TABLE "link_clicks" ADD COLUMN "variant_id" text;
CREATE INDEX "link_clicks_variant_id_idx" ON "link_clicks" USING btree ("variant_id");
