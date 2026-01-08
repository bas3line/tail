import { parentPort, workerData } from "worker_threads";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

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

// PDF processing functions
async function getPDFInfo(data: { buffer: Buffer }): Promise<{
  pageCount: number;
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  producer?: string;
}> {
  const pdfDoc = await PDFDocument.load(Buffer.from(data.buffer));
  
  return {
    pageCount: pdfDoc.getPageCount(),
    title: pdfDoc.getTitle(),
    author: pdfDoc.getAuthor(),
    subject: pdfDoc.getSubject(),
    creator: pdfDoc.getCreator(),
    producer: pdfDoc.getProducer(),
  };
}

async function mergePDFs(data: { buffers: Buffer[] }): Promise<Buffer> {
  const mergedPdf = await PDFDocument.create();
  
  for (const buffer of data.buffers) {
    const pdf = await PDFDocument.load(Buffer.from(buffer));
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    pages.forEach((page) => mergedPdf.addPage(page));
  }
  
  const pdfBytes = await mergedPdf.save();
  return Buffer.from(pdfBytes);
}

async function splitPDF(data: { buffer: Buffer }): Promise<Buffer[]> {
  const pdf = await PDFDocument.load(Buffer.from(data.buffer));
  const pageCount = pdf.getPageCount();
  const results: Buffer[] = [];
  
  for (let i = 0; i < pageCount; i++) {
    const newPdf = await PDFDocument.create();
    const [page] = await newPdf.copyPages(pdf, [i]);
    newPdf.addPage(page);
    const pdfBytes = await newPdf.save();
    results.push(Buffer.from(pdfBytes));
  }
  
  return results;
}

async function extractPages(data: { buffer: Buffer; pages: number[] }): Promise<Buffer> {
  const pdf = await PDFDocument.load(Buffer.from(data.buffer));
  const newPdf = await PDFDocument.create();
  
  const indices = data.pages.map(n => n - 1).filter(i => i >= 0 && i < pdf.getPageCount());
  
  const pages = await newPdf.copyPages(pdf, indices);
  pages.forEach((page) => newPdf.addPage(page));
  
  const pdfBytes = await newPdf.save();
  return Buffer.from(pdfBytes);
}

async function removePages(data: { buffer: Buffer; pages: number[] }): Promise<Buffer> {
  const pdf = await PDFDocument.load(Buffer.from(data.buffer));
  const pageCount = pdf.getPageCount();
  
  const removeSet = new Set(data.pages.map(n => n - 1));
  const keepIndices = Array.from({ length: pageCount }, (_, i) => i)
    .filter(i => !removeSet.has(i));
  
  const newPdf = await PDFDocument.create();
  const pages = await newPdf.copyPages(pdf, keepIndices);
  pages.forEach((page) => newPdf.addPage(page));
  
  const pdfBytes = await newPdf.save();
  return Buffer.from(pdfBytes);
}

async function rotatePDF(data: { buffer: Buffer; degrees: number; pages?: number[] }): Promise<Buffer> {
  const pdf = await PDFDocument.load(Buffer.from(data.buffer));
  const pageCount = pdf.getPageCount();
  
  const pagesToRotate = data.pages 
    ? data.pages.map(n => n - 1).filter(i => i >= 0 && i < pageCount)
    : Array.from({ length: pageCount }, (_, i) => i);
  
  for (const pageIndex of pagesToRotate) {
    const page = pdf.getPage(pageIndex);
    const currentRotation = page.getRotation().angle;
    page.setRotation({ angle: (currentRotation + data.degrees) % 360 } as any);
  }
  
  const pdfBytes = await pdf.save();
  return Buffer.from(pdfBytes);
}

async function addWatermark(data: {
  buffer: Buffer;
  text: string;
  fontSize?: number;
  opacity?: number;
  color?: { r: number; g: number; b: number };
  rotation?: number;
}): Promise<Buffer> {
  const { buffer, text, fontSize = 50, opacity = 0.3, color = { r: 0.5, g: 0.5, b: 0.5 }, rotation = -45 } = data;
  
  const pdf = await PDFDocument.load(Buffer.from(buffer));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  
  for (const page of pages) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: height / 2,
      size: fontSize,
      font,
      color: rgb(color.r, color.g, color.b),
      opacity,
      rotate: { angle: rotation } as any,
    });
  }
  
  const pdfBytes = await pdf.save();
  return Buffer.from(pdfBytes);
}

