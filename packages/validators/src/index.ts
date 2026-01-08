import { z } from "zod";

// Auth schemas
export const loginSchema = z.object({
  provider: z.enum(["github"]),
});

export const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().optional(),
});

// File schemas
export const uploadFileSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  size: z.number().positive().max(100 * 1024 * 1024), // 100MB max
});

export const fileQuerySchema = z.object({
  page: z.coerce.number().positive().default(1),
  limit: z.coerce.number().positive().max(100).default(20),
  search: z.string().optional(),
});

// Download schemas
export const downloadVideoSchema = z.object({
  url: z.string().url(),
  quality: z.enum(["360", "480", "720", "1080", "best"]).default("720"),
  audioOnly: z.boolean().default(false),
});

// API Key schemas
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.object({
    canUpload: z.boolean().default(false),
    canDownload: z.boolean().default(false),
    canViewFiles: z.boolean().default(false),
    canManageKeys: z.boolean().default(false),
  }),
  rateLimit: z.number().positive().max(1000).default(60),
  expiresAt: z.string().datetime().optional(),
});

export const updateApiKeySchema = createApiKeySchema.partial();

// Pagination schemas
export const paginationSchema = z.object({
  page: z.coerce.number().positive().default(1),
  limit: z.coerce.number().positive().max(100).default(20),
});

// Export types
export type LoginInput = z.infer<typeof loginSchema>;
export type CallbackInput = z.infer<typeof callbackSchema>;
export type UploadFileInput = z.infer<typeof uploadFileSchema>;
export type FileQueryInput = z.infer<typeof fileQuerySchema>;
export type DownloadVideoInput = z.infer<typeof downloadVideoSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type UpdateApiKeyInput = z.infer<typeof updateApiKeySchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;

export { z };
