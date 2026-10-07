/**
 * یک دور getUpdates — مناسب GitHub Actions (بدون سرور دائمی).
 * اگر POLL_LOOP_MS ست باشد، تا همان مدت هر چند ثانیه یک‌بار تکرار می‌کند.
 */
import { config } from "./config.js";
import { createBot } from "./bot.js";
import {
  cleanupExpiredUploads,
  isGithubConfigured,
  readGithubJson,
  writeGithubJson,
} from "./github.js";
import { disconnectMtproto } from "./mtproto.js";
import { chooseBackend } from "./store.js";

type OffsetState = { offset: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadOffset(): Promise<number> {
  if (isGithubConfigured()) {
    const state = await readGithubJson<OffsetState>(config.github.offsetPath);
    return state?.offset ?? 0;
  }
  return Number(process.env.TELEGRAM_OFFSET || 0);
}

async function saveOffset(offset: number): Promise<void> {
  if (!isGithubConfigured()) {
    console.log(`[poll] next offset=${offset} (GitHub state غیرفعال)`);
    return;
  }
  await writeGithubJson(
    config.github.offsetPath,
    { offset } satisfies OffsetState,
    `bot: telegram offset ${offset}`,
  );
}

async function drainOnce(
  bot: NonNullable<ReturnType<typeof createBot>>,
  offset: number,
): Promise<number> {
  const updates = await bot.api.getUpdates({
    offset,
    timeout: 0,
    allowed_updates: ["message"],
    limit: 50,
  });

  if (updates.length === 0) {
    return offset;
  }

  let nextOffset = offset;
  for (const update of updates) {
    console.log(`[poll] handling update_id=${update.update_id}`);
    try {
      await bot.handleUpdate(update);
    } catch (err) {
      console.error(`[poll] handleUpdate failed for ${update.update_id}`, err);
      // حتی اگر یک آپدیت خراب شد، offset را جلو ببر تا گیر نکند
    }
    nextOffset = update.update_id + 1;
  }

  await saveOffset(nextOffset);
  console.log(`[poll] saved offset=${nextOffset}`);
  return nextOffset;
}

async function main() {
  if (!config.telegramToken) {
    throw new Error("TELEGRAM_BOT_TOKEN لازم است.");
  }

  const backend = chooseBackend();
  console.log(`[poll] storage backend: ${backend}`);
  if (backend === "github" && !isGithubConfigured()) {
    throw new Error("برای حالت GitHub باید GITHUB_TOKEN و ریپو تنظیم باشد.");
  }

  if (backend === "github") {
    try {
      const cleaned = await cleanupExpiredUploads();
      console.log(
        `[cleanup] deleted=${cleaned.deleted.length} kept=${cleaned.kept}`,
      );
    } catch (err) {
      console.error("[cleanup] failed", err);
    }
  }

  const bot = createBot();
  if (!bot) throw new Error("ربات ساخته نشد.");
  await bot.init();
  console.log(`[poll] bot=@${bot.botInfo.username}`);

  let offset = await loadOffset();
  console.log(`[poll] start offset=${offset}`);

  const loopMs = Number(process.env.POLL_LOOP_MS || 0);
  const intervalMs = Number(process.env.POLL_INTERVAL_MS || 2500);
  const cleanupEveryMs = Number(process.env.CLEANUP_INTERVAL_MS || 60_000);
  const deadline = loopMs > 0 ? Date.now() + loopMs : Date.now();
  let lastCleanup = Date.now();

  offset = await drainOnce(bot, offset);

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    offset = await drainOnce(bot, offset);
    if (backend === "github" && Date.now() - lastCleanup >= cleanupEveryMs) {
      try {
        const cleaned = await cleanupExpiredUploads();
        if (cleaned.deleted.length) {
          console.log(`[cleanup] deleted=${cleaned.deleted.join(",")}`);
        }
      } catch (err) {
        console.error("[cleanup] failed", err);
      }
      lastCleanup = Date.now();
    }
  }

  await disconnectMtproto().catch(() => undefined);
  console.log("[poll] done.");
}

main().catch(async (err) => {
  console.error(err);
  await disconnectMtproto().catch(() => undefined);
  process.exit(1);
});
