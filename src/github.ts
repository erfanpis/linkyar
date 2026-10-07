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
  sha: string;
  content?: string;
  encoding?: string;
};

function repoApi(path: string): string {
  const { owner, repo } = config.github;
  if (!owner || !repo) {
    throw new Error("GITHUB_OWNER / GITHUB_REPO (یا GITHUB_REPOSITORY) تنظیم نشده.");
  }
  return `https://api.github.com/repos/${owner}/${repo}${path}`;
}

async function gh<T>(
  path: string,
  init: RequestInit & { rawBody?: BodyInit } = {},
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
  // لینک خام عمومی (ریپو باید Public باشد)
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${clean
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export async function uploadToGithub(opts: {
  buffer: Buffer;
  originalName: string;
  id: string;
  mimeType: string;
}): Promise<{ path: string; url: string; htmlUrl: string }> {
  const safeName = opts.originalName
    .replace(/[^\w.\-()\u0600-\u06FF ]+/g, "_")
    .slice(0, 160) || "file.bin";
  const pathInRepo = `${config.github.uploadDir}/${opts.id}/${safeName}`;
  const message = `upload: ${safeName} (${opts.id})`;

  const body = {
    message,
    content: opts.buffer.toString("base64"),
    branch: config.github.branch,
  };

  const result = await gh<ContentPutResponse>(
    `/contents/${pathInRepo
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    { method: "PUT", body: JSON.stringify(body) },
  );

  const url =
    result.content.download_url || publicDownloadUrl(result.content.path);

  return {
    path: result.content.path,
    url,
    htmlUrl: result.content.html_url,
  };
}

export async function readGithubJson<T>(pathInRepo: string): Promise<T | null> {
  try {
    const data = await gh<ContentGetResponse>(
      `/contents/${pathInRepo
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(config.github.branch)}`,
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
      `/contents/${pathInRepo
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(config.github.branch)}`,
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

  await gh(
    `/contents/${pathInRepo
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    { method: "PUT", body: JSON.stringify(body) },
  );
}
