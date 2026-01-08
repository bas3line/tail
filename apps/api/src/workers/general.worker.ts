import { parentPort, workerData } from "worker_threads";
import crypto from "crypto";
import { v1 as uuidv1, v4 as uuidv4, v5 as uuidv5, validate as uuidValidate, version as uuidVersion } from "uuid";
import YAML from "yaml";

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

// Hash functions
function generateHash(data: { input: string | Buffer; algorithm: string }): string {
  const hash = crypto.createHash(data.algorithm);
  hash.update(typeof data.input === "string" ? data.input : Buffer.from(data.input));
  return hash.digest("hex");
}

function generateAllHashes(data: { input: string | Buffer }): Record<string, string> {
  const algorithms = ["md5", "sha1", "sha256", "sha384", "sha512"];
  const result: Record<string, string> = {};
  
  for (const alg of algorithms) {
    const hash = crypto.createHash(alg);
    hash.update(typeof data.input === "string" ? data.input : Buffer.from(data.input));
    result[alg] = hash.digest("hex");
  }
  
  return result;
}

function verifyHash(data: { input: string | Buffer; hash: string; algorithm?: string }): { valid: boolean; algorithm?: string } {
  const algorithms = data.algorithm ? [data.algorithm] : ["md5", "sha1", "sha256", "sha384", "sha512"];
  
  for (const alg of algorithms) {
    const computed = generateHash({ input: data.input, algorithm: alg });
    if (computed.toLowerCase() === data.hash.toLowerCase()) {
      return { valid: true, algorithm: alg };
    }
  }
  
  return { valid: false };
}

// Base64 functions
function encodeBase64(data: { input: string | Buffer; urlSafe?: boolean }): string {
  const buffer = typeof data.input === "string" ? Buffer.from(data.input, "utf-8") : Buffer.from(data.input);
  let encoded = buffer.toString("base64");
  
  if (data.urlSafe) {
    encoded = encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  
  return encoded;
}

function decodeBase64(data: { input: string; urlSafe?: boolean }): string {
  let input = data.input;
  
  if (data.urlSafe) {
    input = input.replace(/-/g, "+").replace(/_/g, "/");
    while (input.length % 4) {
      input += "=";
    }
  }
  
  return Buffer.from(input, "base64").toString("utf-8");
}

function encodeBase64File(data: { buffer: Buffer; mimeType?: string }): { base64: string; dataUri: string } {
  const base64 = Buffer.from(data.buffer).toString("base64");
  const mimeType = data.mimeType || "application/octet-stream";
  return {
    base64,
    dataUri: `data:${mimeType};base64,${base64}`,
  };
}

// UUID functions
const UUID_NAMESPACES = {
  DNS: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  URL: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
  OID: "6ba7b812-9dad-11d1-80b4-00c04fd430c8",
  X500: "6ba7b814-9dad-11d1-80b4-00c04fd430c8",
};

function generateUUID(data: { version?: string; count?: number; namespace?: string; name?: string }): string | string[] {
  const { version = "v4", count = 1, namespace, name } = data;
  
  const generator = () => {
    switch (version) {
      case "v1":
        return uuidv1();
      case "v4":
        return uuidv4();
      case "v5":
        if (!name) throw new Error("Name is required for UUID v5");
        const ns = namespace && UUID_NAMESPACES[namespace as keyof typeof UUID_NAMESPACES] 
          ? UUID_NAMESPACES[namespace as keyof typeof UUID_NAMESPACES] 
          : UUID_NAMESPACES.DNS;
        return uuidv5(name, ns);
      default:
        return uuidv4();
    }
  };
  
  if (count === 1) {
    return generator();
  }
  
  return Array.from({ length: Math.min(count, 1000) }, () => generator());
}

function validateUUID(data: { uuid: string }): { valid: boolean; version?: number } {
  const valid = uuidValidate(data.uuid);
  if (!valid) return { valid: false };
  
  return { valid: true, version: uuidVersion(data.uuid) };
}

// JSON functions
function formatJSON(data: { input: string; indent?: number; sortKeys?: boolean }): string {
  const { input, indent = 2, sortKeys = false } = data;
  let parsed = JSON.parse(input);
  
  if (sortKeys) {
    parsed = sortObjectKeys(parsed);
  }
  
  return JSON.stringify(parsed, null, indent);
}

function sortObjectKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj)
      .sort()
      .reduce((result: any, key) => {
        result[key] = sortObjectKeys(obj[key]);
        return result;
      }, {});
  }
  return obj;
}

function minifyJSON(data: { input: string }): string {
  return JSON.stringify(JSON.parse(data.input));
}

function validateJSON(data: { input: string }): { valid: boolean; error?: string } {
  try {
    JSON.parse(data.input);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }
}

function jsonToYAML(data: { input: string }): string {
  const parsed = JSON.parse(data.input);
  return YAML.stringify(parsed);
}

function yamlToJSON(data: { input: string; pretty?: boolean }): string {
  const parsed = YAML.parse(data.input);
  return data.pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
}

