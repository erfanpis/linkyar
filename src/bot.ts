import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Bot, Context, InlineKeyboard } from "grammy";
import {
  approveUser,
  canUseBot,
  denyUser,
  getAccessStatus,
  isAdmin,
  listAccessSummary,
  requestAccess,
} from "./access.js";
import { config } from "./config.js";
import { msg } from "./messages.js";
import { downloadMessageToFile, isMtprotoConfigured } from "./mtproto.js";
import { savePending, takePending, type PendingFile } from "./pending.js";
import { formatBytes, storeUpload } from "./store.js";

type MediaInfo = PendingFile;

function pickMedia(ctx: Context): MediaInfo | null {
  const m = ctx.message;
  if (!m || !ctx.chat || !ctx.from) return null;
  const base = {
    messageId: m.message_id,
    chatId: ctx.chat.id,
    userId: ctx.from.id,
    createdAt: new Date().toISOString(),
  };

  if (m.document) {
    return {
      ...base,
      kind: "سند",
      fileId: m.document.file_id,
      fileName: m.document.file_name || "document.bin",
      mimeType: m.document.mime_type || "application/octet-stream",
      fileSize: m.document.file_size,
    };
  }
  if (m.video) {
    return {
      ...base,
      kind: "ویدیو",
      fileId: m.video.file_id,
      fileName: m.video.file_name || `video-${m.video.file_unique_id}.mp4`,
      mimeType: m.video.mime_type || "video/mp4",
      fileSize: m.video.file_size,
    };
  }
  if (m.audio) {
    return {
      ...base,
      kind: "صوت",
      fileId: m.audio.file_id,
      fileName: m.audio.file_name || `audio-${m.audio.file_unique_id}.mp3`,
      mimeType: m.audio.mime_type || "audio/mpeg",
      fileSize: m.audio.file_size,
    };
  }
  if (m.voice) {
    return {
      ...base,
      kind: "ویس",
      fileId: m.voice.file_id,
      fileName: `voice-${m.voice.file_unique_id}.ogg`,
      mimeType: m.voice.mime_type || "audio/ogg",
      fileSize: m.voice.file_size,
    };
  }
  if (m.animation) {
    return {
      ...base,
      kind: "انیمیشن",
      fileId: m.animation.file_id,
      fileName:
        m.animation.file_name || `animation-${m.animation.file_unique_id}.mp4`,
      mimeType: m.animation.mime_type || "video/mp4",
      fileSize: m.animation.file_size,
    };
  }
  if (m.video_note) {
    return {
      ...base,
      kind: "ویدیو نوت",
      fileId: m.video_note.file_id,
      fileName: `videonote-${m.video_note.file_unique_id}.mp4`,
      mimeType: "video/mp4",
      fileSize: m.video_note.file_size,
    };
  }
  if (m.photo?.length) {
    const photo = m.photo[m.photo.length - 1]!;
    return {
      ...base,
      kind: "عکس",
      fileId: photo.file_id,
      fileName: `photo-${photo.file_unique_id}.jpg`,
      mimeType: "image/jpeg",
      fileSize: photo.file_size,
    };
  }
  return null;
}

