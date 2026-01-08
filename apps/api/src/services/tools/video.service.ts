import { createLogger } from "@tails/logger";
import { getVideoPool } from "../../workers";

const log = createLogger("video-tools");

export interface VideoDownloadOptions {
  url: string;
  quality?: "best" | "1080p" | "720p" | "480p" | "360p";
  format?: "mp4" | "webm" | "mp3";
}

export interface VideoInfo {
  title: string;
  duration: number;
  thumbnail?: string;
  author?: string;
  platform: string;
  formats: Array<{
    quality: string;
    format: string;
    size?: number;
  }>;
}

/**
 * Get video information
 */
export async function getVideoInfo(url: string): Promise<VideoInfo> {
  if (!url || !isValidVideoURL(url)) {
    throw new Error("Valid video URL is required");
  }

  try {
    const pool = getVideoPool();
    const result = await pool.execute<any, VideoInfo>("getVideoInfo", { url });

    log.info("Video info retrieved", {
      url,
      title: result.title,
      platform: result.platform,
    });

    return {
      title: result.title,
      duration: result.duration,
      thumbnail: result.thumbnail,
      author: result.author,
      platform: result.platform,
      formats: result.formats,
    };
  } catch (error) {
    log.error("Failed to get video info", error as Error);
    throw new Error("Failed to get video information");
  }
}

/**
 * Download video
 */
export async function downloadVideo(options: VideoDownloadOptions): Promise<{
  buffer: Buffer;
  filename: string;
  size: number;
  format: string;
}> {
  const { url, quality = "best", format = "mp4" } = options;

  if (!url || !isValidVideoURL(url)) {
    throw new Error("Valid video URL is required");
  }

  try {
    const pool = getVideoPool();
    const result = await pool.execute<any, { buffer: Buffer; filename: string; format: string }>("downloadVideo", {
      url,
      quality,
      format,
    });

    log.info("Video downloaded", {
      url,
      quality,
      format,
      size: result.buffer.length,
    });

    return {
      buffer: result.buffer,
      filename: result.filename,
      size: result.buffer.length,
      format: result.format,
    };
  } catch (error) {
    log.error("Video download failed", error as Error);
    throw new Error("Failed to download video");
  }
}

/**
 * Validate video URL
 */
function isValidVideoURL(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();
    
    // List of supported platforms
    const supportedPlatforms = [
      "youtube.com",
      "youtu.be",
      "tiktok.com",
      "instagram.com",
      "twitter.com",
      "x.com",
      "reddit.com",
      "facebook.com",
      "vimeo.com",
      "dailymotion.com",
      "twitch.tv",
    ];
    
    return supportedPlatforms.some(platform => hostname.includes(platform));
  } catch {
    return false;
  }
}

/**
 * Get platform from URL
 */
export function getPlatformFromURL(urlString: string): string {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();
    
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) return "YouTube";
    if (hostname.includes("tiktok.com")) return "TikTok";
    if (hostname.includes("instagram.com")) return "Instagram";
    if (hostname.includes("twitter.com") || hostname.includes("x.com")) return "Twitter/X";
    if (hostname.includes("reddit.com")) return "Reddit";
    if (hostname.includes("facebook.com")) return "Facebook";
    if (hostname.includes("vimeo.com")) return "Vimeo";
    if (hostname.includes("dailymotion.com")) return "Dailymotion";
    if (hostname.includes("twitch.tv")) return "Twitch";
    
    return "Unknown";
  } catch {
    return "Unknown";
  }
}
