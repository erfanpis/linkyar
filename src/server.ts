import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { config } from "./config.js";
import { isGithubConfigured } from "./github.js";
import { chooseBackend, formatBytes } from "./store.js";
import {
  deleteStoredFile,
  downloadUrl,
  getStoredFile,
  listRecent,
  storageStats,
} from "./storage.js";

function landingHtml(opts: {
  botReady: boolean;
  stats: { count: number; bytes: number };
  backend: string;
  githubReady: boolean;
}): string {
  const status = opts.botReady ? "سرویس فعال است" : "توکن ربات تنظیم نشده";
  const statusClass = opts.botReady ? "ok" : "warn";
  const storageLabel = opts.githubReady
    ? `ذخیره: GitHub (${config.github.owner}/${config.github.repo})`
    : `ذخیره: ${opts.backend}`;

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>لینک‌یار</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg0: #101820; --bg1: #1c2b33; --ink: #f4f7f5; --muted: #9db0a8;
      --accent: #3ecf8e; --accent-ink: #062416; --warn: #f0c674;
      --card: rgba(255,255,255,0.06); --line: rgba(255,255,255,0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; font-family: "Vazirmatn", sans-serif; color: var(--ink);
      background:
        radial-gradient(1000px 500px at 15% -10%, #2a4a40 0%, transparent 55%),
        linear-gradient(160deg, var(--bg0), var(--bg1));
    }
    .wrap { width: min(680px, calc(100% - 2rem)); margin: 0 auto; padding: 3.5rem 0 4rem; }
    .brand { font-size: clamp(2.2rem, 6vw, 3.2rem); font-weight: 800; margin: 0 0 0.5rem; }
    .lead { color: var(--muted); line-height: 1.7; max-width: 36ch; }
    .status {
      display: inline-flex; gap: 0.5rem; align-items: center; margin: 1.25rem 0;
      padding: 0.45rem 0.85rem; border: 1px solid var(--line); border-radius: 999px; background: var(--card);
    }
    .status .dot { width: 0.55rem; height: 0.55rem; border-radius: 50%; background: var(--warn); }
    .status.ok .dot { background: var(--accent); }
    .meta { color: var(--muted); display: flex; flex-wrap: wrap; gap: 1rem; }
    section { margin-top: 2rem; padding-top: 1.4rem; border-top: 1px solid var(--line); }
    h2 { margin: 0 0 0.5rem; font-size: 1.2rem; }
    p { color: var(--muted); line-height: 1.75; }
  </style>
</head>
<body>
  <main class="wrap">
    <h1 class="brand">لینک‌یار</h1>
    <p class="lead">سرویس خصوصی ساخت لینک دانلود. دسترسی فقط با تأیید مدیر.</p>
    <div class="status ${statusClass}"><span class="dot"></span>${status}</div>
    <div class="meta">
      <span>${storageLabel}</span>
      <span>انقضا: ${config.fileTtlHours} ساعت</span>
      <span>سقف: ${formatBytes(config.maxFileBytes)}</span>
    </div>
    <section>
      <h2>استفاده</h2>
      <p>از طریق ربات تلگرام. وب‌آپلود عمومی غیرفعال است.</p>
    </section>
  </main>
</body>
</html>`;
}

export function createApp(opts: { botReady: boolean }) {
  const app = new Hono();

  app.get("/", async (c) => {
    const stats = await storageStats();
    let backend = "local";
    try {
      backend = chooseBackend();
    } catch {
      backend = "local";
    }
    return c.html(
      landingHtml({
        botReady: opts.botReady,
        stats,
        backend,
        githubReady: isGithubConfigured(),
      }),
    );
  });

  app.get("/health", (c) =>
    c.json({
      ok: true,
      botReady: opts.botReady,
      ttlHours: config.fileTtlHours,
    }),
  );

  // آپلود وب عمومی بسته است — فقط ربات
  app.post("/api/upload", (c) =>
    c.json({ error: "آپلود فقط از طریق ربات تلگرام فعال است." }, 403),
  );

  app.get("/api/files", async (c) => {
    if (!config.adminUserIds.length) return c.json({ error: "forbidden" }, 403);
    const files = await listRecent(50);
    return c.json({
      files: files.map((f) => ({ ...f, url: downloadUrl(f.id) })),
    });
  });

  app.delete("/api/files/:id", async (c) => {
    const ok = await deleteStoredFile(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });

  app.get("/d/:id", async (c) => {
    const found = await getStoredFile(c.req.param("id"));
    if (!found) return c.text("یافت نشد.", 404);
    let size = found.meta.size;
    try {
      size = (await stat(found.absolutePath)).size;
    } catch {
      return c.text("یافت نشد.", 404);
    }
    const encoded = encodeURIComponent(found.meta.originalName).replace(
      /['()]/g,
      escape,
    );
    c.header("Content-Type", found.meta.mimeType || "application/octet-stream");
    c.header("Content-Length", String(size));
    c.header("Content-Disposition", `attachment; filename*=UTF-8''${encoded}`);
    return stream(c, async (s) => {
      const rs = createReadStream(found.absolutePath);
      for await (const chunk of rs) {
        await s.write(chunk as Uint8Array);
      }
    });
  });

  return app;
}
