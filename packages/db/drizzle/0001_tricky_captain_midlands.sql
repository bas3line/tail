CREATE INDEX "link_clicks_link_id_clicked_at_idx" ON "link_clicks" USING btree ("link_id","clicked_at");--> statement-breakpoint
CREATE INDEX "link_clicks_clicked_at_idx" ON "link_clicks" USING btree ("clicked_at");--> statement-breakpoint
CREATE INDEX "links_slug_idx" ON "links" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "links_user_id_deleted_at_idx" ON "links" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "links_active_idx" ON "links" USING btree ("active");--> statement-breakpoint
CREATE INDEX "links_user_id_active_idx" ON "links" USING btree ("user_id","active");