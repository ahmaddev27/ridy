# دليل التشغيل المحلي — Reidey

> **متّسق مع** [`README.md`](../README.md) (Quick-start) وسكربتات `package.json` الحقيقية.
> **المتطلّبات:** PHP 8.3+، Composer 2، Node 20+ (22 مستحسن).
> آخر تحديث: **2026-09-02**

---

## 1. الباك-إند (SQLite — بلا إعداد قاعدة)

```bash
cd backend
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate --seed        # البذرة تُنشئ manager@fleet.de / password
php artisan serve                 # http://localhost:8000
```

- في dev الافتراضي `DB_CONNECTION=sqlite`، و`QUEUE_CONNECTION=database`، و`CACHE_STORE=database`.
- اضبط `DISPATCH_INGEST_SECRET` في `backend/.env` (وطابقه في الديمون).
- لدفع FCM حقيقي: `FCM_CREDENTIALS` (مسار service-account JSON) + `FCM_PROJECT_ID`؛ بدونهما تُسجَّل الدفعات فقط.
- `OTP_TEST_CODE=111111` موجود في `.env.example` للدخول بلا SMS في dev (مقصود).

## 2. الفرونت-إند (Next.js 16)

```bash
cd frontend
npm install
npm run dev                       # http://localhost:3000
```

> Next 16 يختلف عن بيانات التدريب — اقرأ `node_modules/next/dist/docs/` قبل تعديل كود الفرونت (تظهر بعد `npm install`).

## 3. ديمون الالتقاط (dispatch-daemon)

```bash
cd dispatch-daemon
cp .env.example .env               # اضبط DISPATCH_INGEST_SECRET ليطابق الباك
npm start                          # = node src/index.js  (ESM، بلا خطوة بناء)
```

- افتراضيات الـenv: `RIDY_API_URL=http://localhost:8090` (يرفض HTTP بعيد غير loopback)، `UBER_DISPATCH_BASE_URL=https://vsdispatch.uber.com`، `UBER_SUPPLIER_BASE_URL=https://fleethub.uber.com`.
- بلا `UBER_PROXY_URL` سكني، أوبر يحجب الاتصال المباشر (RAMEN 404) — التقاط حيّ محلياً غالباً يتم عبر الإضافة بدل الديمون.
- تحقّق من صحّة ملف بعد التعديل: `node -c src/<file>.js`.

## 4. تطبيق السائق (Expo)

```bash
cd driver-app
npm install
npm start                          # = expo start
# دفع FCM يحتاج development build (ليس Expo Go):
npx expo run:android               # = npm run android
```

- `npm run lint` = `tsc --noEmit` (بوابة النوع).

## 5. الستاك الكامل عبر Docker (dev)

```bash
cp .env.example .env               # عبّي DB_* / APP_KEY / NEXT_PUBLIC_API_URL
docker compose up --build
# الـAPI عبر nginx: http://localhost:8080 · الفرونت: http://localhost:3000
```

> **ملاحظة:** ستاك الـdev (`docker-compose.yml`) يستخدم **MySQL + Redis + Horizon + nginx**. الطابور/الكاش على Redis هنا **للـdev فقط** — البرودكشن يستخدم **database** (راجع HANDOFF §6). لا تبنِ البرودكشن بـ`docker-compose.yml`.

## 6. بوّابات التحقّق (قبل أي commit)

| عدّلت… | البوّابة |
|---|---|
| `backend/` | `cd backend && vendor/bin/pint --test && php artisan test` (sqlite `:memory:`). |
| `frontend/` | `cd frontend && npm run build` (البوّابة الصلبة؛ اللِنت استشاري). |
| `driver-app/` | `cd driver-app && npx tsc --noEmit`. |
| `dispatch-daemon/` | `node -c src/<file>.js` لكل ملف مُعدَّل. |
| `extension/` | حمّلها unpacked في كروم وافحص الكونسول؛ ارفع `manifest.json` version لأي إصدار متجر. |

التفاصيل الكاملة (نشر، إصدار التطبيق، runbook): [`HANDOFF.md`](../HANDOFF.md).