async function addPageNumbers(data: {
  buffer: Buffer;
  position?: "top" | "bottom";
  alignment?: "left" | "center" | "right";
  format?: string;
  fontSize?: number;
  margin?: number;
}): Promise<Buffer> {
  const { 
    buffer, 
    position = "bottom", 
    alignment = "center", 
    format = "Page {n} of {total}",
    fontSize = 12,
    margin = 30
  } = data;
  
  const pdf = await PDFDocument.load(Buffer.from(buffer));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const totalPages = pages.length;
  
  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    const text = format.replace("{n}", String(index + 1)).replace("{total}", String(totalPages));
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    
    let x: number;
    switch (alignment) {
      case "left": x = margin; break;
      case "right": x = width - textWidth - margin; break;
      default: x = (width - textWidth) / 2;
    }
    
    const y = position === "bottom" ? margin : height - margin - fontSize;
    
    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  });
  
  const pdfBytes = await pdf.save();
  return Buffer.from(pdfBytes);
}

async function setMetadata(data: {
  buffer: Buffer;
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
}): Promise<Buffer> {
  const pdf = await PDFDocument.load(Buffer.from(data.buffer));
  
  if (data.title) pdf.setTitle(data.title);
  if (data.author) pdf.setAuthor(data.author);
  if (data.subject) pdf.setSubject(data.subject);
  if (data.keywords) pdf.setKeywords(data.keywords);
  if (data.creator) pdf.setCreator(data.creator);
  
  const pdfBytes = await pdf.save();
  return Buffer.from(pdfBytes);
}

async function compressPDF(data: { buffer: Buffer }): Promise<Buffer> {
  const pdf = await PDFDocument.load(Buffer.from(data.buffer), { 
    ignoreEncryption: true,
  });
  
  const pdfBytes = await pdf.save({
    useObjectStreams: true,
  });
  
  return Buffer.from(pdfBytes);
}

async function imagesToPDF(data: {
  images: Array<{ buffer: Buffer; mimeType: string }>;
}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  
  for (const image of data.images) {
    let embeddedImage;
    
    if (image.mimeType === "image/jpeg" || image.mimeType === "image/jpg") {
      embeddedImage = await pdf.embedJpg(Buffer.from(image.buffer));
    } else if (image.mimeType === "image/png") {
      embeddedImage = await pdf.embedPng(Buffer.from(image.buffer));
    } else {
      continue;
    }
    
    const page = pdf.addPage([embeddedImage.width, embeddedImage.height]);
    page.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: embeddedImage.width,
      height: embeddedImage.height,
    });
  }
  
  const pdfBytes = await pdf.save();
  return Buffer.from(pdfBytes);
}

async function reorderPages(data: { buffer: Buffer; order: number[] }): Promise<Buffer> {
  const pdf = await PDFDocument.load(Buffer.from(data.buffer));
  const newPdf = await PDFDocument.create();
  
  const indices = data.order.map(n => n - 1).filter(i => i >= 0 && i < pdf.getPageCount());
  
  const pages = await newPdf.copyPages(pdf, indices);
  pages.forEach((page) => newPdf.addPage(page));
  
  const pdfBytes = await newPdf.save();
  return Buffer.from(pdfBytes);
}

// Task handler
async function handleTask(message: TaskMessage): Promise<TaskResult> {
  try {
    let result: any;
    
    switch (message.type) {
      case "info":
        result = await getPDFInfo(message.data);
        break;
      case "merge":
        result = await mergePDFs(message.data);
        break;
      case "split":
        result = await splitPDF(message.data);
        break;
      case "extract":
        result = await extractPages(message.data);
        break;
      case "remove":
        result = await removePages(message.data);
        break;
      case "rotate":
        result = await rotatePDF(message.data);
        break;
      case "watermark":
        result = await addWatermark(message.data);
        break;
      case "pageNumbers":
        result = await addPageNumbers(message.data);
        break;
      case "metadata":
        result = await setMetadata(message.data);
        break;
      case "compress":
        result = await compressPDF(message.data);
        break;
      case "imagesToPdf":
        result = await imagesToPDF(message.data);
        break;
      case "reorder":
        result = await reorderPages(message.data);
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
console.log(`[PDF Worker ${workerData?.workerId}] Ready`);

