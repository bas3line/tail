import type { Context } from "hono";

// User type from better-auth
export interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

// Hono context variables
export interface AppVariables {
  user: User;
  session: Session;
}

// Typed context
export type AppContext = Context<{ Variables: AppVariables }>;

