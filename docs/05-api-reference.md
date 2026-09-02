# مرجع الـ API للباك-إند (Reidey · Laravel 13)

> **مصدر الحقيقة:** [`backend/routes/api.php`](../backend/routes/api.php) (النقاط) و[`backend/routes/console.php`](../backend/routes/console.php) (المهام المجدولة). هذا الملف يلخّصهما — عند أي اختلاف، **الكود هو الحقيقة**.
> **للتفاصيل المعمارية** (المنطق خلف كل نقطة): [`HANDOFF.md`](../HANDOFF.md) §2.
> آخر تحديث: **2026-09-02**

---

## 1. الاتفاقيات العامة

- **Base URL:** كل النقاط تحت `‎/api/v1` (مثلاً `‎/api/v1/health`). محلياً `http://localhost:8000/api/v1`، وبالبرودكشن `https://reidey.de/api/v1`.
- **التنسيق:** JSON. الترميز UTF-8.
- **المصادقة — ثلاث مسارات** (تفصيل في HANDOFF §2.3):
  - **لوحة التحكّم (SPA):** Sanctum — كوكي جلسة على نفس الدومين (حارس `web`/`users`).
  - **تطبيق السائق:** Sanctum **bearer token** (حارس `driver` → موديل `Driver`). كثير من نقاط السائق محميّة إضافياً بـ`driver.active` (تمنع سائق شركة اشتراكها منتهٍ بـ`403`).
  - **الديمون (داخلي):** سرّ مشترك في هيدر `X-Dispatch-Secret` (وسيط `dispatch.secret`)، وليس جلسة مستخدم.
- **تعدّد المستأجرين:** لا يُمرَّر `tenant_id` من العميل أبداً — يُحلّ من المستخدم المصادق (`ResolveTenant`). النقاط تحت مجموعة اللوحة مقيّدة بـ`dashboard.only`. الأدمن يعمل cross-tenant (بلا `ResolveTenant`).
- **الحدّ من المعدّل (throttle):** موضّح بجانب النقاط العامة (مثلاً `throttle:5,1` = 5 طلبات/دقيقة).

---

## 2. عام / بلا مصادقة

| Method | Path | الحماية | الغرض |
|---|---|---|---|
| GET | `health` | — | فحص صحّة (`HealthController`). |
| POST | `login` | `throttle:5,1` | دخول لوحة التحكّم (أدمن/مدير/ريسيلر). |
| GET | `app/version` | `throttle:60,1` | بوابة التحديث الإجباري لتطبيق السائق. |
| GET | `plans` | `throttle:60,1` | كتالوج الباقات لصفحة الأسعار التسويقية. |
| POST | `contact` | `throttle:5,1` | نموذج «تواصل معنا» في اللاندينج. |
| GET | `support-contact` | `throttle:60,1` | جهة دعم واتساب لأزرار «تواصل مع الدعم». |
| POST | `register` · `register/verify` · `register/resend` | `throttle:6/12/3,1` | تسجيل ذاتي للشركة عبر OTP بالإيميل. |
| POST | `password/forgot` · `password/verify` · `password/reset` | `throttle:6/12/12,1` | استعادة كلمة مرور اللوحة عبر OTP. |
| POST | `company/activate` | `throttle:10,1` | إدخال كود التفعيل (3 محاولات → حظر). |

---

## 3. تطبيق السائق (`prefix: driver`)

كلها ضمن وسيط `LogDriverAuthContext`.

**تهيئة عامة (بلا توكن):**

| Method | Path | الغرض |
|---|---|---|
| GET | `driver/invite/{token}` | معاينة دعوة سائق. |
| POST | `driver/activate` | تفعيل الدعوة (تعيين كلمة مرور) → يُصدر bearer. |
| POST | `driver/login` | دخول بكلمة مرور. |
| POST | `driver/login/request` · `driver/login/verify` | دخول بلا كلمة مرور (OTP بالإيميل) — للسائقين وأصحاب الأسطول. |
| POST | `driver/password/forgot` · `password/verify` · `password/reset` | استعادة كلمة المرور داخل التطبيق. |

