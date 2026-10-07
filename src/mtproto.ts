import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { config } from "./config.js";

let clientPromise: Promise<TelegramClient> | null = null;

export function isMtprotoConfigured(): boolean {
  return Boolean(
    config.telegramToken &&
      config.telegramApiId > 0 &&
      config.telegramApiHash,
  );
}

export async function getMtprotoClient(): Promise<TelegramClient> {
  if (!isMtprotoConfigured()) {
    throw new Error(
      "برای فایل‌های بزرگ باید TELEGRAM_API_ID و TELEGRAM_API_HASH تنظیم شود (از my.telegram.org).",
    );
  }
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = new TelegramClient(
        new StringSession(config.telegramSession || ""),
        config.telegramApiId,
        config.telegramApiHash,
        {
          connectionRetries: 5,
          requestRetries: 5,
          downloadRetries: 5,
        },
      );
      await client.start({ botAuthToken: config.telegramToken });
      console.log("[mtproto] connected as bot");
      return client;
    })();
  }
  return clientPromise;
}

export async function disconnectMtproto(): Promise<void> {
  if (!clientPromise) return;
  try {
    const client = await clientPromise;
    await client.disconnect();
  } catch {
    /* ignore */
  }
  clientPromise = null;
}

/** دانلود مدیا تا ۲ گیگ روی دیسک (نه داخل RAM). */
export async function downloadMessageToFile(opts: {
  chatId: number;
  messageId: number;
  destPath: string;
}): Promise<{ size: number }> {
  const client = await getMtprotoClient();
  await mkdir(path.dirname(opts.destPath), { recursive: true });

  const messages = await client.getMessages(opts.chatId, {
    ids: opts.messageId,
  });
  const message = messages[0];
  if (!message?.media) {
    throw new Error("پیام/فایل در تلگرام پیدا نشد (MTProto).");
  }

  const result = await client.downloadMedia(message, {
    outputFile: opts.destPath,
    progressCallback: (received, total) => {
      const r = Number(received);
      const t = Number(total);
      if (t > 0 && r > 0 && r % (64 * 1024 * 1024) < 1024 * 1024) {
        console.log(`[mtproto] download ${((r / t) * 100).toFixed(1)}%`);
      }
    },
  });

  if (!result) {
    throw new Error("دانلود MTProto چیزی برنگرداند.");
  }

  if (Buffer.isBuffer(result)) {
    await writeFile(opts.destPath, result);
  }

  const s = await stat(opts.destPath);
  return { size: s.size };
}
