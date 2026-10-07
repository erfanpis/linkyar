import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { config } from "./config.js";
import { isGithubConfigured } from "./github.js";
import { chooseBackend, formatBytes, storeUpload } from "./store.js";
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
  const status = opts.botReady
    ? "ربات تلگرام آماده است"
    : "توکن تلگرام نیست — برای Actions فقط Secret بگذار";
  const statusClass = opts.botReady ? "ok" : "warn";
  const storageLabel = opts.githubReady
    ? `فضا: GitHub (${config.github.owner}/${config.github.repo})`
    : opts.backend === "local"
      ? "فضا: لوکال (برای GitHub توکن/ریپو بگذار)"
      : `فضا: ${opts.backend}`;

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>لینک‌یار | فایل به لینک دانلود</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg0: #0f1f1c;
      --bg1: #1a3a32;
      --ink: #f3f7f5;
      --muted: #a8c0b8;
      --accent: #3ecf8e;
      --accent-ink: #062416;
      --warn: #f0c674;
      --card: rgba(255,255,255,0.06);
      --line: rgba(255,255,255,0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Vazirmatn", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 600px at 10% -10%, #2d6a5a 0%, transparent 55%),
        radial-gradient(900px 500px at 100% 0%, #1e4d6b 0%, transparent 50%),
        linear-gradient(160deg, var(--bg0), var(--bg1));
    }
    .wrap {
      width: min(720px, calc(100% - 2rem));
      margin: 0 auto;
      padding: 3.5rem 0 4rem;
    }
    .brand {
      font-size: clamp(2.4rem, 7vw, 3.6rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      margin: 0 0 0.4rem;
      line-height: 1.1;
    }
    .lead {
      margin: 0 0 1.5rem;
      color: var(--muted);
      font-size: 1.05rem;
      line-height: 1.7;
      max-width: 34ch;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 0.85rem;
      border: 1px solid var(--line);
      background: var(--card);
      border-radius: 999px;
      font-size: 0.9rem;
      margin-bottom: 2rem;
    }
    .status .dot {
      width: 0.55rem; height: 0.55rem; border-radius: 50%;
      background: var(--warn);
    }
    .status.ok .dot { background: var(--accent); box-shadow: 0 0 0 4px rgba(62,207,142,0.18); }
    section {
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--line);
    }
    h2 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 700;
    }
    p { color: var(--muted); line-height: 1.75; margin: 0 0 1rem; }
    ol { color: var(--muted); line-height: 1.9; padding-right: 1.2rem; }
    .drop {
      margin-top: 1rem;
      border: 1px dashed var(--line);
      background: var(--card);
      border-radius: 16px;
      padding: 1.25rem;
    }
    .drop label {
      display: block;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }
    input[type="file"] {
      width: 100%;
      color: var(--ink);
    }
    button {
      margin-top: 0.9rem;
      border: 0;
      background: var(--accent);
      color: var(--accent-ink);
      font: inherit;
      font-weight: 700;
      padding: 0.7rem 1.2rem;
      border-radius: 12px;
      cursor: pointer;
    }
    button:disabled { opacity: 0.55; cursor: wait; }
    #result {
      margin-top: 1rem;
      min-height: 1.5rem;
      word-break: break-all;
      white-space: pre-wrap;
    }
    #result a { color: var(--accent); }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem 1.25rem;
      color: var(--muted);
      font-size: 0.92rem;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background: rgba(0,0,0,0.25);
      padding: 0.1rem 0.35rem;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <main class="wrap">
    <h1 class="brand">لینک‌یار</h1>
    <p class="lead">فایل را در تلگرام بفرست؛ روی فضای رایگان GitHub ذخیره می‌شود و لینک دانلود می‌گیری — بدون VPS.</p>
    <div class="status ${statusClass}"><span class="dot"></span>${status}</div>
    <div class="meta">
      <span>${storageLabel}</span>
      <span>فایل لوکال: ${opts.stats.count}</span>
      <span>حداکثر: ${formatBytes(config.maxFileBytes)}</span>
    </div>

    <section>
      <h2>بدون سرور (GitHub Actions)</h2>
      <ol>
        <li>این پروژه را روی یک ریپوی <strong>Public</strong> گیت‌هاب بگذار.</li>
        <li>توکن <code>@BotFather</code> را در Secrets با نام <code>TELEGRAM_BOT_TOKEN</code> ذخیره کن.</li>
        <li>Workflow هر دقیقه تلگرام را چک می‌کند، فایل را در <code>uploads/</code> می‌گذارد و لینک <code>raw.githubusercontent.com</code> می‌فرستد.</li>
      </ol>
    </section>

    <section>
      <h2>آپلود آزمایشی از وب</h2>
      <p>اگر GitHub تنظیم باشد همین‌جا هم روی ریپو آپلود می‌شود.</p>
      <div class="drop">
        <label for="file">انتخاب فایل</label>
        <input id="file" type="file" />
        <button id="upload" type="button">ساخت لینک دانلود</button>
        <div id="result"></div>
      </div>
    </section>
  </main>
  <script>
    const btn = document.getElementById("upload");
    const input = document.getElementById("file");
    const result = document.getElementById("result");
    btn.addEventListener("click", async () => {
      const file = input.files?.[0];
      if (!file) {
        result.textContent = "اول یک فایل انتخاب کن.";
        return;
      }
      btn.disabled = true;
      result.textContent = "در حال آپلود…";
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "آپلود ناموفق");
        result.innerHTML = "✅ لینک آماده شد:\\n<a href=\\"" + data.url + "\\" target=\\"_blank\\" rel=\\"noopener\\">" + data.url + "</a>";
      } catch (e) {
        result.textContent = "❌ " + (e?.message || e);
      } finally {
        btn.disabled = false;
      }
    });
  </script>
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
      publicBaseUrl: config.publicBaseUrl,
      githubReady: isGithubConfigured(),
      storageBackend: (() => {
        try {
          return chooseBackend();
        } catch {
          return "local";
        }
      })(),
      githubRepo:
        config.github.owner && config.github.repo
          ? `${config.github.owner}/${config.github.repo}`
          : null,
    }),
  );

  app.get("/api/files", async (c) => {
    const files = await listRecent(50);
    return c.json({
      files: files.map((f) => ({ ...f, url: downloadUrl(f.id) })),
    });
  });

  app.post("/api/upload", async (c) => {
    try {
      const form = await c.req.parseBody();
      const file = form.file;
      if (!file || typeof file === "string" || Array.isArray(file)) {
        return c.json({ error: "فایل ارسال نشده است." }, 400);
      }
      const uploaded = file as File;
      const ab = await uploaded.arrayBuffer();
      const buffer = Buffer.from(ab);
      const stored = await storeUpload({
        buffer,
        originalName: uploaded.name || "upload.bin",
        mimeType: uploaded.type || "application/octet-stream",
      });
      return c.json({
        id: stored.id,
        name: stored.originalName,
        size: stored.size,
        url: stored.url,
        backend: stored.backend,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "خطا";
      return c.json({ error: message }, 400);
    }
  });

  app.delete("/api/files/:id", async (c) => {
    const ok = await deleteStoredFile(c.req.param("id"));
    if (!ok) return c.json({ error: "پیدا نشد" }, 404);
    return c.json({ ok: true });
  });

  app.get("/d/:id", async (c) => {
    const found = await getStoredFile(c.req.param("id"));
    if (!found) return c.text("فایل پیدا نشد.", 404);

    let size = found.meta.size;
    try {
      size = (await stat(found.absolutePath)).size;
    } catch {
      return c.text("فایل روی دیسک نیست.", 404);
    }

    const encoded = encodeURIComponent(found.meta.originalName).replace(/['()]/g, escape);
    c.header("Content-Type", found.meta.mimeType || "application/octet-stream");
    c.header("Content-Length", String(size));
    c.header(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encoded}`,
    );
    c.header("Cache-Control", "public, max-age=31536000, immutable");

    return stream(c, async (s) => {
      const rs = createReadStream(found.absolutePath);
      for await (const chunk of rs) {
        await s.write(chunk as Uint8Array);
      }
    });
  });

  return app;
}
