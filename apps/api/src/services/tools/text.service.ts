import { createLogger } from "@tails/logger";
import crypto from "crypto";

const log = createLogger("text-tools");

/**
 * JSON formatter and validator
 */
export function formatJSON(input: string, indent: number = 2): { formatted: string; valid: boolean; error?: string } {
  try {
    const parsed = JSON.parse(input);
    const formatted = JSON.stringify(parsed, null, indent);
    return { formatted, valid: true };
  } catch (error) {
    log.debug("JSON parse error", error as Error);
    return {
      formatted: input,
      valid: false,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

export function minifyJSON(input: string): { minified: string; valid: boolean; error?: string } {
  try {
    const parsed = JSON.parse(input);
    const minified = JSON.stringify(parsed);
    return { minified, valid: true };
  } catch (error) {
    return {
      minified: input,
      valid: false,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

/**
 * Base64 encode/decode
 */
export function base64Encode(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64");
}

export function base64Decode(input: string): { decoded: string; valid: boolean; error?: string } {
  try {
    const decoded = Buffer.from(input, "base64").toString("utf-8");
    return { decoded, valid: true };
  } catch (error) {
    return {
      decoded: "",
      valid: false,
      error: "Invalid Base64 string",
    };
  }
}

/**
 * Hash generators
 */
export function generateHash(input: string, algorithm: "md5" | "sha1" | "sha256" | "sha512"): string {
  return crypto.createHash(algorithm).update(input).digest("hex");
}

export function generateHashes(input: string): {
  md5: string;
  sha1: string;
  sha256: string;
  sha512: string;
} {
  return {
    md5: generateHash(input, "md5"),
    sha1: generateHash(input, "sha1"),
    sha256: generateHash(input, "sha256"),
    sha512: generateHash(input, "sha512"),
  };
}

/**
 * UUID generator
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

export function generateUUIDs(count: number): string[] {
  const max = Math.min(count, 100); // Limit to 100 UUIDs
  return Array.from({ length: max }, () => crypto.randomUUID());
}

/**
 * URL encode/decode
 */
export function urlEncode(input: string): string {
  return encodeURIComponent(input);
}

export function urlDecode(input: string): { decoded: string; valid: boolean; error?: string } {
  try {
    const decoded = decodeURIComponent(input);
    return { decoded, valid: true };
  } catch (error) {
    return {
      decoded: input,
      valid: false,
      error: "Invalid URL-encoded string",
    };
  }
}
