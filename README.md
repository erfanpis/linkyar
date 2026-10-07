# Linkyar

ربات تلگرام خصوصی برای ساخت لینک دانلود مستقیم از فایل.

## امکانات

- تأیید قبل از ساخت لینک
- نمایش پیشرفت هنگام آماده‌سازی
- دسترسی فقط با تأیید مدیر
- انقضای خودکار لینک بعد از ۶ ساعت
- پشتیبانی فایل‌های بزرگ (تا ۲ گیگ با MTProto)

## اجرا

```bash
cp .env.example .env
npm install
npm run poll
```

Secrets لازم در GitHub Actions:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`

مدیر پیش‌فرض با `ADMIN_USER_IDS` تنظیم می‌شود.
