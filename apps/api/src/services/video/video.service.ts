import { createLogger } from "@tails/logger";
import { getVideoPool } from "../../workers";

const log = createLogger("video-service");

// Supported platforms
export const SUPPORTED_PLATFORMS = [
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
] as const;

export interface VideoInfo {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  uploadDate?: string;
  viewCount?: number;
  likeCount?: number;
  platform: string;
  formats: VideoFormat[];
  audioFormats: AudioFormat[];
}

export interface VideoFormat {
  formatId: string;
  ext: string;
  quality: string;
  resolution?: string;
  fps?: number;
  filesize?: number;
  vcodec?: string;
  acodec?: string;
  hasAudio: boolean;
  hasVideo: boolean;
}

export interface AudioFormat {
  formatId: string;
  ext: string;
  quality: string;
  bitrate?: number;
  filesize?: number;
  acodec?: string;
}

export interface DownloadOptions {
  quality?: "best" | "worst" | "1080p" | "720p" | "480p" | "360p" | "audio";
  format?: "mp4" | "webm" | "mp3" | "m4a" | "wav";
  audioOnly?: boolean;
  subtitles?: boolean;
  subtitleLang?: string;
}

export interface DownloadResult {
  filename: string;
  filesize: number;
  format: string;
  duration?: number;
  buffer: Buffer;
}

/**
 * Get video information using worker
 */
export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const pool = getVideoPool();
  return pool.execute<{ url: string }, VideoInfo>("info", { url });
}

/**
 * Download video/audio using worker
 */
export async function downloadVideo(
  url: string,
  options: DownloadOptions = {}
): Promise<DownloadResult> {
  const pool = getVideoPool();
  return pool.execute<{ url: string } & DownloadOptions, DownloadResult>("download", {
    url,
    ...options,
  });
}

/**
 * Get supported qualities for a video using worker
 */
export async function getSupportedQualities(url: string): Promise<string[]> {
  const pool = getVideoPool();
  return pool.execute<{ url: string }, string[]>("qualities", { url });
}

/**
 * Check if URL is supported
 */
export function isUrlSupported(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return SUPPORTED_PLATFORMS.some(p => parsedUrl.hostname.includes(p));
  } catch {
    return false;
  }
}

/**
 * Get platform from URL
 */
export function getPlatformFromUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    return SUPPORTED_PLATFORMS.find(p => parsedUrl.hostname.includes(p)) || null;
  } catch {
    return null;
  }
}

/**
 * Get worker pool statistics
 */
export function getPoolStats() {
  const pool = getVideoPool();
  return pool.getStats();
}
