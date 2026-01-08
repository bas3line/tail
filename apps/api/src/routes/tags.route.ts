import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware";
import { createLogger } from "@tails/logger";
import type { AppVariables } from "../types";
import * as tagsService from "../services/links/tags.service";

const log = createLogger("tags-route");

const tagsRoutes = new Hono<{ Variables: AppVariables }>();

// All tag routes require authentication
tagsRoutes.use("*", requireAuth);

// Validation schemas
const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const updateTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

// Create tag
tagsRoutes.post("/", zValidator("json", createTagSchema), async (c) => {
  const user = c.get("user");
  const input = c.req.valid("json");

  try {
    const tag = await tagsService.createTag(user.id, input.name, input.color);

    return c.json({
      success: true,
      tag,
    }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === "Tag already exists") {
      return c.json({ error: "Tag already exists" }, 409);
    }
    throw error;
  }
});

// List tags
tagsRoutes.get("/", async (c) => {
  const user = c.get("user");

  const tags = await tagsService.listUserTags(user.id);

  return c.json({ tags });
});

// Get tag by ID
tagsRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const tag = await tagsService.getTagById(id, user.id);
  if (!tag) {
    return c.json({ error: "Tag not found" }, 404);
  }

  return c.json({ tag });
});

// Update tag
tagsRoutes.patch("/:id", zValidator("json", updateTagSchema), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = c.req.valid("json");

  const updated = await tagsService.updateTag(id, user.id, input);

  if (!updated) {
    return c.json({ error: "Tag not found" }, 404);
  }

  return c.json({ tag: updated });
});

// Delete tag
tagsRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const deleted = await tagsService.deleteTag(id, user.id);
  if (!deleted) {
    return c.json({ error: "Tag not found" }, 404);
  }

  return c.json({ success: true });
});

export { tagsRoutes };
