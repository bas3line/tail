import { parentPort, workerData } from "worker_threads";
import QRCode from "qrcode";

interface TaskMessage {
  taskId: string;
  type: string;
  data: any;
}

interface TaskResult {
  taskId: string;
  success: boolean;
  data?: any;
  error?: string;
}

// QR Code generation functions
async function generateQRCode(data: {
  content: string;
  width?: number;
  margin?: number;
  color?: { dark?: string; light?: string };
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  format?: "png" | "svg" | "utf8";
}): Promise<{ data: Buffer; mimeType: string }> {
  const {
    content,
    width = 300,
    margin = 4,
    color = { dark: "#000000", light: "#ffffff" },
    errorCorrectionLevel = "M",
    format = "png",
  } = data;

  const qrOptions = {
    width,
    margin,
    color,
    errorCorrectionLevel,
  };

  if (format === "svg") {
    const svg = await QRCode.toString(content, { ...qrOptions, type: "svg" });
    return { data: Buffer.from(svg), mimeType: "image/svg+xml" };
  } else if (format === "utf8") {
    const text = await QRCode.toString(content, { ...qrOptions, type: "utf8" });
    return { data: Buffer.from(text), mimeType: "text/plain" };
  } else {
    const buffer = await QRCode.toBuffer(content, qrOptions);
    return { data: buffer, mimeType: "image/png" };
  }
}

// WiFi QR data
function generateWiFiString(data: {
  ssid: string;
  password?: string;
  encryption?: "WPA" | "WEP" | "nopass";
  hidden?: boolean;
}): string {
  const { ssid, password = "", encryption = "WPA", hidden = false } = data;
  const escapeStr = (str: string) =>
    str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/:/g, "\\:").replace(/"/g, '\\"');
  return `WIFI:T:${encryption};S:${escapeStr(ssid)};P:${escapeStr(password)};H:${hidden ? "true" : "false"};;`;
}

// vCard QR data
function generateVCardString(data: {
  firstName: string;
  lastName?: string;
  organization?: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
}): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${data.lastName || ""};${data.firstName};;;`,
    `FN:${data.firstName}${data.lastName ? " " + data.lastName : ""}`,
  ];

  if (data.organization) lines.push(`ORG:${data.organization}`);
  if (data.title) lines.push(`TITLE:${data.title}`);
  if (data.email) lines.push(`EMAIL:${data.email}`);
  if (data.phone) lines.push(`TEL;TYPE=WORK:${data.phone}`);
  if (data.mobile) lines.push(`TEL;TYPE=CELL:${data.mobile}`);
  if (data.website) lines.push(`URL:${data.website}`);
  if (data.address) {
    const { street, city, state, zip, country } = data.address;
    lines.push(`ADR:;;${street || ""};${city || ""};${state || ""};${zip || ""};${country || ""}`);
  }

  lines.push("END:VCARD");
  return lines.join("\n");
}

// Email QR data
function generateEmailString(data: { email: string; subject?: string; body?: string }): string {
  let mailto = `mailto:${data.email}`;
  const params: string[] = [];
  if (data.subject) params.push(`subject=${encodeURIComponent(data.subject)}`);
  if (data.body) params.push(`body=${encodeURIComponent(data.body)}`);
  if (params.length > 0) mailto += "?" + params.join("&");
  return mailto;
}

// SMS QR data
function generateSMSString(data: { phone: string; message?: string }): string {
  let sms = `sms:${data.phone}`;
  if (data.message) sms += `?body=${encodeURIComponent(data.message)}`;
  return sms;
}

// Geo QR data
function generateGeoString(data: { latitude: number; longitude: number; query?: string }): string {
  let geo = `geo:${data.latitude},${data.longitude}`;
  if (data.query) geo += `?q=${encodeURIComponent(data.query)}`;
  return geo;
}

// Event QR data
function generateEventString(data: {
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay?: boolean;
}): string {
  const formatDate = (dateStr: string, allDay: boolean) => {
    const date = new Date(dateStr);
    if (allDay) return date.toISOString().split("T")[0].replace(/-/g, "");
    return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  };

  const lines = [
    "BEGIN:VEVENT",
    `SUMMARY:${data.title}`,
    `DTSTART:${formatDate(data.start, data.allDay || false)}`,
    `DTEND:${formatDate(data.end, data.allDay || false)}`,
  ];

  if (data.description) lines.push(`DESCRIPTION:${data.description}`);
  if (data.location) lines.push(`LOCATION:${data.location}`);
  lines.push("END:VEVENT");
  return lines.join("\n");
}

// Bitcoin QR data
function generateBitcoinString(data: {
  address: string;
  amount?: number;
  label?: string;
  message?: string;
}): string {
  let bitcoin = `bitcoin:${data.address}`;
  const params: string[] = [];
  if (data.amount) params.push(`amount=${data.amount}`);
  if (data.label) params.push(`label=${encodeURIComponent(data.label)}`);
  if (data.message) params.push(`message=${encodeURIComponent(data.message)}`);
  if (params.length > 0) bitcoin += "?" + params.join("&");
  return bitcoin;
}

// Bulk generation
async function bulkGenerateQRCodes(data: {
  contents: string[];
  options: any;
}): Promise<Array<{ data: Buffer; mimeType: string }>> {
  return Promise.all(
    data.contents.map((content) => generateQRCode({ content, ...data.options }))
  );
}

// Task handler
async function handleTask(message: TaskMessage): Promise<TaskResult> {
  try {
    let result: any;

    switch (message.type) {
      case "generate":
        result = await generateQRCode(message.data);
        break;
      case "wifi":
        const wifiString = generateWiFiString(message.data);
        result = await generateQRCode({ content: wifiString, ...message.data.options });
        break;
      case "vcard":
        const vcardString = generateVCardString(message.data);
        result = await generateQRCode({ content: vcardString, ...message.data.options });
        break;
      case "email":
        const emailString = generateEmailString(message.data);
        result = await generateQRCode({ content: emailString, ...message.data.options });
        break;
      case "sms":
        const smsString = generateSMSString(message.data);
        result = await generateQRCode({ content: smsString, ...message.data.options });
        break;
      case "geo":
        const geoString = generateGeoString(message.data);
        result = await generateQRCode({ content: geoString, ...message.data.options });
        break;
      case "event":
        const eventString = generateEventString(message.data);
        result = await generateQRCode({ content: eventString, ...message.data.options });
        break;
      case "bitcoin":
        const bitcoinString = generateBitcoinString(message.data);
        result = await generateQRCode({ content: bitcoinString, ...message.data.options });
        break;
      case "bulk":
        result = await bulkGenerateQRCodes(message.data);
        break;
      default:
        throw new Error(`Unknown task type: ${message.type}`);
    }

    return {
      taskId: message.taskId,
      success: true,
      data: result,
    };
  } catch (error) {
    return {
      taskId: message.taskId,
      success: false,
      error: (error as Error).message,
    };
  }
}

// Listen for messages
parentPort?.on("message", async (message: TaskMessage) => {
  const result = await handleTask(message);
  parentPort?.postMessage(result);
});

console.log(`[QRCode Worker ${workerData?.workerId}] Ready`);

