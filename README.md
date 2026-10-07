# لینک‌یار — تلگرام → لینک دانلود روی GitHub

فایل را به ربات بفرست؛ روی **فضای رایگان GitHub** ذخیره می‌شود و لینک دانلود (`raw.githubusercontent.com`) برمی‌گردد.

**سرور / VPS / DirectAdmin لازم نیست.** ربات با **GitHub Actions** هر دقیقه یک‌بار تلگرام را چک می‌کند.

## چطور کار می‌کند؟

```
تو ──فایل──▶ تلگرام
               │
               ▼
        GitHub Actions (رایگان روی ریپوی Public)
               │
               ├── فایل را در uploads/ همین ریپو می‌گذارد
               └── لینک raw را در تلگرام برایت می‌فرستد
```

تأخیر معمول: حدود **۱ تا ۵ دقیقه** (cron گیت‌هاب دقیقِ ثانیه‌ای نیست).

## راه‌اندازی بدون سرور (۳ دقیقه)

1. از `@BotFather` ربات بساز و توکن را بردار.
2. این کد را در یک ریپوی **Public** روی GitHub بگذار (مهم: Public).
3. برو به  
   `Settings → Secrets and variables → Actions`  
   و Secret بساز:
   - نام: `TELEGRAM_BOT_TOKEN`
   - مقدار: توکن ربات
4. برو به تب **Actions** و workflowِ `Telegram poll` را با **Run workflow** یک‌بار دستی اجرا کن.
5. به ربات در تلگرام فایل بفرست و چند دقیقه صبر کن.

اختیاری: در `Settings → Variables` متغیر `ALLOWED_USER_IDS` بگذار تا فقط خودت بتوانی آپلود کنی (`/id` داخل ربات).

## محدودیت‌ها (صادقانه)

| مورد | توضیح |
|------|--------|
| ریپو باید Public باشد | وگرنه لینک raw برای دیگران باز نمی‌شود |
| حجم فایل تلگرام | حدود ۲۰MB برای ربات‌ها |
| سهمیه GitHub | فایل خیلی زیاد/حجیم ریپو را سنگین می‌کند |
| تأخیر | Actions لحظه‌ای نیست |

برای فایل‌های حساس/خصوصی این روش مناسب نیست (ریپو عمومی است).

## اجرای لوکال (اختیاری)

```bash
cp .env.example .env
# TELEGRAM_BOT_TOKEN + GITHUB_TOKEN + GITHUB_REPOSITORY را پر کن
npm install
npm run poll    # یک دور مثل Actions
npm run dev     # سرور وب آزمایشی روی پورت 38471
```

`GITHUB_TOKEN` لوکال = Personal Access Token با دسترسی `contents:write` روی همان ریپو.