**بتوكن السائق (`auth:driver`):**

| Method | Path | الغرض |
|---|---|---|
| POST | `driver/logout` | يعمل حتى مع اشتراك موقوف (لمسح التوكن). |

**بتوكن السائق + شركة نشِطة (`auth:driver` + `driver.active`):**

| Method | Path | الغرض |
|---|---|---|
| GET · PATCH | `driver/me` | قراءة/تعديل ملف السائق. |
| POST · DELETE | `driver/devices` | تسجيل/حذف توكن جهاز الدفع (FCM). |
| GET | `driver/home` · `driver/stats` | الرئيسية + الإحصائيات (يوم الأسطول 04:00). |
| GET | `driver/offers` · `driver/offers/{offer}` | قائمة العروض + تفاصيل عرض. |
| POST | `driver/offers/seen` | تعليم العروض كمقروءة. |
| POST | `driver/broadcasting/auth` | تفويض قناة Reverb الخاصة `driver.{id}`. |

**وضع صاحب الأسطول (`prefix: fleet`, `auth:sanctum` + `driver.active`):** مدير/مالك يدخل نفس التطبيق ويراقب كل سواقينه (قراءة فقط)؛ توكنه يُحلّ على `User`.

| Method | Path | الغرض |
|---|---|---|
| GET · PATCH | `fleet/me` | ملف المالك. |
| POST | `fleet/logout` | خروج. |
| GET | `fleet/home` · `fleet/drivers` · `fleet/stats` | نظرة الأسطول. |
| GET | `fleet/offers` · `fleet/offers/{offer}` | كل عروض السواقين + تفصيل. |
| POST · DELETE | `fleet/devices` | جهاز دفع المالك (توكن `User`). |

---

## 4. داخلي — الديمون (`prefix: internal/dispatch`, وسيط `dispatch.secret`)

| Method | Path | الغرض |
|---|---|---|
| POST | `internal/dispatch/ingest` | استيعاب دفعات العروض الخام (`DispatchIngestController`). |
| GET | `internal/dispatch/sessions` | قائمة جلسات أوبر النشِطة (كوكيز + `uber_org_uuid`). |
| POST | `internal/dispatch/sessions/{session}/cookies` | تدوير كوكيز الجلسة. |
| POST | `internal/dispatch/sessions/{session}/needs-relink` | تعليم الجلسة بحاجة إعادة ربط. |
| POST | `internal/dispatch/sessions/{session}/heartbeat` | نبضة حياة الديمون. |
| POST | `internal/dispatch/sessions/{session}/roster` | رفع الروستر المسحوب من Fleet Hub. |
| POST | `internal/dispatch/sessions/{session}/statuses` | رفع حالات السائقين (أساس استنتاج القبول). |

---

## 5. أساسيات الجلسة (`auth:sanctum` + `user.account`، بلا نطاق مستأجر)

تخدم حتى المستخدمين بلا مستأجر (الريسيلر) دون المرور على حارس الـtenant.

| Method | Path | الغرض |
|---|---|---|
| GET | `me` | المستخدم المصادق. |
| POST | `logout` | خروج اللوحة. |
| POST | `impersonate/stop` | إنهاء انتحال الشركة. |
| POST | `client-log` (`throttle:30,1`) | تقرير أخطاء الفرونت → لوج الأدمن. |

---

## 6. لوحة الشركة / المستأجر (`auth:sanctum` + `user.account` + `ResolveTenant` + `dashboard.only`)

نقاط الاستيعاب من المتصفّح مقيّدة إضافياً بـ`fleet.connected` (شركة ربطت حساب أوبر فعلاً).

