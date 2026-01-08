import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";

export const createClient = (baseURL: string) => {
  return createAuthClient({
    baseURL,
    plugins: [emailOTPClient()],
  });
};

export type AuthClient = ReturnType<typeof createClient>;
