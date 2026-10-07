/**
 * حالت ۲۴ساعته: long-polling فوری تلگرام + پاکسازی دوره‌ای فایل‌های منقضی.
 */
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { createBot } from "./bot.js";
import { cleanupExpiredUploads, isGithubConfigured } from "./github.js";
import { disconnectMtproto } from "./mtproto.js";
import { createApp } from "./server.js";
import { ensureStorage } from "./storage.js";

async function runCleanup() {
  if (!isGithubConfigured()) return;
  try {
    const result = await cleanupExpiredUploads();
    if (result.deleted.length) {
      console.log(`[cleanup] deleted=${result.deleted.join(",")}`);
    }
  } catch (err) {
    console.error("[cleanup] failed", err);
  }
}

async function main() {
  await ensureStorage();

  const bot = createBot();
  const app = createApp({ botReady: Boolean(bot) });

  serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
    console.log(`[http] listening on http://127.0.0.1:${info.port}`);
  });

  // پاکسازی هر ۱۰ دقیقه
  await runCleanup();
  const cleanupTimer = setInterval(() => {
    void runCleanup();
  }, 10 * 60 * 1000);

  if (!bot) {
    console.warn("[bot] no token — http only");
    return;
  }

  const shutdown = async (signal: string) => {
    console.log(`[bot] shutting down (${signal})`);
    clearInterval(cleanupTimer);
    try {
      bot.stop();
    } catch {
      /* ignore */
    }
    await disconnectMtproto().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  console.log("[bot] starting long-polling (instant replies)");
  await bot.start({
    onStart: (info) => {
      console.log(`[bot] @${info.username} online 24/7 mode`);
    },
    allowed_updates: ["message", "callback_query"],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
