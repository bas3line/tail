import { z } from "zod";

// Email validation with strict rules
export const emailSchema = z
  .string()
  .email("Invalid email address")
  .min(5, "Email too short")
  .max(254, "Email too long") // RFC 5321
  .toLowerCase()
  .trim()
  .refine((email) => {
    // Block disposable email domains (add more as needed)
    const disposableDomains = [
      "tempmail.com",
      "throwaway.email",
      "guerrillamail.com",
      "10minutemail.com",
      "mailinator.com",
      "yopmail.com",
      "fakeinbox.com",
      "trashmail.com",
    ];
    const domain = email.split("@")[1];
    return !disposableDomains.includes(domain);
  }, "Disposable email addresses are not allowed");

// OTP validation
export const otpSchema = z
  .string()
  .length(6, "OTP must be 6 digits")
  .regex(/^\d{6}$/, "OTP must contain only numbers");

// Name validation
export const nameSchema = z
  .string()
  .min(1, "Name is required")
  .max(100, "Name too long")
  .trim()
  .refine((name) => {
    // Block potential XSS/injection
    const dangerousPatterns = /<script|javascript:|on\w+=/i;
    return !dangerousPatterns.test(name);
  }, "Invalid characters in name");

// URL validation
export const urlSchema = z
  .string()
  .url("Invalid URL")
  .max(2048, "URL too long")
  .refine((url) => {
    // Only allow http/https
    return url.startsWith("http://") || url.startsWith("https://");
  }, "URL must use HTTP or HTTPS");

// Password validation (if ever needed)
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password too long")
  .refine((password) => {
    // At least one uppercase, one lowercase, one number
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    return hasUpper && hasLower && hasNumber;
  }, "Password must contain uppercase, lowercase, and a number");

// Generic text sanitization
export function sanitizeText(text: string): string {
  return text
    .trim()
    .replace(/[<>]/g, "") // Remove angle brackets
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .slice(0, 10000); // Limit length
}

// Sanitize for SQL (additional layer, use parameterized queries primarily)
export function sanitizeForDb(text: string): string {
  return text
    .replace(/'/g, "''")
    .replace(/\\/g, "\\\\")
    .replace(/\x00/g, ""); // Remove null bytes
}

// Auth request schemas
export const authSchemas = {
  sendOtp: z.object({
    email: emailSchema,
    type: z.enum(["sign-in", "email-verification", "forget-password"]),
  }),
  verifyOtp: z.object({
    email: emailSchema,
    otp: otpSchema,
  }),
  signup: z.object({
    email: emailSchema,
    name: nameSchema.optional(),
  }),
};

export type SendOtpInput = z.infer<typeof authSchemas.sendOtp>;
export type VerifyOtpInput = z.infer<typeof authSchemas.verifyOtp>;
export type SignupInput = z.infer<typeof authSchemas.signup>;


