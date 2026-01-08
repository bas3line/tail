import { parentPort, workerData } from "worker_threads";
import sharp from "sharp";

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

// Image processing functions
async function resizeImage(data: {
  buffer: Buffer;
  width?: number;
  height?: number;
  fit?: string;
  position?: string;
  background?: string;
}): Promise<Buffer> {
  const { buffer, width, height, fit = "cover", position = "center", background } = data;
  
  let pipeline = sharp(Buffer.from(buffer));
  
  if (width || height) {
    pipeline = pipeline.resize(width, height, {
      fit: fit as any,
      position: position as any,
      background: background || { r: 255, g: 255, b: 255, alpha: 0 },
    });
  }
  
  return pipeline.toBuffer();
}

async function compressImage(data: {
  buffer: Buffer;
  quality?: number;
  format?: string;
}): Promise<{ buffer: Buffer; format: string }> {
  const { buffer, quality = 80, format } = data;
  
  let pipeline = sharp(Buffer.from(buffer));
  let outputFormat = format;
  
  if (format === "jpeg" || format === "jpg") {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    outputFormat = "jpeg";
  } else if (format === "png") {
    pipeline = pipeline.png({ compressionLevel: 9, palette: true });
  } else if (format === "webp") {
    pipeline = pipeline.webp({ quality, effort: 6 });
  } else if (format === "avif") {
    pipeline = pipeline.avif({ quality, effort: 6 });
  } else {
    // Default to webp
    pipeline = pipeline.webp({ quality, effort: 6 });
    outputFormat = "webp";
  }
  
  return {
    buffer: await pipeline.toBuffer(),
    format: outputFormat || "webp",
  };
}

async function convertImage(data: {
  buffer: Buffer;
  format: string;
  quality?: number;
}): Promise<Buffer> {
  const { buffer, format, quality = 85 } = data;
  
  let pipeline = sharp(Buffer.from(buffer));
  
  switch (format) {
    case "jpeg":
    case "jpg":
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      break;
    case "png":
      pipeline = pipeline.png({ compressionLevel: 9 });
      break;
    case "webp":
      pipeline = pipeline.webp({ quality, effort: 6 });
      break;
    case "avif":
      pipeline = pipeline.avif({ quality, effort: 6 });
      break;
    case "gif":
      pipeline = pipeline.gif();
      break;
    case "tiff":
      pipeline = pipeline.tiff({ quality });
      break;
  }
  
  return pipeline.toBuffer();
}

async function optimizeForWeb(data: {
  buffer: Buffer;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}): Promise<{ webp: Buffer; avif: Buffer; original: Buffer }> {
  const { buffer, maxWidth = 2048, maxHeight = 2048, quality = 80 } = data;
  
  const inputBuffer = Buffer.from(buffer);
  const metadata = await sharp(inputBuffer).metadata();
  let resized: Buffer = inputBuffer;
  
  if ((metadata.width && metadata.width > maxWidth) || (metadata.height && metadata.height > maxHeight)) {
    resized = await sharp(inputBuffer)
      .resize(maxWidth, maxHeight, { fit: "inside", withoutEnlargement: true })
      .toBuffer();
  }
  
  const [webp, avif, original] = await Promise.all([
    sharp(resized).webp({ quality, effort: 6 }).toBuffer(),
    sharp(resized).avif({ quality, effort: 6 }).toBuffer(),
    sharp(resized).jpeg({ quality, mozjpeg: true }).toBuffer(),
  ]);
  
  return { webp, avif, original };
}

async function getImageInfo(data: { buffer: Buffer }): Promise<{
  width: number;
  height: number;
  format: string;
  size: number;
  hasAlpha: boolean;
}> {
  const metadata = await sharp(Buffer.from(data.buffer)).metadata();
  
  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
    format: metadata.format || "unknown",
    size: data.buffer.length,
    hasAlpha: metadata.hasAlpha || false,
  };
}

async function generateThumbnail(data: {
  buffer: Buffer;
  size?: number;
}): Promise<Buffer> {
  const { buffer, size = 200 } = data;
  
  return sharp(Buffer.from(buffer))
    .resize(size, size, { fit: "cover", position: "center" })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function rotateImage(data: {
  buffer: Buffer;
  angle: number;
  background?: string;
}): Promise<Buffer> {
  const { buffer, angle, background } = data;
  
  return sharp(Buffer.from(buffer))
    .rotate(angle, { background: background || { r: 255, g: 255, b: 255, alpha: 0 } })
    .toBuffer();
}

async function flipImage(data: {
  buffer: Buffer;
  direction: "horizontal" | "vertical";
}): Promise<Buffer> {
  const { buffer, direction } = data;
  
  const pipeline = sharp(Buffer.from(buffer));
  
  if (direction === "horizontal") {
    return pipeline.flop().toBuffer();
  } else {
    return pipeline.flip().toBuffer();
  }
}

async function cropImage(data: {
  buffer: Buffer;
  left: number;
  top: number;
  width: number;
  height: number;
}): Promise<Buffer> {
  const { buffer, left, top, width, height } = data;
  
  return sharp(Buffer.from(buffer))
    .extract({ left, top, width, height })
    .toBuffer();
}

// Task handler
async function handleTask(message: TaskMessage): Promise<TaskResult> {
  try {
    let result: any;
    
    switch (message.type) {
      case "resize":
        result = await resizeImage(message.data);
        break;
      case "compress":
        result = await compressImage(message.data);
        break;
      case "convert":
        result = await convertImage(message.data);
        break;
      case "optimize":
        result = await optimizeForWeb(message.data);
        break;
      case "info":
        result = await getImageInfo(message.data);
        break;
      case "thumbnail":
        result = await generateThumbnail(message.data);
        break;
      case "rotate":
        result = await rotateImage(message.data);
        break;
      case "flip":
        result = await flipImage(message.data);
        break;
      case "crop":
        result = await cropImage(message.data);
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
console.log(`[Image Worker ${workerData?.workerId}] Ready`);

