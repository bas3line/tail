import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";

const API_URL = import.meta.env.PUBLIC_API_URL || "http://localhost:3000";

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [emailOTPClient()],
});
