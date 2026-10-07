import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

function requiredInProd(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseGithubRepo(): { owner: string; repo: string } {
  const explicitOwner = process.env.GITHUB_OWNER?.trim() || "";
  const explicitRepo = process.env.GITHUB_REPO?.trim() || "";
  if (explicitOwner && explicitRepo) {
    return { owner: explicitOwner, repo: explicitRepo };
  }

  const combined =
    process.env.GITHUB_REPOSITORY?.trim() ||
    process.env.GITHUB_REPO?.trim() ||
    "";
  if (combined.includes("/")) {
    const [owner, repo] = combined.split("/");
    if (owner && repo) return { owner, repo };
  }
  return { owner: explicitOwner, repo: explicitRepo };
}

function parseIdList(raw: string | undefined): number[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

const githubIds = parseGithubRepo();

export type StorageBackend = "github" | "local" | "auto";

const backendEnv = (process.env.STORAGE_BACKEND || "auto").toLowerCase();
const storageBackend = (
  backendEnv === "github" || backendEnv === "local" || backendEnv === "auto"
    ? backendEnv
    : "auto"
) as StorageBackend;

// مالک پیش‌فرض: @erfanitt
const defaultAdminIds = [6325075744];

export const config = {
  port: Number(process.env.PORT || 38471),
  publicBaseUrl: (
    process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 38471}`
  ).replace(/\/$/, ""),
  telegramToken: requiredInProd("TELEGRAM_BOT_TOKEN"),
  telegramApiId: Number(process.env.TELEGRAM_API_ID || 0),
  telegramApiHash: process.env.TELEGRAM_API_HASH?.trim() || "",
  telegramSession: process.env.TELEGRAM_SESSION?.trim() || "",
  adminUserIds: Array.from(
    new Set([...defaultAdminIds, ...parseIdList(process.env.ADMIN_USER_IDS)]),
  ),
  adminUsername: (process.env.ADMIN_USERNAME || "erfanitt").replace(/^@/, ""),
  allowedUserIds: parseIdList(process.env.ALLOWED_USER_IDS),
  maxFileBytes: Number(process.env.MAX_FILE_BYTES || 2 * 1024 * 1024 * 1024),
  telegramHttpMaxBytes: Number(
    process.env.TELEGRAM_HTTP_MAX_BYTES || 20 * 1024 * 1024,
  ),
  githubContentsMaxBytes: Number(
    process.env.GITHUB_CONTENTS_MAX_BYTES || 5 * 1024 * 1024,
  ),
  fileTtlHours: Number(process.env.FILE_TTL_HOURS || 6),
  storageDir: path.join(rootDir, "storage"),
  tmpDir: path.join(rootDir, "tmp"),
  storageBackend,
  github: {
    token:
      process.env.GITHUB_TOKEN?.trim() ||
      process.env.GH_TOKEN?.trim() ||
      "",
    owner: githubIds.owner,
    repo: githubIds.repo,
    branch: process.env.GITHUB_BRANCH?.trim() || "main",
    uploadDir: (process.env.GITHUB_UPLOAD_DIR || "uploads").replace(
      /^\/+|\/+$/g,
      "",
    ),
    offsetPath: process.env.GITHUB_OFFSET_PATH || "state/telegram-offset.json",
    accessPath: process.env.GITHUB_ACCESS_PATH || "state/access.json",
    pendingPath: process.env.GITHUB_PENDING_PATH || "state/pending-files.json",
  },
};
