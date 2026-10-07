import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Bot, Context } from "grammy";
import { config, isUserAllowed } from "./config.js";
import { downloadMessageToFile, isMtprotoConfigured } from "./mtproto.js";
import { formatBytes, storeUpload } from "./store.js";

function formatExpiryFa(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fa-IR", { hour12: false });
  } catch {
    return iso;
  }
}

type MediaInfo = {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
  messageId: number;
  chatId: number;
};

function pickMedia(ctx: Context): MediaInfo | null {
  const msg = ctx.message;
  if (!msg || !ctx.chat) return null;

  const base = { messageId: msg.message_id, chatId: ctx.chat.id };

  if (msg.document) {
    return {
      ...base,
      fileId: msg.document.file_id,
      fileName: msg.document.file_name || "document.bin",
      mimeType: msg.document.mime_type || "application/octet-stream",
      fileSize: msg.document.file_size,
    };
  }
  if (msg.video) {
    return {
      ...base,
      fileId: msg.video.file_id,
      fileName: msg.video.file_name || `video-${msg.video.file_unique_id}.mp4`,
      mimeType: msg.video.mime_type || "video/mp4",
      fileSize: msg.video.file_size,
    };
  }
  if (msg.audio) {
    return {
      ...base,
      fileId: msg.audio.file_id,
      fileName: msg.audio.file_name || `audio-${msg.audio.file_unique_id}.mp3`,
      mimeType: msg.audio.mime_type || "audio/mpeg",
      fileSize: msg.audio.file_size,
    };
  }
  if (msg.voice) {
    return {
      ...base,
      fileId: msg.voice.file_id,
      fileName: `voice-${msg.voice.file_unique_id}.ogg`,
      mimeType: msg.voice.mime_type || "audio/ogg",
      fileSize: msg.voice.file_size,
    };
  }
  if (msg.animation) {
    return {
      ...base,
      fileId: msg.animation.file_id,
      fileName:
        msg.animation.file_name ||
        `animation-${msg.animation.file_unique_id}.mp4`,
      mimeType: msg.animation.mime_type || "video/mp4",
      fileSize: msg.animation.file_size,
    };
  }
  if (msg.video_note) {
    return {
      ...base,
      fileId: msg.video_note.file_id,
      fileName: `videonote-${msg.video_note.file_unique_id}.mp4`,
      mimeType: "video/mp4",
      fileSize: msg.video_note.file_size,
    };
  }
  if (msg.photo?.length) {
    const photo = msg.photo[msg.photo.length - 1]!;
    return {
      ...base,
      fileId: photo.file_id,
      fileName: `photo-${photo.file_unique_id}.jpg`,
      mimeType: "image/jpeg",
      fileSize: photo.file_size,
    };
  }
  return null;
}