| Method | Path | الغرض |
|---|---|---|
| GET | `dashboard/summary` | ملخّص لوحة الشركة. |
| GET | `ads/current` · `ads/media/{filename}` | الإعلان المنصّي الحالي لخانة العروض. |
| GET · POST | `subscription/history` · `subscription/redeem` (`throttle:10,1`) | سجلّ الاشتراك + استبدال كود. |
| GET | `drivers` · `drivers/live` · `drivers/{driver}` · `drivers/{driver}/stats` | السواقين + الخريطة الحيّة + التفصيل/الإحصاء. |
| PATCH | `drivers/{driver}` | تعديل سائق. |
| POST | `drivers/sync` · `drivers/roster` · `drivers/statuses` | استيعاب من المتصفّح (`fleet.connected`). |
| POST · GET | `drivers/metrics` · `drivers/{driver}/metrics` | مقاييس أداء أوبر (استيعاب `fleet.connected` / قراءة). |
| GET · POST | `vehicles` | المركبات (استيعاب `fleet.connected`). |
| POST | `supplier/capture` | التقاط عام لأي تبويب Fleet Hub (`fleet.connected`) → Network feed. |
| GET | `dispatch/offers` · `.../stats` · `.../export` · `.../{offer}` | تغذية العروض + إحصاء + تصدير + تفصيل. |
| POST | `dispatch/offers/ingest` | عروض RAMEN من متصفّح المدير (`fleet.connected`). |
| POST · DELETE | `dispatch/offers/bulk-delete` · `dispatch/offers/{offer}` | حذف جماعي / مفرد. |
| POST | `uber-login/start` · `uber-login/mfa` | دخول أوبر تفاعلي (إيميل/كلمة مرور → MFA). |
| POST | `extension/token` | إصدار توكن اقتران للإضافة من جلسة اللوحة. |
| GET · POST · DELETE | `fleet-session` | حالة/التقاط/فصل جلسة أوبر. |
| POST | `fleet-session/reconnect` · `fleet-session/report-broken` | إعادة ربط / بلاغ عطل. |
| GET | `dispatch/unlinked-drivers` | سواقين بلا ربط UUID. |
| POST | `drivers/{driver}/link-uber` · `dispatch/auto-link` | ربط يدوي / تلقائي بـUUID أوبر. |
| POST | `drivers/{driver}/invite` · `drivers/{driver}/test-push` | دعوة للتطبيق / دفعة اختبار. |
| POST | `devices` | تسجيل توكن جهاز السائق (`DeviceTokenController`). |
| GET · POST · DELETE | `notifications` · `.../read` · `.../clear` · `.../{id}` | جرس الإشعارات. |
| POST · DELETE | `notifications/device` | توكن FCM ويب للّوحة. |
| GET · PUT | `notification-prefs` | تفضيلات الدفع/الإيميل لكل فئة. |
| GET | `audit-logs` | سجلّ التدقيق. |
| PUT | `profile` | تعديل المستخدم لحسابه. |

---

## 7. الريسيلر (`auth:sanctum` + `user.account` + `can:codes.generate`, `prefix: reseller`)

المجموعة كلها محميّة بصلاحية `codes.generate` (بلا `ResolveTenant` — الريسيلر منصّي لا مستأجر).

| Method | Path | الغرض |
|---|---|---|
| GET | `reseller/plans` | الباقات المتاحة. |
| GET | `reseller/companies/search` | بحث الشركات لإصدار كود. |
| POST | `reseller/activation` | توليد كود تفعيل على باقة. |
| GET | `reseller/codes` | أكواد هذا الريسيلر فقط. |

---

## 8. الأدمن المنصّي (`auth:sanctum` + `super.admin`, `prefix: admin`)

بلا `ResolveTenant` عمداً → السياق فارغ فالنطاق العام لا يعمل (cross-tenant).

