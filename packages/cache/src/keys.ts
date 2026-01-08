/**
 * Cache key generation utilities
 */

export const CacheKeys = {
  // File cache keys
  file: (id: string) => `file:${id}`,
  fileByHash: (hash: string) => `file:hash:${hash}`,

  // Link cache keys
  link: (id: string) => `link:${id}`,
  linkBySlug: (slug: string) => `link:slug:${slug}`,

  // Paste cache keys
  paste: (id: string) => `paste:${id}`,
  pasteBySlug: (slug: string) => `paste:slug:${slug}`,

  // Media cache keys
  media: (id: string) => `media:${id}`,

  // User cache keys
  user: (id: string) => `user:${id}`,
  userByEmail: (email: string) => `user:email:${email}`,

  // API key cache keys
  apiKey: (id: string) => `apikey:${id}`,
  apiKeyByKey: (key: string) => `apikey:key:${key}`,

  // Rate limit cache keys
  rateLimit: (identifier: string, window: string) => `ratelimit:${identifier}:${window}`,
} as const;
