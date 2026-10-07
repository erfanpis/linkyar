import { mkdir, writeFile, readFile, unlink, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "./config.js";

export type StoredFile = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  telegramUserId?: number;
};

type MetaFile = StoredFile & { diskName: string };

function metaPath(id: string): string {
  return path.join(config.storageDir, `${id}.json`);
}

function dataPath(id: string, diskName: string): string {
  return path.join(config.storageDir, `${id}.${diskName}`);
}

function safeDiskName(originalName: string): string {
  const base = path.basename(originalName).replace(/[^\w.\-()\u0600-\u06FF ]+/g, "_");
  return base.slice(0, 180) || "file.bin";
}

export async function ensureStorage(): Promise<void> {
  await mkdir(config.storageDir, { recursive: true });
}

export async function saveBuffer(opts: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  telegramUserId?: number;
}): Promise<StoredFile> {
  await ensureStorage();

  if (opts.buffer.byteLength > config.maxFileBytes) {
    throw new Error(
      `حجم فایل بیشتر از حد مجاز است (${formatBytes(config.maxFileBytes)}).`,
    );
  }

  const id = nanoid(12);
  const diskName = safeDiskName(opts.originalName);
  const meta: MetaFile = {
    id,
    originalName: opts.originalName || diskName,
    mimeType: opts.mimeType || "application/octet-stream",
    size: opts.buffer.byteLength,
    createdAt: new Date().toISOString(),
    telegramUserId: opts.telegramUserId,
    diskName,
  };

  await writeFile(dataPath(id, diskName), opts.buffer);
  await writeFile(metaPath(id), JSON.stringify(meta, null, 2), "utf8");

  const { diskName: _, ...publicMeta } = meta;
  return publicMeta;
}

export async function getStoredFile(
  id: string,
): Promise<{ meta: StoredFile; absolutePath: string } | null> {
  try {
    const raw = await readFile(metaPath(id), "utf8");
    const meta = JSON.parse(raw) as MetaFile;
    return {
      meta: {
        id: meta.id,
        originalName: meta.originalName,
        mimeType: meta.mimeType,
        size: meta.size,
        createdAt: meta.createdAt,
        telegramUserId: meta.telegramUserId,
      },
      absolutePath: dataPath(meta.id, meta.diskName),
    };
  } catch {
    return null;
  }
}

export async function deleteStoredFile(id: string): Promise<boolean> {
  const found = await getStoredFile(id);
  if (!found) return false;
  const raw = await readFile(metaPath(id), "utf8");
  const meta = JSON.parse(raw) as MetaFile;
  await unlink(dataPath(meta.id, meta.diskName)).catch(() => undefined);
  await unlink(metaPath(id)).catch(() => undefined);
  return true;
}

export async function listRecent(limit = 20): Promise<StoredFile[]> {
  await ensureStorage();
  const names = await readdir(config.storageDir);
  const ids = names.filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/, ""));
  const items: StoredFile[] = [];
  for (const id of ids) {
    const found = await getStoredFile(id);
    if (found) items.push(found.meta);
  }
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items.slice(0, limit);
}

export async function storageStats(): Promise<{ count: number; bytes: number }> {
  await ensureStorage();
  const names = await readdir(config.storageDir);
  let count = 0;
  let bytes = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    count += 1;
    const found = await getStoredFile(name.replace(/\.json$/, ""));
    if (found) {
      try {
        const s = await stat(found.absolutePath);
        bytes += s.size;
      } catch {
        /* ignore */
      }
    }
  }
  return { count, bytes };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function downloadUrl(id: string): string {
  return `${config.publicBaseUrl}/d/${id}`;
}
