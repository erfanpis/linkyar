import { nanoid } from "nanoid";
import { config } from "./config.js";
import { isGithubConfigured, uploadToGithub } from "./github.js";
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
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  telegramUserId?: number;
}): Promise<StoredResult> {
  if (opts.buffer.byteLength > config.maxFileBytes) {
    throw new Error(
      `حجم فایل بیشتر از حد مجاز است (${formatBytes(config.maxFileBytes)}).`,
    );
  }

  const backend = chooseBackend();
  const id = nanoid(12);

  if (backend === "github") {
    const uploaded = await uploadToGithub({
      buffer: opts.buffer,
      originalName: opts.originalName,
      id,
      mimeType: opts.mimeType,
      telegramUserId: opts.telegramUserId,
    });
    return {
      id,
      originalName: opts.originalName,
      mimeType: opts.mimeType,
      size: opts.buffer.byteLength,
      createdAt: uploaded.meta.createdAt,
      telegramUserId: opts.telegramUserId,
      url: uploaded.url,
      backend: "github",
      githubPath: uploaded.path,
      expiresAt: uploaded.meta.expiresAt,
    };
  }

  const saved = await saveBuffer({
    ...opts,
  });
  // saveBuffer می‌سازد id خودش؛ برای یکنواختی همان را استفاده می‌کنیم
  return {
    ...saved,
    url: localDownloadUrl(saved.id),
    backend: "local",
  };
}

export { formatBytes, chooseBackend };
