import { createLogger } from "@tails/logger";
import QRCode from "qrcode";

const log = createLogger("qr-tools");

export interface QRCodeOptions {
  content: string;
  size?: number;
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  foregroundColor?: string;
  backgroundColor?: string;
  margin?: number;
  type?: "url" | "text" | "wifi" | "vcard" | "email";
}

/**
 * Generate QR code as PNG buffer
 */
export async function generateQRCode(options: QRCodeOptions): Promise<Buffer> {
  const {
    content,
    size = 512,
    errorCorrectionLevel = "M",
    foregroundColor = "#000000",
    backgroundColor = "#ffffff",
    margin = 4,
  } = options;

  if (!content || content.trim().length === 0) {
    throw new Error("QR code content is required");
  }

  if (size < 128 || size > 2048) {
    throw new Error("Size must be between 128 and 2048 pixels");
  }

  try {
    const buffer = await QRCode.toBuffer(content, {
      width: size,
      margin,
      errorCorrectionLevel,
      color: {
        dark: foregroundColor,
        light: backgroundColor,
      },
      type: "png",
    });

    log.info("QR code generated", {
      size,
      contentLength: content.length,
      bufferSize: buffer.length,
    });

    return buffer;
  } catch (error) {
    log.error("Failed to generate QR code", error as Error);
    throw new Error("Failed to generate QR code");
  }
}

/**
 * Generate QR code as SVG string
 */
export async function generateQRCodeSVG(options: QRCodeOptions): Promise<string> {
  const {
    content,
    errorCorrectionLevel = "M",
    foregroundColor = "#000000",
    backgroundColor = "#ffffff",
    margin = 4,
  } = options;

  if (!content || content.trim().length === 0) {
    throw new Error("QR code content is required");
  }

  try {
    const svg = await QRCode.toString(content, {
      type: "svg",
      margin,
      errorCorrectionLevel,
      color: {
        dark: foregroundColor,
        light: backgroundColor,
      },
    });

    log.info("QR code SVG generated", { contentLength: content.length });

    return svg;
  } catch (error) {
    log.error("Failed to generate QR code SVG", error as Error);
    throw new Error("Failed to generate QR code SVG");
  }
}

/**
 * Format content based on type
 */
export function formatQRContent(type: string, data: Record<string, string>): string {
  switch (type) {
    case "wifi":
      return `WIFI:T:${data.encryption || "WPA"};S:${data.ssid};P:${data.password};;`;
    
    case "vcard":
      return [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${data.name}`,
        data.email ? `EMAIL:${data.email}` : "",
        data.phone ? `TEL:${data.phone}` : "",
        data.url ? `URL:${data.url}` : "",
        "END:VCARD",
      ].filter(Boolean).join("\n");
    
    case "email":
      return `mailto:${data.email}?subject=${encodeURIComponent(data.subject || "")}&body=${encodeURIComponent(data.body || "")}`;
    
    case "url":
    case "text":
    default:
      return data.content || "";
  }
}
