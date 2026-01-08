/**
 * Server-side auth check for Astro pages
 */

const API_URL = import.meta.env.PUBLIC_API_URL || "http://localhost:3000";

export interface User {
  id: string;
  email: string;
  name?: string;
  image?: string;
}

export interface Session {
  user: User;
  session: {
    id: string;
    expiresAt: string;
  };
}

export async function getSession(request: Request): Promise<Session | null> {
  try {
    const cookie = request.headers.get("cookie");
    if (!cookie) return null;

    const response = await fetch(`${API_URL}/api/auth/get-session`, {
      headers: {
        cookie,
      },
      credentials: "include",
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.user) return null;

    return data as Session;
  } catch (error) {
    console.error("Auth check failed:", error);
    return null;
  }
}

export async function requireAuth(request: Request): Promise<Session> {
  const session = await getSession(request);
  if (!session) {
    throw new Response(null, {
      status: 302,
      headers: {
        Location: "/login",
      },
    });
  }
  return session;
}

