import { parentPort, workerData } from "worker_threads";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import os from "os";
import crypto from "crypto";

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

// Supported platforms
const SUPPORTED_PLATFORMS = [
  "youtube", "youtu.be",
  "tiktok",
  "instagram",
  "twitter", "x.com",
  "reddit",
  "facebook", "fb.watch",
  "vimeo",
  "dailymotion",
  "twitch",
  "soundcloud",
  "spotify",
  "bandcamp",
  "mixcloud",
];

// Check if yt-dlp is available
async function checkYtDlp(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("yt-dlp", ["--version"]);
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

// Execute yt-dlp command
async function execYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      }
    });

    proc.on("error", (err) => reject(err));
  });
}

// Get video information
async function getVideoInfo(data: { url: string }) {
  const available = await checkYtDlp();
  if (!available) {
    throw new Error("yt-dlp is not installed");
  }

  const parsedUrl = new URL(data.url);
  const platform = SUPPORTED_PLATFORMS.find(p => parsedUrl.hostname.includes(p));

  if (!platform) {
    throw new Error("Unsupported platform");
  }

  const output = await execYtDlp([
    "--dump-json",
    "--no-warnings",
    data.url,
  ]);

  const info = JSON.parse(output);

  const formats: any[] = [];
  const audioFormats: any[] = [];

  for (const f of info.formats || []) {
    if (f.vcodec && f.vcodec !== "none") {
      formats.push({
        formatId: f.format_id,
        ext: f.ext,
        quality: f.format_note || f.quality || "unknown",
        resolution: f.resolution,
        fps: f.fps,
        filesize: f.filesize || f.filesize_approx,
        vcodec: f.vcodec,
        acodec: f.acodec,
        hasAudio: f.acodec && f.acodec !== "none",
        hasVideo: true,
      });
    } else if (f.acodec && f.acodec !== "none") {
      audioFormats.push({
        formatId: f.format_id,
        ext: f.ext,
        quality: f.format_note || f.quality || "unknown",
        bitrate: f.abr,
        filesize: f.filesize || f.filesize_approx,
        acodec: f.acodec,
      });
    }
  }

  return {
    id: info.id,
    title: info.title,
    description: info.description,
    thumbnail: info.thumbnail,
    duration: info.duration,
    uploader: info.uploader,
    uploadDate: info.upload_date,
    viewCount: info.view_count,
    likeCount: info.like_count,
    platform: info.extractor || platform,
    formats: formats.sort((a, b) => {
      const resA = parseInt(a.resolution?.split("x")[1] || "0");
      const resB = parseInt(b.resolution?.split("x")[1] || "0");
      return resB - resA;
    }),
    audioFormats,
  };
}

// Download video
async function downloadVideo(data: {
  url: string;
  quality?: string;
  format?: string;
  audioOnly?: boolean;
  subtitles?: boolean;
  subtitleLang?: string;
}) {
  const available = await checkYtDlp();
  if (!available) {
    throw new Error("yt-dlp is not installed");
  }

  const {
    url,
    quality = "best",
    format = "mp4",
    audioOnly = false,
    subtitles = false,
    subtitleLang = "en",
  } = data;

  const tempDir = path.join(os.tmpdir(), `tails-video-${crypto.randomBytes(8).toString("hex")}`);
  await fs.mkdir(tempDir, { recursive: true });

  try {
    const outputTemplate = path.join(tempDir, "%(title)s.%(ext)s");
    const args: string[] = [
      "-o", outputTemplate,
      "--no-warnings",
      "--no-playlist",
    ];

    if (audioOnly || format === "mp3" || format === "m4a" || format === "wav") {
      args.push("-x");
      args.push("--audio-format", format === "wav" ? "wav" : format === "m4a" ? "m4a" : "mp3");
      args.push("--audio-quality", "0");
    } else {
      let formatSpec = "";

      switch (quality) {
        case "best":
          formatSpec = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";
          break;
        case "worst":
          formatSpec = "worstvideo+worstaudio/worst";
          break;
        case "1080p":
          formatSpec = "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best";
          break;
        case "720p":
          formatSpec = "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best";
          break;
        case "480p":
          formatSpec = "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best";
          break;
        case "360p":
          formatSpec = "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best";
          break;
        default:
          formatSpec = "best";
      }

      args.push("-f", formatSpec);

      if (format === "mp4") {
        args.push("--merge-output-format", "mp4");
      }
    }

    if (subtitles) {
      args.push("--write-subs");
      args.push("--sub-lang", subtitleLang);
    }

    args.push(url);

    await execYtDlp(args);

    const files = await fs.readdir(tempDir);
    const videoFile = files.find(f => !f.endsWith(".json") && !f.endsWith(".vtt") && !f.endsWith(".srt"));

    if (!videoFile) {
      throw new Error("Download failed - no output file");
    }

    const filePath = path.join(tempDir, videoFile);
    const buffer = await fs.readFile(filePath);
    const stats = await fs.stat(filePath);

    return {
      filename: videoFile,
      filesize: stats.size,
      format: path.extname(videoFile).slice(1),
      buffer,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Check URL support
function isUrlSupported(data: { url: string }): boolean {
  try {
    const parsedUrl = new URL(data.url);
    return SUPPORTED_PLATFORMS.some(p => parsedUrl.hostname.includes(p));
  } catch {
    return false;
  }
}

// Get supported qualities
async function getSupportedQualities(data: { url: string }): Promise<string[]> {
  const info = await getVideoInfo(data);
  const qualities = new Set<string>();

  for (const format of info.formats) {
    if (format.resolution) {
      const height = parseInt(format.resolution.split("x")[1] || "0");
      if (height >= 1080) qualities.add("1080p");
      if (height >= 720) qualities.add("720p");
      if (height >= 480) qualities.add("480p");
      if (height >= 360) qualities.add("360p");
    }
  }

  return Array.from(qualities).sort((a, b) => parseInt(b) - parseInt(a));
}

// Task handler
async function handleTask(message: TaskMessage): Promise<TaskResult> {
  try {
    let result: any;

    switch (message.type) {
      case "info":
        result = await getVideoInfo(message.data);
        break;
      case "download":
        result = await downloadVideo(message.data);
        break;
      case "isSupported":
        result = isUrlSupported(message.data);
        break;
      case "qualities":
        result = await getSupportedQualities(message.data);
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

console.log(`[Video Worker ${workerData?.workerId}] Ready`);

