/**
 * API Client for Tails Dashboard
 */

const API_URL = import.meta.env.PUBLIC_API_URL || "http://localhost:3000";

interface FetchOptions extends RequestInit {
  params?: Record<string, string>;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public data?: any
  ) {
    super(`API Error: ${status} ${statusText}`);
    this.name = "ApiError";
  }
}

async function fetchApi<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options;
  
  let url = `${API_URL}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const response = await fetch(url, {
    ...fetchOptions,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...fetchOptions.headers,
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, response.statusText, data);
  }

  return response.json();
}

// ==================== Auth ====================
export const auth = {
  async getSession() {
    try {
      return await fetchApi<{ user: any; session: any }>("/api/auth/get-session");
    } catch {
      return null;
    }
  },

  async signOut() {
    return fetchApi("/api/auth/sign-out", { method: "POST" });
  },
};

// ==================== Files ====================
export interface File {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  visibility: "public" | "private" | "unlisted";
  createdAt: string;
  updatedAt: string;
  url?: string;
  shareToken?: string;
}

export const files = {
  async list(params?: { page?: number; limit?: number; folderId?: string }) {
    return fetchApi<{ files: File[]; total: number; page: number; limit: number }>(
      "/api/files",
      { params: params as any }
    );
  },

  async get(id: string) {
    return fetchApi<File>(`/api/files/${id}`);
  },

  async delete(id: string) {
    return fetchApi(`/api/files/${id}`, { method: "DELETE" });
  },

  async updateVisibility(id: string, visibility: "public" | "private" | "unlisted") {
    return fetchApi<File>(`/api/files/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ visibility }),
    });
  },

  getUploadUrl() {
    return `${API_URL}/api/files/upload`;
  },
};

// ==================== Links ====================
export interface Link {
  id: string;
  slug: string;
  originalUrl: string;
  clicks: number;
  password?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const links = {
  async list(params?: { page?: number; limit?: number }) {
    return fetchApi<{ links: Link[]; total: number; page: number; limit: number }>(
      "/api/links",
      { params: params as any }
    );
  },

  async create(data: { url: string; slug?: string; password?: string; expiresAt?: string }) {
    return fetchApi<Link>("/api/links", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async get(id: string) {
    return fetchApi<Link>(`/api/links/${id}`);
  },

  async update(id: string, data: Partial<Link>) {
    return fetchApi<Link>(`/api/links/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  async delete(id: string) {
    return fetchApi(`/api/links/${id}`, { method: "DELETE" });
  },

  async getStats(id: string) {
    return fetchApi<{ clicks: number; referrers: Record<string, number>; countries: Record<string, number> }>(
      `/api/links/${id}/stats`
    );
  },
};

// ==================== Pastes ====================
export interface Paste {
  id: string;
  title?: string;
  content: string;
  language: string;
  visibility: "public" | "private" | "unlisted";
  views: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const pastes = {
  async list(params?: { page?: number; limit?: number }) {
    return fetchApi<{ pastes: Paste[]; total: number; page: number; limit: number }>(
      "/api/pastes",
      { params: params as any }
    );
  },

  async create(data: { content: string; title?: string; language?: string; visibility?: string; expiresAt?: string }) {
    return fetchApi<Paste>("/api/pastes", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async get(id: string) {
    return fetchApi<Paste>(`/api/pastes/${id}`);
  },

  async delete(id: string) {
    return fetchApi(`/api/pastes/${id}`, { method: "DELETE" });
  },
};

// ==================== Media ====================
export interface Media {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  visibility: "public" | "private" | "unlisted";
  views: number;
  createdAt: string;
  updatedAt: string;
}

export const media = {
  async list(params?: { page?: number; limit?: number }) {
    return fetchApi<{ media: Media[]; total: number; page: number; limit: number }>(
      "/api/media",
      { params: params as any }
    );
  },

  async get(id: string) {
    return fetchApi<Media>(`/api/media/${id}`);
  },

  async delete(id: string) {
    return fetchApi(`/api/media/${id}`, { method: "DELETE" });
  },
};

// ==================== API Keys ====================
export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

export const apiKeys = {
  async list() {
    return fetchApi<{ keys: ApiKey[] }>("/api/keys");
  },

  async create(data: { name: string; scopes?: string[]; expiresAt?: string }) {
    return fetchApi<{ key: ApiKey; secret: string }>("/api/keys", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async revoke(id: string) {
    return fetchApi(`/api/keys/${id}`, { method: "DELETE" });
  },
};

// ==================== Dashboard Stats ====================
export interface DashboardStats {
  apiRequests: { total: number; change: number };
  storageUsed: { bytes: number; total: number };
  shortLinks: { total: number; newThisWeek: number };
  bandwidth: { bytes: number; change: number };
}

export interface UsageData {
  date: string;
  requests: number;
}

export interface Activity {
  id: string;
  type: "upload" | "link" | "paste" | "api_key" | "delete";
  description: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export const dashboard = {
  async getStats() {
    return fetchApi<DashboardStats>("/api/dashboard/stats");
  },

  async getUsage(days: number = 7) {
    return fetchApi<{ data: UsageData[] }>("/api/dashboard/usage", {
      params: { days: String(days) },
    });
  },

  async getActivity(limit: number = 10) {
    return fetchApi<{ activities: Activity[] }>("/api/dashboard/activity", {
      params: { limit: String(limit) },
    });
  },
};

// Export everything
export default {
  auth,
  files,
  links,
  pastes,
  media,
  apiKeys,
  dashboard,
};

