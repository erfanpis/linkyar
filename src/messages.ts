import { config } from "./config.js";
import { formatBytes } from "./storage.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatExpiryFa(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fa-IR", { hour12: false });
  } catch {
    return iso;
  }
}

export function progressBar(pct: number): string {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round(p / 10);
  return `${"▓".repeat(filled)}${"░".repeat(10 - filled)} ${p}٪`;
}

export const msg = {
  startApproved: () =>
    [
      "<b>لینک‌یار</b>",
      "",
      "فایلت را بفرست تا لینک دانلود مستقیم بسازم.",
      "",
      `⏱ اعتبار لینک: <b>${config.fileTtlHours} ساعت</b>`,
      `📦 سقف حجم: <b>${esc(formatBytes(config.maxFileBytes))}</b>`,
      "",
      "قبل از ساخت لینک، یک‌بار تأیید می‌گیرم.",
    ].join("\n"),

  startPending: () =>
    [
      "<b>درخواست دسترسی ثبت شد</b>",
      "",
      "مدیر در حال بررسی است.",
      "بعد از تأیید، همین‌جا خبرت می‌کنم.",
    ].join("\n"),

  startDenied: () =>
    [
      "<b>دسترسی نداری</b>",
      "",
      "اگر فکر می‌کنی اشتباه شده، به مدیر پیام بده.",
    ].join("\n"),

  accessGranted: () =>
    [
      "<b>دسترسی تأیید شد ✅</b>",
      "",
      "الان می‌تونی فایل بفرستی.",
      "قبل از ساخت لینک ازت تأیید می‌گیرم.",
    ].join("\n"),

  accessRejected: () =>
    ["<b>درخواستت رد شد</b>", "", "دسترسی به این ربات فعال نشد."].join("\n"),

  needAccess: () =>
    [
      "برای استفاده باید دسترسی داشته باشی.",
      "دستور /start را بزن تا درخواست برای مدیر برود.",
    ].join("\n"),

  confirmFile: (opts: {
    name: string;
    size?: number;
    kind: string;
  }) =>
    [
      "<b>تأیید فایل</b>",
      "",
      `📄 <code>${esc(opts.name)}</code>`,
      opts.size ? `📦 ${esc(formatBytes(opts.size))}` : "📦 حجم نامشخص",
      `🏷 ${esc(opts.kind)}`,
      `⏱ لینک تا <b>${config.fileTtlHours} ساعت</b> معتبر است`,
      "",
      "از این فایل مطمئنی؟ لینکش ساخته بشه؟",
    ].join("\n"),

  cancelled: () => "لغو شد. هر وقت خواستی دوباره فایل بفرست.",

  working: (stage: string, pct?: number) =>
    [
      "<b>در حال آماده‌سازی لینک</b>",
      "",
      pct == null ? progressBar(0) : progressBar(pct),
      "",
      `📌 ${esc(stage)}`,
    ].join("\n"),

  ready: (opts: {
    name: string;
    size: number;
    url: string;
    expiresAt?: string;
  }) =>
    [
      "<b>لینک آماده دریافت است ✅</b>",
      "",
      `📄 <code>${esc(opts.name)}</code>`,
      `📦 ${esc(formatBytes(opts.size))}`,
      opts.expiresAt
        ? `⏱ انقضا: <b>${esc(formatExpiryFa(opts.expiresAt))}</b> (${config.fileTtlHours} ساعت)`
        : `⏱ انقضا: <b>${config.fileTtlHours} ساعت</b>`,
      "",
      `<b>دانلود:</b>`,
      opts.url,
    ].join("\n"),

  failed: (error: string) =>
    ["<b>آپلود انجام نشد</b>", "", esc(error)].join("\n"),

  adminNewUser: (u: {
    id: number;
    username?: string;
    firstName?: string;
  }) =>
    [
      "<b>درخواست دسترسی جدید</b>",
      "",
      `👤 ${esc(u.firstName ?? "—")} ${u.username ? `@${esc(u.username)}` : ""}`,
      `🆔 <code>${u.id}</code>`,
      "",
      "تأیید یا رد کن:",
    ].join("\n"),

  onlyFile: () => "یک فایل بفرست (سند، ویدیو، عکس، صوت…).",

  adminOnly: () => "این دستور فقط برای مدیر است.",
};