function jsonToCSV(data: { input: string; delimiter?: string }): string {
  const { input, delimiter = "," } = data;
  const parsed = JSON.parse(input);
  
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Input must be a non-empty array of objects");
  }
  
  const headers = Object.keys(parsed[0]);
  const rows = parsed.map((obj: any) =>
    headers.map((header) => {
      const value = obj[header];
      if (value === null || value === undefined) return "";
      const str = String(value);
      if (str.includes(delimiter) || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(delimiter)
  );
  
  return [headers.join(delimiter), ...rows].join("\n");
}

function csvToJSON(data: { input: string; delimiter?: string }): string {
  const { input, delimiter = "," } = data;
  const lines = input.trim().split("\n");
  
  if (lines.length < 2) {
    throw new Error("CSV must have at least a header row and one data row");
  }
  
  const headers = parseCSVLine(lines[0], delimiter);
  const result = lines.slice(1).map((line) => {
    const values = parseCSVLine(line, delimiter);
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      obj[header] = values[index] || "";
    });
    return obj;
  });
  
  return JSON.stringify(result, null, 2);
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  
  result.push(current);
  return result;
}

// QR Code data generation
function generateWiFiQRData(data: { ssid: string; password?: string; encryption?: string; hidden?: boolean }): string {
  const { ssid, password = "", encryption = "WPA", hidden = false } = data;
  return `WIFI:T:${encryption};S:${ssid};P:${password};H:${hidden};;`;
}

function generateVCardQRData(data: {
  firstName?: string;
  lastName?: string;
  organization?: string;
  title?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
}): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  
  if (data.firstName || data.lastName) {
    lines.push(`N:${data.lastName || ""};${data.firstName || ""};;;`);
    lines.push(`FN:${[data.firstName, data.lastName].filter(Boolean).join(" ")}`);
  }
  if (data.organization) lines.push(`ORG:${data.organization}`);
  if (data.title) lines.push(`TITLE:${data.title}`);
  if (data.email) lines.push(`EMAIL:${data.email}`);
  if (data.phone) lines.push(`TEL:${data.phone}`);
  if (data.website) lines.push(`URL:${data.website}`);
  if (data.address) lines.push(`ADR:;;${data.address};;;;`);
  
  lines.push("END:VCARD");
  return lines.join("\n");
}

function generateEmailQRData(data: { email: string; subject?: string; body?: string }): string {
  const params = new URLSearchParams();
  if (data.subject) params.set("subject", data.subject);
  if (data.body) params.set("body", data.body);
  const query = params.toString();
  return `mailto:${data.email}${query ? "?" + query : ""}`;
}

function generateSMSQRData(data: { phone: string; message?: string }): string {
  return `smsto:${data.phone}:${data.message || ""}`;
}

function generateGeoQRData(data: { latitude: number; longitude: number }): string {
  return `geo:${data.latitude},${data.longitude}`;
}

function generateEventQRData(data: {
  title: string;
  start: string;
  end?: string;
  location?: string;
  description?: string;
}): string {
  const lines = [
    "BEGIN:VEVENT",
    `SUMMARY:${data.title}`,
    `DTSTART:${data.start.replace(/[-:]/g, "")}`,
  ];
  
  if (data.end) lines.push(`DTEND:${data.end.replace(/[-:]/g, "")}`);
  if (data.location) lines.push(`LOCATION:${data.location}`);
  if (data.description) lines.push(`DESCRIPTION:${data.description}`);
  
  lines.push("END:VEVENT");
  return lines.join("\n");
}

// Task handler
async function handleTask(message: TaskMessage): Promise<TaskResult> {
  try {
    let result: any;
    
    switch (message.type) {
      // Hash operations
      case "hash":
        result = generateHash(message.data);
        break;
      case "hashAll":
        result = generateAllHashes(message.data);
        break;
      case "hashVerify":
        result = verifyHash(message.data);
        break;
      
      // Base64 operations
      case "base64Encode":
        result = encodeBase64(message.data);
        break;
      case "base64Decode":
        result = decodeBase64(message.data);
        break;
      case "base64EncodeFile":
        result = encodeBase64File(message.data);
        break;
      
      // UUID operations
      case "uuid":
        result = generateUUID(message.data);
        break;
      case "uuidValidate":
        result = validateUUID(message.data);
        break;
      
      // JSON operations
      case "jsonFormat":
        result = formatJSON(message.data);
        break;
      case "jsonMinify":
        result = minifyJSON(message.data);
        break;
      case "jsonValidate":
        result = validateJSON(message.data);
        break;
      case "jsonToYaml":
        result = jsonToYAML(message.data);
        break;
      case "yamlToJson":
        result = yamlToJSON(message.data);
        break;
      case "jsonToCsv":
        result = jsonToCSV(message.data);
        break;
      case "csvToJson":
        result = csvToJSON(message.data);
        break;
      
      // QR data generation
      case "qrWifi":
        result = generateWiFiQRData(message.data);
        break;
      case "qrVcard":
        result = generateVCardQRData(message.data);
        break;
      case "qrEmail":
        result = generateEmailQRData(message.data);
        break;
      case "qrSms":
        result = generateSMSQRData(message.data);
        break;
      case "qrGeo":
        result = generateGeoQRData(message.data);
        break;
      case "qrEvent":
        result = generateEventQRData(message.data);
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

// Listen for messages from parent
parentPort?.on("message", async (message: TaskMessage) => {
  const result = await handleTask(message);
  parentPort?.postMessage(result);
});

// Signal ready
console.log(`[General Worker ${workerData?.workerId}] Ready`);

