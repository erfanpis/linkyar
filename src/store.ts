import { readFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import {
  isGithubConfigured,
  uploadFileToGithubRelease,
  uploadToGithub,
} from "./github.js";
import {
  downloadUrl as localDownloadUrl,
  formatBytes,
  saveBuffer,
  type StoredFile,
} from "./storage.js";

export type StoredResult = StoredFile & {
  url: string;
  backend: "github" | "local";
  githubPath?: string;
  expiresAt?: string;
};

function chooseBackend(): "github" | "local" {
  if (config.storageBackend === "github") {
    if (!isGithubConfigured()) {
      throw new Error(
        "STORAGE_BACKEND=github است ولی GITHUB_TOKEN / ریپو تنظیم نشده.",
      );
    }
    return "github";
  }
  if (config.storageBackend === "local") return "local";
  return isGithubConfigured() ? "github" : "local";
}

export async function storeUpload(opts: {
  buffer?: Buffer;
  filePath?: string;
  originalName: string;
  mimeType: string;
  telegramUserId?: number;
  size?: number;
}): Promise<StoredResult> {
  const size =
    opts.size ??
    opts.buffer?.byteLength ??
    (opts.filePath
      ? (await import("node:fs/promises")).stat(opts.filePath).then((s) => s.size)
      : 0);
  const resolvedSize = typeof size === "number" ? size : await size;

  if (resolvedSize > config.maxFileBytes) {
    throw new Error(
      `حجم فایل بیشتر از حد مجاز است (${formatBytes(config.maxFileBytes)}).`,
    );
  }

  const backend = chooseBackend();
  const id = nanoid(12);

  if (backend === "github") {
    // فایل بزرگ → Release استریم؛ کوچک → Contents
    if (opts.filePath && resolvedSize > config.githubContentsMaxBytes) {
      const uploaded = await uploadFileToGithubRelease({
        filePath: opts.filePath,
        originalName: opts.originalName,
        id,
        mimeType: opts.mimeType,
        telegramUserId: opts.telegramUserId,
      });
      return {
        id,
        originalName: opts.originalName,
        mimeType: opts.mimeType,
        size: resolvedSize,
        createdAt: uploaded.meta.createdAt,
        telegramUserId: opts.telegramUserId,
        url: uploaded.url,
        backend: "github",
        expiresAt: uploaded.meta.expiresAt,
      };
    }

    const buffer =
      opts.buffer ??
      (opts.filePath ? await readFile(opts.filePath) : null);
    if (!buffer) throw new Error("فایل خالی است.");

    const uploaded = await uploadToGithub({
      buffer,
      originalName: opts.originalName,
      id,
      mimeType: opts.mimeType,
      telegramUserId: opts.telegramUserId,
    });
    return {
      id,
      originalName: opts.originalName,
      mimeType: opts.mimeType,
      size: buffer.byteLength,
      createdAt: uploaded.meta.createdAt,
      telegramUserId: opts.telegramUserId,
      url: uploaded.url,
      backend: "github",
      githubPath: uploaded.path,
      expiresAt: uploaded.meta.expiresAt,
    };
  }

  const buffer =
    opts.buffer ?? (opts.filePath ? await readFile(opts.filePath) : null);
  if (!buffer) throw new Error("فایل خالی است.");
  const saved = await saveBuffer({
    buffer,
    originalName: opts.originalName,
    mimeType: opts.mimeType,
    telegramUserId: opts.telegramUserId,
  });
  return {
    ...saved,
    url: localDownloadUrl(saved.id),
    backend: "local",
  };
}

export { formatBytes, chooseBackend };
