import { Bot, Context } from "grammy";
import { config, isUserAllowed } from "./config.js";
import { formatBytes, storeUpload } from "./store.js";

function formatExpiryFa(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fa-IR", { hour12: false });
  } catch {
    return iso;
  }
}

type MediaKind =
  | "document"
  | "photo"
  | "video"
  | "audio"
  | "voice"
  | "animation"
  | "video_note";

function pickMedia(ctx: Context): {
  kind: MediaKind;
  fileId: string;
  fileName: string;
  mimeType: string;
} | null {
  const msg = ctx.message;
  if (!msg) return null;

  if (msg.document) {
    return {
      kind: "document",
      fileId: msg.document.file_id,
      fileName: msg.document.file_name || "document.bin",
      mimeType: msg.document.mime_type || "application/octet-stream",
    };
  }
  if (msg.video) {
    return {
      kind: "video",
      fileId: msg.video.file_id,
      fileName: msg.video.file_name || `video-${msg.video.file_unique_id}.mp4`,
      mimeType: msg.video.mime_type || "video/mp4",
    };
  }
  if (msg.audio) {
    return {
      kind: "audio",
      fileId: msg.audio.file_id,
      fileName: msg.audio.file_name || `audio-${msg.audio.file_unique_id}.mp3`,
      mimeType: msg.audio.mime_type || "audio/mpeg",
    };
  }
  if (msg.voice) {
    return {
      kind: "voice",
      fileId: msg.voice.file_id,
      fileName: `voice-${msg.voice.file_unique_id}.ogg`,
      mimeType: msg.voice.mime_type || "audio/ogg",
    };
  }
  if (msg.animation) {
    return {
      kind: "animation",
      fileId: msg.animation.file_id,
      fileName:
        msg.animation.file_name ||
        `animation-${msg.animation.file_unique_id}.mp4`,
      mimeType: msg.animation.mime_type || "video/mp4",
    };
  }
  if (msg.video_note) {
    return {
      kind: "video_note",
      fileId: msg.video_note.file_id,
      fileName: `videonote-${msg.video_note.file_unique_id}.mp4`,
      mimeType: "video/mp4",
    };
  }
  if (msg.photo?.length) {
    const photo = msg.photo[msg.photo.length - 1]!;
    return {
      kind: "photo",
      fileId: photo.file_id,
      fileName: `photo-${photo.file_unique_id}.jpg`,
      mimeType: "image/jpeg",
    };
  }
  return null;
}

async function downloadTelegramFile(bot: Bot, fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("تلگرام مسیر فایل را برنگرداند.");
  }
  // محدودیت سخت Bot API تلگرام برای دانلود فایل توسط ربات
  if (file.file_size && file.file_size > config.telegramMaxFileBytes) {
    throw new Error(
      `از تلگرام حداکثر ${formatBytes(config.telegramMaxFileBytes)} می‌توان گرفت (محدودیت خود تلگرام برای ربات‌ها). فایل کوچک‌تر بفرست.`,
    );
  }
  if (file.file_size && file.file_size > config.maxFileBytes) {
    throw new Error(
      `حجم فایل بیشتر از حد مجاز است (${formatBytes(config.maxFileBytes)}).`,
    );
  }
  const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`دانلود از تلگرام ناموفق بود (${res.status}).`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
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
    await ctx.reply(
      [
        "سلام 👋",
        "",
        "هر فایلی بفرست تا لینک دانلود بدم.",
        "",
        `⏱ لینک و فایل بعد از ${config.fileTtlHours} ساعت خودکار پاک می‌شود`,
        `📦 از تلگرام: حداکثر ${formatBytes(config.telegramMaxFileBytes)} (محدودیت تلگرام)`,
        "",
        "دستورها:",
        "/start — راهنما",
        "/id — یوزرآیدی",
        "/ping — وضعیت",
      ].join("\n"),
    );
  });

  bot.command("id", async (ctx) => {
    await ctx.reply(`یوزرآیدی تو: \`${ctx.from?.id ?? "?"}\``, {
      parse_mode: "Markdown",
    });
  });

  bot.command("ping", async (ctx) => {
    await ctx.reply("آنلاینم ✅ فایل‌ها روی GitHub ذخیره می‌شن.");
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
        `[bot] file from chat=${ctx.chat.id} user=${userId} name=${media.fileName}`,
      );
      const status = await ctx.reply("دارم روی GitHub آپلود می‌کنم…");

      try {
        const buffer = await downloadTelegramFile(bot, media.fileId);
        const stored = await storeUpload({
          buffer,
          originalName: media.fileName,
          mimeType: media.mimeType,
          telegramUserId: userId,
        });

        const text = [
          "✅ لینک دانلود آماده شد",
          "",
          `📄 ${stored.originalName}`,
          `📦 ${formatBytes(stored.size)}`,
          stored.expiresAt
            ? `⏱ انقضا: ${formatExpiryFa(stored.expiresAt)} (حداکثر ${config.fileTtlHours} ساعت)`
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