- **نظرة عامة/صحّة:** `GET overview`، `GET system-health`، `GET system-metrics`، `GET infrastructure`.
- **الطابور:** `GET queue/failed`، `POST queue/retry`، `POST queue/flush`، `POST queue/clear-pending`.
- **اللوجات:** `GET logs`، `DELETE logs`، `DELETE network-logs`.
- **الإعدادات:** `GET/PUT settings`، `POST settings/test-email`.
- **قوالب الإيميل:** `GET email-templates`، `POST email-templates/image`، `GET/PUT email-templates/{key}`، `POST email-templates/{key}/preview`.
- **مجمّع البروكسي:** `GET/POST proxies`، `PUT/DELETE proxies/{proxy}`.
- **دليل المستخدمين:** `GET users`، `DELETE users/{user}`.
- **السواقون اليتامى:** `GET orphan-drivers`.
- **البرودكاست:** `POST notifications/broadcast` (مصفوف عبر الطابور).
- **الشاردز (توسّع الديمون):** `GET shards`، `PATCH shards/{shard}`، `POST shards/rebalance`.
- **الشركات:** `GET/POST companies`، `GET/PUT/DELETE companies/{tenant}`.
- **درِل بيانات الشركة:** `GET companies/{tenant}/drivers|offers|vehicles|network`، `DELETE companies/{tenant}/network`.
- **مستخدمو الشركة:** `GET/POST companies/{tenant}/users`، `POST companies/{tenant}/users/{user}/reset-password`.
- **الاشتراكات/الحظر:** `GET banned-companies`، `POST companies/{tenant}/activation`، `POST companies/{tenant}/free-subscription`، `POST companies/{tenant}/reactivate`، `DELETE companies/{tenant}/subscription`.
- **جلسة الشركة:** `GET companies/{tenant}/session`، `POST companies/{tenant}/session/relink`، `DELETE companies/{tenant}/session`، `DELETE companies/{tenant}/data` (فصل + مسح بيانات التشغيل).
- **الانتحال:** `POST companies/{tenant}/impersonate` (الإيقاف في مجموعة الجلسة أعلاه).
- **المحصّلون + الدفعات:** `GET/POST collectors`، `PUT/DELETE collectors/{collector}`، `GET/POST collector-payments`، `GET collector-payments/export`، `DELETE collector-payments/{payment}`.
- **الباقات:** `GET/POST plans`، `PUT/DELETE plans/{plan}`.
- **الإعلانات المنصّية:** `GET/POST ads`، `POST ads/upload`، `PUT/DELETE ads/{ad}`.
- **صندوق الوارد (تواصل):** `GET contact-messages`، `PATCH/DELETE contact-messages/{contactMessage}`.
- **الفوترة:** `GET reports/billing-summary`، `GET subscription-invoices`، `GET subscription-invoices/export`، `POST subscription-invoices/{invoice}/settle`.
- **سجلّ الأكواد:** `GET subscription-codes`، `GET subscription-codes/export`.

---

## 9. المهام المجدولة (`console.php`)

يشغّلها حاوية `scheduler` (`schedule:work`). التفاصيل في HANDOFF §2.2 و§6.

| الأمر | التكرار | الغرض |
|---|---|---|
| `queue:work --stop-when-empty --max-time=50` | كل دقيقة | تصريف احتياطي للطابور (الأساسي حاوية `queue`). |
| نبضة الـscheduler (cache stamp) | كل دقيقة | إشارة حياة الـscheduler لصفحة الصحّة. |
| `offers:expire-pending` | كل دقيقة | إنهاء العروض المعلّقة بعد نافذة القبول. |
| `offers:finalize-stale` | كل 5د | إنهاء رحلات عالقة (>100د) / قبول مهجور (>20د). |
| `offers:backfill-geo --limit=12` | كل 10د | جيوكودنغ متأخّر للعروض التي فشل إثراؤها. |
| `fleet:check-sync` | كل 5د | كشف انكسار مزامنة أوبر الصامت. |
| `alerts:check` | كل 5د | تنبيهات الجلسات المكسورة / الشاردز الميتة. |
| `notifications:scan` | يومياً 08:00 | تنبيهات اشتراكات/بروكسيات قربت تنتهي. |
| `ads:expire` | كل ساعة | تعطيل الإعلانات المنتهية. |
| `network-logs:prune` | كل ساعة | إبقاء لوج الشبكة ضمن 48 ساعة. |
| `db:backup` | يومياً 03:00 | نسخة احتياطية مضغوطة (تُحفظ 7 أيام). |
| `stations:sync` | أسبوعياً (الإثنين 04:00) | تحديث جدول محطات القطارات المحلي. |
