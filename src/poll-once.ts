/**
 * یک دور getUpdates — مناسب GitHub Actions (بدون سرور دائمی).
 */
import { config } from "./config.js";
import { createBot } from "./bot.js";
import {
  isGithubConfigured,
  readGithubJson,
  writeGithubJson,
} from "./github.js";
import { chooseBackend } from "./store.js";

type OffsetState = { offset: number };

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

async function main() {
  if (!config.telegramToken) {
    throw new Error("TELEGRAM_BOT_TOKEN لازم است.");
  }

  const backend = chooseBackend();
  console.log(`[poll] storage backend: ${backend}`);
  if (backend === "github" && !isGithubConfigured()) {
    throw new Error("برای حالت GitHub باید GITHUB_TOKEN و ریپو تنظیم باشد.");
  }

  const bot = createBot();
  if (!bot) throw new Error("ربات ساخته نشد.");

  const offset = await loadOffset();
  console.log(`[poll] getUpdates offset=${offset}`);

  const updates = await bot.api.getUpdates({
    offset,
    timeout: 0,
    allowed_updates: ["message"],
  });

  if (updates.length === 0) {
    console.log("[poll] آپدیت جدیدی نبود.");
    return;
  }

  let nextOffset = offset;
  for (const update of updates) {
    console.log(`[poll] handling update_id=${update.update_id}`);
    await bot.handleUpdate(update);
    nextOffset = update.update_id + 1;
  }

  await saveOffset(nextOffset);
  console.log(`[poll] done. saved offset=${nextOffset}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
