# قائمة الإطلاق للبرودكشن — Reidey

> **يعتمد على:** [`HANDOFF.md`](../HANDOFF.md) §5 (البيئة) و§6 (النشر)، و[`13-deployment.md`](./13-deployment.md) (خطوات التزويد الكاملة).
> الستاك: Docker Compose + Caddy على VPS واحد (`docker-compose.prod.yml`, الدومين `reidey.de`).
> آخر تحديث: **2026-09-02**

---

## 1. DNS و TLS
- [ ] سجلّ `A` للدومين (`reidey.de`) → IP السيرفر.
- [ ] `DOMAIN` و`SITE_ADDRESS` في `.env` الجذري = الدومين (Caddy يصدر Let's Encrypt تلقائياً).

## 2. مفاتيح `.env` الجذرية (انسخ من `.env.prod.example`)
- [ ] **`APP_KEY`** — ولّده: `docker compose -f docker-compose.prod.yml run --rm backend php artisan key:generate --show`.
- [ ] **DB:** `DB_DATABASE=ridy`، `DB_USERNAME`، `DB_PASSWORD`، `DB_ROOT_PASSWORD` (كلمات قويّة).
- [ ] **`DISPATCH_INGEST_SECRET`** — سلسلة عشوائية طويلة، **متطابقة** بين الباك والديمون (وإلا 401 على `/ingest`).
- [ ] **Reverb:** `REVERB_APP_ID/KEY/SECRET` (ولّدها مرّة: `php artisan reverb:install`).
- [ ] **FCM (اختياري لكن مطلوب لدفع السائق):** ارفع service-account JSON إلى حاوية الباك، واضبط `FCM_CREDENTIALS` (المسار داخل الحاوية) و`FCM_PROJECT_ID`. **بدونهما يقع الباك على `LogPushSender`** (الدفع يُسجَّل فقط لا يُرسَل — راجع HANDOFF §6). دفع الويب مستقل ومُهيّأ في حزمة الفرونت.
- [ ] **SMTP/Mail:** ضبط `MAIL_*` (أو من إعدادات الأدمن) لإرسال الإيميلات الحقيقية.
- [ ] **`OTP_TEST_CODE`** — **اتركه فارغاً في البرودكشن** (وإلا كود ثابت). البرودكشن أصلاً يرفض الكود الثابت.
- [ ] `ALERT_EMAIL` (اختياري) لتنبيهات الجلسات المكسورة/الشاردز.

## 3. البروكسي السكني (لكل شركة)
- [ ] أوبر يحجب الداتاسنتر — عيّن **بروكسي سكني** من لوحة الأدمن لكل شركة (مخزّن مشفّراً في `proxies.url`). `UBER_PROXY_URL` في env مجرّد fallback عام.

## 4. أول تزويد (First provision)
```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend php artisan migrate --force --seed
# البذرة تُنشئ manager@fleet.de / password — غيّرها فوراً.
```
- [ ] تأكّد من عمل حاويتَي **`scheduler`** (`schedule:work`) و**`queue`** (`queue:work`) — بدونهما لا يُصرَّف الطابور ولا تُنظَّف العروض العالقة.
- [ ] الطابور/الكاش = **database** (لا Redis/Horizon بالبرودكشن).

## 5. النشر الروتيني (الباك mounted — بلا إعادة بناء صورة)
```bash
git pull
docker compose -f docker-compose.prod.yml exec backend php artisan migrate --force
docker compose -f docker-compose.prod.yml exec backend php artisan config:clear
docker compose -f docker-compose.prod.yml restart backend scheduler queue
```
تغييرات **frontend/daemon** (صور) تحتاج `up -d --build <service>`. الـCI (`.github/workflows/deploy.yml`) يؤتمت هذا على push لـ`main`.

## 6. نشر الإضافة (Chrome Web Store)
- [ ] ارفع `manifest.json` version (الحالي **1.15.4**) وزِب `extension/` وارفعه (unlisted، تحديث تلقائي). راجع [`14-publish-extension.md`](./14-publish-extension.md).
- [ ] تأكّد أن `host_permissions` تشمل `fleethub.uber.com` (بعد هجرة Fleet Hub).

## 7. تطبيق السائق (المتجر + DSA)
- [ ] بناء/نشر عبر EAS (Play). للتحديثات الخفيفة JS/TS: **OTA** (`eas update`). راجع [`15-publish-mobile-app.md`](./15-publish-mobile-app.md) و[`app-store-submission.md`](./app-store-submission.md).
- [ ] **DSA (ألمانيا):** حالة «تاجر» يجب أن تُعتمَد؛ قبلها يظهر «Cannot Sell».
- [ ] iOS: `GoogleService-Info.plist` + مفتاح APNs على Firebase (لسا ناقص — ROADMAP).

## 8. اختبارات دخان (Smoke tests)
- [ ] `GET /api/v1/health` = 200.
- [ ] دخول لوحة + ربط أوبر عبر الإضافة (المدير يفتح أوبر → التقاط الجلسة).
- [ ] وصول عرض حيّ → إشعار على هاتف سائق مرتبط خلال ثوانٍ (تحقّق من `dispatch_offer.notified devices=N`).
- [ ] صفحة **صحّة النظام** للأدمن: عمق الطابور، نبضة الـscheduler، وصول Reverb/Nominatim/OSRM، وطزاجة مزامنة الحالات.
