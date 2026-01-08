import { auth } from "@tails/auth";

export const authService = {
  /**
   * Handle all better-auth requests
   */
  handler: auth.handler,

  /**
   * Get session from request
   */
  async getSession(request: Request) {
    const session = await auth.api.getSession({
      headers: request.headers,
    });
    return session;
  },

  /**
   * Validate if user is authenticated
   */
  async validateSession(request: Request) {
    const session = await this.getSession(request);
    if (!session) {
      throw new Error("Unauthorized");
    }
    return session;
  },
};

