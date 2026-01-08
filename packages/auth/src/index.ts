import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { db, isDatabaseAvailable } from "@tails/db";
import * as schema from "@tails/db/schema";
import { createLogger } from "@tails/logger";

const log = createLogger("auth");

// Validate AUTH_SECRET is set
const authSecret = process.env.AUTH_SECRET || process.env.BETTER_AUTH_SECRET;
if (!authSecret) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET environment variable is required in production");
  }
  log.warn("AUTH_SECRET not set - using insecure default for development only");
}

export type SendOTPFunction = (
  email: string,
  otp: string,
  type: "sign-in" | "email-verification" | "forget-password"
) => Promise<void>;

let sendOTPHandler: SendOTPFunction | null = null;

export const setEmailHandler = (handler: SendOTPFunction) => {
  sendOTPHandler = handler;
  log.debug("Email handler configured");
};

// Check if database is available before configuring auth
const dbAvailable = isDatabaseAvailable();

if (!dbAvailable) {
  log.warn("Database not available - auth features will be limited");
}

// GitHub OAuth configuration check
const githubConfigured = !!(
  process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
);

if (!githubConfigured) {
  log.warn("GitHub OAuth not configured - set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET");
}

// Google OAuth configuration check
const googleConfigured = !!(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

if (!googleConfigured) {
  log.warn("Google OAuth not configured - set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
}

export const auth = betterAuth({
  database: dbAvailable
    ? drizzleAdapter(db, {
        provider: "pg",
        schema: {
          ...schema,
        },
      })
    : undefined as any, // Will fail gracefully on auth attempts
  emailAndPassword: {
    enabled: false, // Disabled in favor of OTP
  },
  plugins: [
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        if (!sendOTPHandler) {
          log.warn("Email handler not set, OTP not sent", { email, type });
          // In development, log the OTP for testing
          if (process.env.NODE_ENV !== "production") {
            log.info(`[DEV] OTP for ${email}: ${otp}`);
          }
          return;
        }

        log.debug("Sending OTP", { email, type });
        await sendOTPHandler(email, otp, type);
      },
      otpLength: 6,
      expiresIn: 600, // 10 minutes
      sendVerificationOnSignUp: true,
    }),
  ],
  socialProviders: {
    ...(githubConfigured && {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      },
    }),
    ...(googleConfigured && {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    }),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },
  trustedOrigins: [
    process.env.WEB_URL || "http://localhost:4321",
    "http://localhost:4321",
    "http://localhost:4322",
    "http://localhost:4323",
  ],
  secret: authSecret,
  baseURL: process.env.BETTER_AUTH_URL || process.env.API_URL || "http://localhost:3000",
  basePath: "/api/auth",
  advanced: {
    // Disable CSRF in development for easier testing
    disableCSRFCheck: process.env.NODE_ENV !== "production",
  },
});

export type Auth = typeof auth;

// Export helper to check auth availability
export const isAuthAvailable = (): boolean => dbAvailable;
