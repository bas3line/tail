import { createLogger } from "@tails/logger";
import { getGeneralPool } from "../../workers";

const log = createLogger("utils-service");

// ============ HASH FUNCTIONS ============

export type HashAlgorithm = "md5" | "sha1" | "sha256" | "sha384" | "sha512";

/**
 * Generate a hash from a string or buffer
 */
export async function generateHash(
  input: string | Buffer,
  algorithm: HashAlgorithm
): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<{ input: string | Buffer; algorithm: string }, string>("hash", {
    input,
    algorithm,
  });
}

/**
 * Generate all common hashes at once
 */
export async function generateAllHashes(
  input: string | Buffer
): Promise<Record<HashAlgorithm, string>> {
  const pool = getGeneralPool();
  return pool.execute<{ input: string | Buffer }, Record<HashAlgorithm, string>>("hashAll", {
    input,
  });
}

/**
 * Verify a hash against input
 */
export async function verifyHash(
  input: string | Buffer,
  hash: string,
  algorithm?: HashAlgorithm
): Promise<{ valid: boolean; algorithm?: string }> {
  const pool = getGeneralPool();
  return pool.execute<{ input: string | Buffer; hash: string; algorithm?: string }, { valid: boolean; algorithm?: string }>("hashVerify", {
    input,
    hash,
    algorithm,
  });
}

// ============ BASE64 FUNCTIONS ============

/**
 * Encode a string to Base64
 */
export async function encodeBase64(
  input: string,
  urlSafe: boolean = false
): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<{ input: string; urlSafe: boolean }, string>("base64Encode", {
    input,
    urlSafe,
  });
}

/**
 * Decode a Base64 string
 */
export async function decodeBase64(
  input: string,
  urlSafe: boolean = false
): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<{ input: string; urlSafe: boolean }, string>("base64Decode", {
    input,
    urlSafe,
  });
}

/**
 * Encode a file buffer to Base64 with data URI
 */
export async function encodeBase64File(
  buffer: Buffer,
  mimeType?: string
): Promise<{ base64: string; dataUri: string }> {
  const pool = getGeneralPool();
  return pool.execute<{ buffer: Buffer; mimeType?: string }, { base64: string; dataUri: string }>("base64EncodeFile", {
    buffer,
    mimeType,
  });
}

// ============ UUID FUNCTIONS ============

export type UUIDVersion = "v1" | "v4" | "v5";
export type UUIDNamespace = "DNS" | "URL" | "OID" | "X500";

/**
 * Generate a UUID
 */
export async function generateUUID(options?: {
  version?: UUIDVersion;
  namespace?: UUIDNamespace;
  name?: string;
}): Promise<string> {
  const pool = getGeneralPool();
  const result = await pool.execute<{
    version?: string;
    count?: number;
    namespace?: string;
    name?: string;
  }, string | string[]>("uuid", {
    version: options?.version || "v4",
    count: 1,
    namespace: options?.namespace,
    name: options?.name,
  });
  return Array.isArray(result) ? result[0] : result;
}

/**
 * Generate multiple UUIDs
 */
export async function generateBulkUUIDs(
  count: number,
  version: UUIDVersion = "v4"
): Promise<string[]> {
  const pool = getGeneralPool();
  const result = await pool.execute<{
    version: string;
    count: number;
  }, string | string[]>("uuid", {
    version,
    count: Math.min(count, 1000),
  });
  return Array.isArray(result) ? result : [result];
}

/**
 * Validate a UUID
 */
export async function validateUUID(
  uuid: string
): Promise<{ valid: boolean; version?: number }> {
  const pool = getGeneralPool();
  return pool.execute<{ uuid: string }, { valid: boolean; version?: number }>("uuidValidate", {
    uuid,
  });
}

// ============ JSON FUNCTIONS ============

/**
 * Format/prettify JSON
 */
export async function formatJSON(
  input: string,
  options?: { indent?: number; sortKeys?: boolean }
): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<{ input: string; indent?: number; sortKeys?: boolean }, string>("jsonFormat", {
    input,
    ...options,
  });
}

/**
 * Minify JSON
 */
export async function minifyJSON(input: string): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<{ input: string }, string>("jsonMinify", { input });
}

/**
 * Validate JSON
 */
export async function validateJSON(
  input: string
): Promise<{ valid: boolean; error?: string }> {
  const pool = getGeneralPool();
  return pool.execute<{ input: string }, { valid: boolean; error?: string }>("jsonValidate", {
    input,
  });
}

/**
 * Convert JSON to YAML
 */
export async function jsonToYAML(input: string): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<{ input: string }, string>("jsonToYaml", { input });
}

/**
 * Convert YAML to JSON
 */
export async function yamlToJSON(
  input: string,
  pretty: boolean = true
): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<{ input: string; pretty: boolean }, string>("yamlToJson", {
    input,
    pretty,
  });
}

/**
 * Convert JSON array to CSV
 */
export async function jsonToCSV(
  input: string,
  delimiter: string = ","
): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<{ input: string; delimiter: string }, string>("jsonToCsv", {
    input,
    delimiter,
  });
}

/**
 * Convert CSV to JSON
 */
export async function csvToJSON(
  input: string,
  delimiter: string = ","
): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<{ input: string; delimiter: string }, string>("csvToJson", {
    input,
    delimiter,
  });
}

// ============ QR CODE DATA GENERATORS ============

/**
 * Generate WiFi QR code data
 */
export async function generateWiFiQRData(options: {
  ssid: string;
  password?: string;
  encryption?: "WPA" | "WEP" | "nopass";
  hidden?: boolean;
}): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<typeof options, string>("qrWifi", options);
}

/**
 * Generate vCard QR code data
 */
export async function generateVCardQRData(options: {
  firstName?: string;
  lastName?: string;
  organization?: string;
  title?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
}): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<typeof options, string>("qrVcard", options);
}

/**
 * Generate email QR code data
 */
export async function generateEmailQRData(options: {
  email: string;
  subject?: string;
  body?: string;
}): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<typeof options, string>("qrEmail", options);
}

/**
 * Generate SMS QR code data
 */
export async function generateSMSQRData(options: {
  phone: string;
  message?: string;
}): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<typeof options, string>("qrSms", options);
}

/**
 * Generate geo location QR code data
 */
export async function generateGeoQRData(options: {
  latitude: number;
  longitude: number;
}): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<typeof options, string>("qrGeo", options);
}

/**
 * Generate calendar event QR code data
 */
export async function generateEventQRData(options: {
  title: string;
  start: string;
  end?: string;
  location?: string;
  description?: string;
}): Promise<string> {
  const pool = getGeneralPool();
  return pool.execute<typeof options, string>("qrEvent", options);
}

/**
 * Get worker pool statistics
 */
export function getPoolStats() {
  const pool = getGeneralPool();
  return pool.getStats();
}