async function downloadViaHttpBotApi(
  bot: Bot,
  fileId: string,
): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("تلگرام مسیر فایل را برنگرداند.");
  }
  if (file.file_size && file.file_size > config.telegramHttpMaxBytes) {
    throw new Error(
      `این فایل بزرگ است. برای تا ۲ گیگ، TELEGRAM_API_ID و TELEGRAM_API_HASH را از my.telegram.org بفرست.`,
    );
  }
  const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`دانلود از تلگرام ناموفق بود (${res.status}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function ingestTelegramMedia(
  bot: Bot,
  media: MediaInfo,
  userId?: number,
) {
  if (media.fileSize && media.fileSize > config.maxFileBytes) {
    throw new Error(
      `حجم فایل بیشتر از حد مجاز است (${formatBytes(config.maxFileBytes)}).`,
    );
  }

  if (isMtprotoConfigured()) {
    await mkdir(config.tmpDir, { recursive: true });
    const dest = path.join(
      config.tmpDir,
      `${media.chatId}_${media.messageId}_${Date.now()}`,
    );
    try {
      const { size } = await downloadMessageToFile({
        chatId: media.chatId,
        messageId: media.messageId,
        destPath: dest,
      });
      return await storeUpload({
        filePath: dest,
        originalName: media.fileName,
        mimeType: media.mimeType,
        telegramUserId: userId,
        size,
      });
    } finally {
      await unlink(dest).catch(() => undefined);
    }
  }

  if (media.fileSize && media.fileSize > config.telegramHttpMaxBytes) {
    throw new Error(
      [
        `فایل ${formatBytes(media.fileSize)} است — اوکیه، تلگرام تا ۲ گیگ ساپورت می‌کنه.`,
        "فقط برای اینکه ربات بتونه این حجم رو بکشه باید api_id و api_hash بذاری.",
        "۱) برو https://my.telegram.org",
        "۲) API development tools",
        "۳) api_id و api_hash رو اینجا بفرست",
      ].join("\n"),
    );
  }

  const buffer = await downloadViaHttpBotApi(bot, media.fileId);
  return storeUpload({
    buffer,
    originalName: media.fileName,
    mimeType: media.mimeType,
    telegramUserId: userId,
  });
}

export function createBot(): Bot | null {
  if (!config.telegramToken) {
    console.warn(
      "[bot] TELEGRAM_BOT_TOKEN تنظیم نشده — ربات تلگرام خاموش است.",
    );
    return null;
  }

  const bot = new Bot(config.telegramToken);

  bot.command("start", async (ctx) => {
    const mt = isMtprotoConfigured();
    await ctx.reply(
      [
        "سلام 👋",
        "",
        "هر فایلی بفرست تا لینک دانلود بدم.",
        "",
        `⏱ انقضا: ${config.fileTtlHours} ساعت`,
        mt
          ? `📦 سقف: ${formatBytes(config.maxFileBytes)} ✅`
          : `📦 برای فایل‌های بزرگ (تا ۲ گیگ) api_id/api_hash لازم است`,
        "",
        "دستورها: /start /id /ping",
      ].join("\n"),
    );
  });

  bot.command("id", async (ctx) => {
    await ctx.reply(`یوزرآیدی تو: \`${ctx.from?.id ?? "?"}\``, {
      parse_mode: "Markdown",
    });
  });

  bot.command("ping", async (ctx) => {
    await ctx.reply(
      isMtprotoConfigured()
        ? "آنلاینم ✅ تا ۲ گیگ آماده‌ام."
        : "آنلاینم — برای ۲ گیگ هنوز api_id/api_hash نداریم.",
    );
  });

  bot.on(
    [
      "message:document",
      "message:photo",
      "message:video",
      "message:audio",
      "message:voice",
      "message:animation",
      "message:video_note",
    ],
    async (ctx) => {
      const userId = ctx.from?.id;
      if (!isUserAllowed(userId)) {
        await ctx.reply(
          "دسترسی نداری. ادمین باید یوزرآیدیت رو به ALLOWED_USER_IDS اضافه کنه.",
        );
        return;
      }

      const media = pickMedia(ctx);
      if (!media) {
        await ctx.reply("این نوع پیام پشتیبانی نمی‌شه. یک فایل بفرست.");
        return;
      }

      console.log(
        `[bot] file chat=${media.chatId} msg=${media.messageId} name=${media.fileName} size=${media.fileSize ?? "?"}`,
      );
      const status = await ctx.reply(
        media.fileSize && media.fileSize > 50 * 1024 * 1024
          ? `دارم فایل ${formatBytes(media.fileSize)} رو می‌گیرم… ممکنه چند دقیقه طول بکشه.`
          : "دارم فایل رو ذخیره می‌کنم…",
      );

      try {
        const stored = await ingestTelegramMedia(bot, media, userId);

        const text = [
          "✅ لینک دانلود آماده شد",
          "",
          `📄 ${stored.originalName}`,
          `📦 ${formatBytes(stored.size)}`,
          stored.expiresAt
            ? `⏱ انقضا: ${formatExpiryFa(stored.expiresAt)} (${config.fileTtlHours} ساعت)`
            : `⏱ انقضا: ${config.fileTtlHours} ساعت`,
          "",
          stored.url,
        ].join("\n");

        try {
          await ctx.api.editMessageText(ctx.chat.id, status.message_id, text);
        } catch {
          await ctx.reply(text);
        }
        console.log(`[bot] sent link ${stored.url}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "خطای ناشناخته";
        console.error("[bot] upload failed", err);
        try {
          await ctx.api.editMessageText(
            ctx.chat.id,
            status.message_id,
            `❌ نشد آپلود کنم:\n${message}`,
          );
        } catch {
          await ctx.reply(`❌ نشد آپلود کنم:\n${message}`);
        }
      }
    },
  );

  bot.on("message", async (ctx) => {
    if (ctx.message?.text?.startsWith("/")) return;
    await ctx.reply("یک فایل بفرست تا لینک دانلود بسازم. /start برای راهنما.");
  });

  bot.catch((err) => {
    console.error("[bot] error", err.error);
  });

  return bot;
}
