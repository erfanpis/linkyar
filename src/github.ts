import { config } from "./config.js";

type ContentPutResponse = {
  content: {
    name: string;
    path: string;
    sha: string;
    download_url: string | null;
    html_url: string;
  };
};

type ContentGetResponse = {
  name: string;
  path: string;
  sha: string;
  type?: "file" | "dir";
  content?: string;
  encoding?: string;
  download_url?: string | null;
};

export type UploadMeta = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  expiresAt: string;
  filePath: string;
  telegramUserId?: number;
};

function repoApi(path: string): string {
  const { owner, repo } = config.github;
  if (!owner || !repo) {
    throw new Error("GITHUB_OWNER / GITHUB_REPO (یا GITHUB_REPOSITORY) تنظیم نشده.");
  }
  return `https://api.github.com/repos/${owner}/${repo}${path}`;
}

function encodeRepoPath(pathInRepo: string): string {
  return pathInRepo
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

async function gh<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = config.github.token;
  if (!token) {
    throw new Error("GITHUB_TOKEN تنظیم نشده.");
  }

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(repoApi(path), { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function isGithubConfigured(): boolean {
  return Boolean(
    config.github.token && config.github.owner && config.github.repo,
  );
}

export function publicDownloadUrl(pathInRepo: string): string {
  const { owner, repo, branch } = config.github;
  const clean = pathInRepo.replace(/^\/+/, "");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodeRepoPath(clean)}`;
}

export function expiryIso(from = new Date()): string {
  return new Date(
    from.getTime() + config.fileTtlHours * 60 * 60 * 1000,
  ).toISOString();
}

export async function uploadToGithub(opts: {
  buffer: Buffer;
  originalName: string;
  id: string;
  mimeType: string;
  telegramUserId?: number;
}): Promise<{ path: string; url: string; htmlUrl: string; meta: UploadMeta }> {
  const safeName =
    opts.originalName
      .replace(/[^\w.\-()\u0600-\u06FF ]+/g, "_")
      .slice(0, 160) || "file.bin";
  const pathInRepo = `${config.github.uploadDir}/${opts.id}/${safeName}`;
  const createdAt = new Date().toISOString();
  const expiresAt = expiryIso(new Date(createdAt));

  const result = await gh<ContentPutResponse>(
    `/contents/${encodeRepoPath(pathInRepo)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `upload: ${safeName} (${opts.id}) expires ${expiresAt}`,
        content: opts.buffer.toString("base64"),
        branch: config.github.branch,
      }),
    },
  );

  const meta: UploadMeta = {
    id: opts.id,
    originalName: opts.originalName,
    mimeType: opts.mimeType,
    size: opts.buffer.byteLength,
    createdAt,
    expiresAt,
    filePath: result.content.path,
    telegramUserId: opts.telegramUserId,
  };

  await writeGithubJson(
    `${config.github.uploadDir}/${opts.id}/meta.json`,
    meta,
    `meta: ${opts.id} expires ${expiresAt}`,
  );

  const url =
    result.content.download_url || publicDownloadUrl(result.content.path);

  return {
    path: result.content.path,
    url,
    htmlUrl: result.content.html_url,
    meta,
  };
}

export async function readGithubJson<T>(pathInRepo: string): Promise<T | null> {
  try {
    const data = await gh<ContentGetResponse>(
      `/contents/${encodeRepoPath(pathInRepo)}?ref=${encodeURIComponent(config.github.branch)}`,
    );
    if (!data.content) return null;
    const raw = Buffer.from(data.content, "base64").toString("utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("404")) return null;
    throw err;
  }
}

export async function writeGithubJson(
  pathInRepo: string,
  value: unknown,
  message: string,
): Promise<void> {
  let sha: string | undefined;
  try {
    const existing = await gh<ContentGetResponse>(
      `/contents/${encodeRepoPath(pathInRepo)}?ref=${encodeURIComponent(config.github.branch)}`,
    );
    sha = existing.sha;
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "";
    if (!messageText.includes("404")) throw err;
  }

  const body: Record<string, string> = {
    message,
    content: Buffer.from(JSON.stringify(value, null, 2), "utf8").toString(
      "base64",
    ),
    branch: config.github.branch,
  };
  if (sha) body.sha = sha;

  await gh(`/contents/${encodeRepoPath(pathInRepo)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

async function deleteGithubFile(pathInRepo: string, sha: string, message: string) {
  await gh(`/contents/${encodeRepoPath(pathInRepo)}`, {
    method: "DELETE",
    body: JSON.stringify({
      message,
      sha,
      branch: config.github.branch,
    }),
  });
}

async function listDir(pathInRepo: string): Promise<ContentGetResponse[]> {
  try {
    const data = await gh<ContentGetResponse[] | ContentGetResponse>(
      `/contents/${encodeRepoPath(pathInRepo)}?ref=${encodeURIComponent(config.github.branch)}`,
    );
    return Array.isArray(data) ? data : [];
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("404")) return [];
    throw err;
  }
}

/** فایل‌های منقضی‌شده (بیش از FILE_TTL_HOURS) را از ریپو پاک می‌کند. */
export async function cleanupExpiredUploads(): Promise<{
  deleted: string[];
  kept: number;
}> {
  if (!isGithubConfigured()) return { deleted: [], kept: 0 };

  const entries = await listDir(config.github.uploadDir);
  const dirs = entries.filter((e) => e.type === "dir");
  const deleted: string[] = [];
  let kept = 0;
  const now = Date.now();

  for (const dir of dirs) {
    const id = dir.name;
    const files = await listDir(`${config.github.uploadDir}/${id}`);
    if (files.length === 0) continue;

    let meta = await readGithubJson<UploadMeta>(
      `${config.github.uploadDir}/${id}/meta.json`,
    );

    // فایل قدیمی بدون meta: از همین الان ۱۲ ساعت مهلت بده
    if (!meta) {
      const file = files.find((f) => f.name !== "meta.json" && f.type !== "dir");
      if (!file) continue;
      meta = {
        id,
        originalName: file.name,
        mimeType: "application/octet-stream",
        size: 0,
        createdAt: new Date().toISOString(),
        expiresAt: expiryIso(),
        filePath: file.path,
      };
      try {
        await writeGithubJson(
          `${config.github.uploadDir}/${id}/meta.json`,
          meta,
          `meta: backfill ${id}`,
        );
      } catch (err) {
        console.error(`[cleanup] meta backfill failed for ${id}`, err);
      }
      kept += 1;
      continue;
    }

    const expiresAtMs = Date.parse(meta.expiresAt);
    if (!Number.isNaN(expiresAtMs) && expiresAtMs > now) {
      kept += 1;
      continue;
    }

    console.log(`[cleanup] deleting expired upload ${id}`);
    for (const file of files) {
      if (file.type === "dir") continue;
      try {
        await deleteGithubFile(
          file.path,
          file.sha,
          `expire: delete ${file.path}`,
        );
      } catch (err) {
        console.error(`[cleanup] failed to delete ${file.path}`, err);
      }
    }
    deleted.push(id);
  }

  return { deleted, kept };
}
