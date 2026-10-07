import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

function requiredInProd(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const config = {
  port: Number(process.env.PORT || 38471),
  publicBaseUrl: (
    process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 38471}`
  ).replace(/\/$/, ""),
  telegramToken: requiredInProd("TELEGRAM_BOT_TOKEN"),
  allowedUserIds: (process.env.ALLOWED_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n)),
  maxFileBytes: Number(process.env.MAX_FILE_BYTES || 20 * 1024 * 1024),
  storageDir: path.join(rootDir, "storage"),
};

export function isUserAllowed(userId: number | undefined): boolean {
  if (config.allowedUserIds.length === 0) return true;
  if (userId == null) return false;
  return config.allowedUserIds.includes(userId);
}