async function editHtml(
  ctx: Context,
  chatId: number,
  messageId: number,
  html: string,
) {
  try {
    await ctx.api.editMessageText(chatId, messageId, html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch {
    /* ignore */
  }
}

async function downloadViaHttpBotApi(bot: Bot, fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error("مسیر فایل از تلگرام نیامد.");
  if (file.file_size && file.file_size > config.telegramHttpMaxBytes) {
    throw new Error("فایل بزرگ است؛ MTProto باید فعال باشد.");
  }
  const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`دانلود ناموفق (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function processConfirmedFile(
  bot: Bot,
  ctx: Context,
  media: MediaInfo,
  statusChatId: number,
  statusMessageId: number,
) {
  const touch = async (stage: string, pct?: number) => {
    await editHtml(ctx, statusChatId, statusMessageId, msg.working(stage, pct));
  };

  await touch("شروع دریافت فایل از تلگرام…", 3);

  if (media.fileSize && media.fileSize > config.maxFileBytes) {
    throw new Error(
      `حجم بیشتر از سقف مجاز است (${formatBytes(config.maxFileBytes)}).`,
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
        onProgress: async (pct) => {
          await touch("در حال دریافت از تلگرام…", Math.max(5, pct * 0.7));
        },
      });
      await touch("آپلود و ساخت لینک دانلود…", 78);
      const stored = await storeUpload({
        filePath: dest,
        originalName: media.fileName,
        mimeType: media.mimeType,
        telegramUserId: media.userId,
        size,
      });
      await touch("نهایی‌سازی…", 96);
      await editHtml(
        ctx,
        statusChatId,
        statusMessageId,
        msg.ready({
          name: stored.originalName,
          size: stored.size,
          url: stored.url,
          expiresAt: stored.expiresAt,
        }),
      );
      return;
    } finally {
      await unlink(dest).catch(() => undefined);
    }
  }

  await touch("دریافت فایل…", 25);
  const buffer = await downloadViaHttpBotApi(bot, media.fileId);
  await touch("آپلود و ساخت لینک…", 75);
  const stored = await storeUpload({
    buffer,
    originalName: media.fileName,
    mimeType: media.mimeType,
    telegramUserId: media.userId,
  });
  await editHtml(
    ctx,
    statusChatId,
    statusMessageId,
    msg.ready({
      name: stored.originalName,
      size: stored.size,
      url: stored.url,
      expiresAt: stored.expiresAt,
    }),
  );
}

async function notifyAdminsNewUser(
  bot: Bot,
  user: { id: number; username?: string; firstName?: string },
) {
  const keyboard = new InlineKeyboard()
    .text("✅ تأیید دسترسی", `a:1:${user.id}`)
    .text("🚫 رد", `a:0:${user.id}`);
  const text = msg.adminNewUser(user);
  for (const adminId of config.adminUserIds) {
    try {
      await bot.api.sendMessage(adminId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } catch (err) {
      console.error(`[bot] notify admin ${adminId} failed`, err);
    }
  }
}

export function createBot(): Bot | null {
  if (!config.telegramToken) {
    console.warn("[bot] TELEGRAM_BOT_TOKEN missing");
    return null;
  }

  const bot = new Bot(config.telegramToken);

  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const status = isAdmin(userId) ? "admin" : await getAccessStatus(userId);
    if (status === "admin" || status === "approved") {
      await ctx.reply(msg.startApproved(), { parse_mode: "HTML" });
      return;
    }
    if (status === "denied") {
      await ctx.reply(msg.startDenied(), { parse_mode: "HTML" });
      return;
    }
    if (status === "pending") {
      await ctx.reply(msg.startPending(), { parse_mode: "HTML" });
      return;
    }

    await requestAccess({
      id: userId,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      lastName: ctx.from?.last_name,
      at: new Date().toISOString(),
    });
    await ctx.reply(msg.startPending(), { parse_mode: "HTML" });
    await notifyAdminsNewUser(bot, {
      id: userId,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
    });
  });

  bot.command("id", async (ctx) => {
    await ctx.reply(`شناسه تلگرام تو:\n<code>${ctx.from?.id ?? "?"}</code>`, {
      parse_mode: "HTML",
    });
  });

  bot.command("ping", async (ctx) => {
    if (!(await canUseBot(ctx.from?.id))) {
      await ctx.reply(msg.needAccess(), { parse_mode: "HTML" });
      return;
    }
    await ctx.reply("آنلاینم ✅");
  });

  bot.command("users", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply(msg.adminOnly());
      return;
    }
    await ctx.reply(await listAccessSummary(), { parse_mode: "HTML" });
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const fromId = ctx.from?.id;
    if (!fromId || !data) return;

    const adminMatch = /^a:([01]):(\d+)$/.exec(data);
    if (adminMatch) {
      if (!isAdmin(fromId)) {
        await ctx.answerCallbackQuery({ text: "فقط مدیر", show_alert: true });
        return;
      }
      const allow = adminMatch[1] === "1";
      const targetId = Number(adminMatch[2]);
      if (allow) {
        await approveUser(targetId);
        try {
          await bot.api.sendMessage(targetId, msg.accessGranted(), {
            parse_mode: "HTML",
          });
        } catch {
          /* ignore */
        }
        await ctx.answerCallbackQuery({ text: "تأیید شد" });
        await ctx.editMessageText(
          `✅ کاربر <code>${targetId}</code> تأیید شد.`,
          { parse_mode: "HTML" },
        );
      } else {
        await denyUser(targetId);
        try {
          await bot.api.sendMessage(targetId, msg.accessRejected(), {
            parse_mode: "HTML",
          });
        } catch {
          /* ignore */
        }
        await ctx.answerCallbackQuery({ text: "رد شد" });
        await ctx.editMessageText(`🚫 کاربر <code>${targetId}</code> رد شد.`, {
          parse_mode: "HTML",
        });
      }
      return;
    }

    const confMatch = /^c:([01]):(\d+):(\d+)$/.exec(data);
    if (confMatch) {
      if (!(await canUseBot(fromId))) {
        await ctx.answerCallbackQuery({
          text: "دسترسی نداری",
          show_alert: true,
        });
        return;
      }
      const yes = confMatch[1] === "1";
      const originChatId = Number(confMatch[2]);
      const originMsgId = Number(confMatch[3]);
      const statusChatId = ctx.callbackQuery.message?.chat.id;
      const statusMessageId = ctx.callbackQuery.message?.message_id;
      if (!statusChatId || !statusMessageId) {
        await ctx.answerCallbackQuery({ text: "پیام پیدا نشد" });
        return;
      }

      if (!yes) {
        await takePending(originChatId, originMsgId);
        await ctx.answerCallbackQuery({ text: "لغو شد" });
        await editHtml(ctx, statusChatId, statusMessageId, msg.cancelled());
        return;
      }

      const pending = await takePending(originChatId, originMsgId);
      if (!pending || pending.userId !== fromId) {
        await ctx.answerCallbackQuery({
          text: "این درخواست منقضی شده؛ دوباره فایل بفرست",
          show_alert: true,
        });
        return;
      }

      await ctx.answerCallbackQuery({ text: "شروع شد…" });
      await editHtml(
        ctx,
        statusChatId,
        statusMessageId,
        msg.working("در صف آماده‌سازی…", 1),
      );

      try {
        await processConfirmedFile(
          bot,
          ctx,
          pending,
          statusChatId,
          statusMessageId,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "خطای ناشناخته";
        console.error("[bot] confirm failed", err);
        await editHtml(
          ctx,
          statusChatId,
          statusMessageId,
          msg.failed(message),
        );
      }
      return;
    }

    await ctx.answerCallbackQuery();
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
      if (!(await canUseBot(userId))) {
        await ctx.reply(msg.needAccess(), { parse_mode: "HTML" });
        return;
      }

      const media = pickMedia(ctx);
      if (!media) {
        await ctx.reply(msg.onlyFile());
        return;
      }

      await savePending(media);

      const keyboard = new InlineKeyboard()
        .text("✅ بله، لینک بده", `c:1:${media.chatId}:${media.messageId}`)
        .row()
        .text("❌ نه، لغو", `c:0:${media.chatId}:${media.messageId}`);

      await ctx.reply(
        msg.confirmFile({
          name: media.fileName,
          size: media.fileSize,
          kind: media.kind,
        }),
        {
          parse_mode: "HTML",
          reply_markup: keyboard,
          reply_parameters: { message_id: media.messageId },
        },
      );
    },
  );

  bot.on("message", async (ctx) => {
    if (ctx.message?.text?.startsWith("/")) return;
    if (!(await canUseBot(ctx.from?.id))) {
      await ctx.reply(msg.needAccess(), { parse_mode: "HTML" });
      return;
    }
    await ctx.reply(msg.onlyFile());
  });

  bot.catch((err) => {
    console.error("[bot] error", err.error);
  });

  return bot;
}
