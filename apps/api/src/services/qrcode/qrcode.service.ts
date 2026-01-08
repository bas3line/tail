import { createLogger } from "@tails/logger";
import { getQRCodePool } from "../../workers";

const log = createLogger("qrcode-service");

export type QRCodeFormat = "png" | "svg" | "utf8";
export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface QRCodeOptions {
  width?: number;
  margin?: number;
  color?: {
    dark?: string;
    light?: string;
  };
  errorCorrectionLevel?: ErrorCorrectionLevel;
  format?: QRCodeFormat;
}

export interface QRCodeResult {
  data: Buffer | string;
  mimeType: string;
}

/**
 * Generate QR code from text/URL using worker
 */
export async function generateQRCode(
  content: string,
  options: QRCodeOptions = {}
): Promise<QRCodeResult> {
  const pool = getQRCodePool();
  return pool.execute<any, QRCodeResult>("generate", {
    content,
    ...options,
  });
}

/**
 * Generate WiFi QR code using worker
 */
export async function generateWiFiQR(
  ssid: string,
  password: string,
  options: QRCodeOptions & {
    encryption?: "WPA" | "WEP" | "nopass";
    hidden?: boolean;
  } = {}
): Promise<QRCodeResult> {
  const { encryption = "WPA", hidden = false, ...qrOptions } = options;
  const pool = getQRCodePool();
  return pool.execute<any, QRCodeResult>("wifi", {
    ssid,
    password,
    encryption,
    hidden,
    options: qrOptions,
  });
}

/**
 * Generate vCard QR code using worker
 */
export async function generateVCardQR(
  contact: {
    firstName: string;
    lastName?: string;
    organization?: string;
    title?: string;
    email?: string;
    phone?: string;
    mobile?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
    };
    website?: string;
    note?: string;
  },
  options: QRCodeOptions = {}
): Promise<QRCodeResult> {
  const pool = getQRCodePool();
  return pool.execute<any, QRCodeResult>("vcard", {
    ...contact,
    options,
  });
}

/**
 * Generate Email QR code using worker
 */
export async function generateEmailQR(
  email: string,
  options: QRCodeOptions & {
    subject?: string;
    body?: string;
  } = {}
): Promise<QRCodeResult> {
  const { subject, body, ...qrOptions } = options;
  const pool = getQRCodePool();
  return pool.execute<any, QRCodeResult>("email", {
    email,
    subject,
    body,
    options: qrOptions,
  });
}

/**
 * Generate Phone QR code using worker
 */
export async function generatePhoneQR(
  phone: string,
  options: QRCodeOptions = {}
): Promise<QRCodeResult> {
  const pool = getQRCodePool();
  return pool.execute<any, QRCodeResult>("generate", {
    content: `tel:${phone}`,
    ...options,
  });
}

/**
 * Generate SMS QR code using worker
 */
export async function generateSMSQR(
  phone: string,
  options: QRCodeOptions & { message?: string } = {}
): Promise<QRCodeResult> {
  const { message, ...qrOptions } = options;
  const pool = getQRCodePool();
  return pool.execute<any, QRCodeResult>("sms", {
    phone,
    message,
    options: qrOptions,
  });
}

/**
 * Generate Geo location QR code using worker
 */
export async function generateGeoQR(
  latitude: number,
  longitude: number,
  options: QRCodeOptions & { query?: string } = {}
): Promise<QRCodeResult> {
  const { query, ...qrOptions } = options;
  const pool = getQRCodePool();
  return pool.execute<any, QRCodeResult>("geo", {
    latitude,
    longitude,
    query,
    options: qrOptions,
  });
}

/**
 * Generate Event QR code using worker
 */
export async function generateEventQR(
  event: {
    title: string;
    description?: string;
    location?: string;
    start: Date;
    end: Date;
    allDay?: boolean;
  },
  options: QRCodeOptions = {}
): Promise<QRCodeResult> {
  const pool = getQRCodePool();
  return pool.execute<any, QRCodeResult>("event", {
    ...event,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    options,
  });
}

/**
 * Generate Bitcoin payment QR code using worker
 */
export async function generateBitcoinQR(
  address: string,
  options: QRCodeOptions & {
    amount?: number;
    label?: string;
    message?: string;
  } = {}
): Promise<QRCodeResult> {
  const { amount, label, message, ...qrOptions } = options;
  const pool = getQRCodePool();
  return pool.execute<any, QRCodeResult>("bitcoin", {
    address,
    amount,
    label,
    message,
    options: qrOptions,
  });
}

/**
 * Bulk generate QR codes using worker
 */
export async function bulkGenerateQRCodes(
  contents: string[],
  options: QRCodeOptions = {}
): Promise<QRCodeResult[]> {
  const pool = getQRCodePool();
  return pool.execute<any, QRCodeResult[]>("bulk", {
    contents,
    options,
  });
}

/**
 * Get worker pool statistics
 */
export function getPoolStats() {
  const pool = getQRCodePool();
  return pool.getStats();
}
