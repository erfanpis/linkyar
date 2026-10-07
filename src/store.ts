import { mkdir, readFile, unlink, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
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

async function storeGithubRelease(opts: {
  filePath: string;
  originalName: string;
  mimeType: string;
  telegramUserId?: number;
  size: number;
  id: string;
}): Promise<StoredResult> {
  const uploaded = await uploadFileToGithubRelease({
    filePath: opts.filePath,
    originalName: opts.originalName,
    id: opts.id,
    mimeType: opts.mimeType,
    telegramUserId: opts.telegramUserId,
  });
  return {
    id: opts.id,
    originalName: opts.originalName,
    mimeType: opts.mimeType,
    size: opts.size,
    createdAt: uploaded.meta.createdAt,
    telegramUserId: opts.telegramUserId,
    url: uploaded.url,
    backend: "github",
    expiresAt: uploaded.meta.expiresAt,
  };
}

export async function storeUpload(opts: {
  buffer?: Buffer;
  filePath?: string;
  originalName: string;
  mimeType: string;
  telegramUserId?: number;
  size?: number;
}): Promise<StoredResult> {
  const resolvedSize =
    opts.size ??
    (opts.buffer
      ? opts.buffer.byteLength
      : opts.filePath
        ? (await stat(opts.filePath)).size
        : 0);

  if (resolvedSize > config.maxFileBytes) {
    throw new Error(
      `حجم فایل بیشتر از حد مجاز است (${formatBytes(config.maxFileBytes)}).`,
    );
  }

  const backend = chooseBackend();
  const id = nanoid(12);

  if (backend === "github") {
    // مسیر دیسک (MTProto) یا حجم بالای سقف کوچک → Release استریم
    if (opts.filePath) {
      return storeGithubRelease({
        filePath: opts.filePath,
        originalName: opts.originalName,
        mimeType: opts.mimeType,
        telegramUserId: opts.telegramUserId,
        size: resolvedSize,
        id,
      });
    }

    const buffer = opts.buffer;
    if (!buffer) throw new Error("فایل خالی است.");

    if (buffer.byteLength > config.githubContentsMaxBytes) {
      await mkdir(config.tmpDir, { recursive: true });
      const tmp = join(config.tmpDir, `buf-${id}`);
      await writeFile(tmp, buffer);
      try {
        return await storeGithubRelease({
          filePath: tmp,
          originalName: opts.originalName,
          mimeType: opts.mimeType,
          telegramUserId: opts.telegramUserId,
          size: buffer.byteLength,
          id,
        });
      } finally {
        await unlink(tmp).catch(() => undefined);
      }
    }

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
