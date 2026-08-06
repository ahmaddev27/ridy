# مرجع الـ API للباك (Laravel) — DASHCAM (Living Document)

> **يُحدَّث أول بأول** مع كل endpoint يُبنى. الفرونت (Next.js) يستهلك هذا العقد.
> **يُقرأ مع:** [02-technical-plan.md](./02-technical-plan.md) · [04-progress.md](./04-progress.md)
> **الحالة العامة:** ⬜ لم يُبنَ أي endpoint بعد — هذا العقد المخطّط لمرحلة P0→P4.

**رموز الحالة:** ✅ مُنفّذ ومختبَر · 🔄 جارٍ · ⬜ مخطّط

---

## 1. الاتفاقيات العامة (Conventions)

- **Base URL:** `https://api.dashcam.de/api/v1` (محلياً `http://localhost:8080/api/v1`)
- **التنسيق:** JSON فقط. الترميز UTF-8. الأوقات **UTC** بصيغة ISO-8601.
- **المصادقة:** **Sanctum SPA (cookies)** — الفرونت أول-طرف على نفس الدومين الأب.
  - قبل أي طلب كتابة: `GET /sanctum/csrf-cookie` لجلب كوكي `XSRF-TOKEN`.
  - الطلبات ترسل `credentials: 'include'` + هيدر `X-XSRF-TOKEN`.
- **العزل:** كل طلب يُحلّ الـ `tenant` من المستخدم المصادق (لا يُمرَّر `tenant_id` من العميل).
- **التفويض:** RBAC — أدوار `owner/fleet_manager/analyst/viewer/dpo`. الوصول للموقع الخام need-to-know.

### مغلّف الاستجابة (Response Envelope)
```jsonc
// نجاح (عنصر)
{ "data": { ... } }

// نجاح (قائمة مع صفحات)
{ "data": [ ... ], "meta": { "current_page": 1, "per_page": 20, "total": 134, "last_page": 7 } }
```
### تنسيق الخطأ
```jsonc
{ "message": "The given data was invalid.", "errors": { "email": ["..."] } }
```
### أكواد الحالة
`200` OK · `201` Created · `204` No Content · `400` Bad Request · `401` Unauthenticated · `403` Forbidden · `404` Not Found · `409` Conflict · `422` Validation · `429` Too Many Requests · `500` Server Error.

### الصفحات والفلترة
`?page=1&per_page=20&sort=-start_time&filter[vehicle_id]=...&filter[date_from]=...&filter[date_to]=...`

---

## 2. المصادقة (Auth) — P0

| الحالة | Method | Path | الوصف |
|---|---|---|---|
| ✅ | GET | `/sanctum/csrf-cookie` | جلب كوكي CSRF (خارج `/api/v1`) — مُفعّل، الواجهة مربوطة |
| ✅ | POST | `/api/v1/login` | تسجيل دخول (email, password) → user + tenant + roles |
| ✅ | POST | `/api/v1/logout` | تسجيل خروج |
| ✅ | GET | `/api/v1/me` | المستخدم الحالي + الـ tenant + الأدوار/الصلاحيات |
| ✅ | GET | `/api/v1/health` | فحص صحة الخدمة |

> **مُتحقَّق بالـ curl (2026-06-09):** `health`→200 · `login` صحيح→200 يرجّع user+tenant+roles+permissions · `me` بدون مصادقة→401 · `login` خطأ→422.
> **تدفّق Sanctum SPA (cookies) متحقَّق end-to-end:** `csrf-cookie`→204 → `login` (X-XSRF-TOKEN)→200 → `me` (بكوكي الجلسة)→200 → `logout`→204. الواجهة (`frontend/src/lib/api/`) مربوطة ومحميّة (`AuthProvider`+`AppGuard`).

<details><summary>أمثلة P0</summary>

```http
POST /api/v1/login
{ "email": "manager@fleet.de", "password": "secret" }
→ 204 No Content   (الكوكي تُضبط)
```
```http
GET /api/v1/me
→ 200 { "data": { "id": 1, "name": "M. Köhler", "tenant": {"id": 4, "name": "Berlin Cabs GmbH"}, "roles": ["fleet_manager"], "permissions": ["trips.view", ...] } }
```
</details>

---

## 3. الإدارة والمستخدمون (Identity) — P0

| الحالة | Method | Path | الوصف |
|---|---|---|---|
| ⬜ | GET | `/api/v1/users` | قائمة مستخدمي الـ tenant |
| ⬜ | POST | `/api/v1/users` | دعوة/إنشاء مستخدم (دور) |
| ⬜ | PATCH | `/api/v1/users/{id}` | تعديل دور/حالة |
| ⬜ | DELETE | `/api/v1/users/{id}` | إزالة مستخدم |
| ⬜ | GET | `/api/v1/roles` | الأدوار والصلاحيات المتاحة |

---

## 4. الموصّلات (Connections) — P1/P2/P5

| الحالة | Method | Path | الوصف |
|---|---|---|---|
| ✅ | GET | `/api/v1/connections` | حالة الموصّلات (samsara/uber/bolt) — `{data:[{provider,status,last_synced_at}]}` |
| ✅ | POST | `/api/v1/connections/samsara` | ربط Samsara بـ **API token** (`{api_token}`) → 201 |
| ✅ | POST | `/api/v1/connections/uber` | ربط أوبر (`{client_id,client_secret,org_id}`) → 201 |
| ✅ | POST | `/api/v1/connections/bolt` | ربط بولت (`{client_id,client_secret,company_id}`) → 201 |
| ✅ | POST | `/api/v1/connections/{provider}/sync` | مزامنة يدوية (samsara/uber/bolt) → `{data:{...}}` |
| ✅ | GET | `/api/v1/dashboard/summary` | KPIs: vehicles/drivers/trips_today/personal_flagged + connections |
| ⬜ | GET | `/api/v1/connections/{provider}/authorize` | OAuth Marketplace (لاحقاً، بدل التوكن اليدوي) |
| ⬜ | DELETE | `/api/v1/connections/{provider}` | فصل المزوّد |

---

## 5. الأسطول (Fleet) — P1

| الحالة | Method | Path | الوصف |
|---|---|---|---|
| ✅ | GET | `/api/v1/vehicles` | قائمة المركبات (صفحات) `{data:[{plate,name,vin,make,model,providers[]}]}` |
| ⬜ | POST | `/api/v1/vehicles` | إضافة مركبة يدوياً |
| ⬜ | GET | `/api/v1/vehicles/{id}` | تفاصيل + الهوية الموحّدة عبر المزوّدين |
| ⬜ | PATCH | `/api/v1/vehicles/{id}` | تعديل |
| ✅ | GET | `/api/v1/drivers` | قائمة السواقين (صفحات) |
| ⬜ | GET | `/api/v1/drivers/{id}` | تفاصيل سائق |
| ✅ | GET | `/api/v1/assignments` | ربط سائق↔مركبة (قائمة) |
| ✅ | POST | `/api/v1/assignments` | إنشاء assignment |
| ✅ | DELETE | `/api/v1/assignments/{id}` | حذف assignment |

---

## 6. الرحلات والمطابقة (Trips & Matching) — P2/P3

| الحالة | Method | Path | الوصف |
|---|---|---|---|
| ✅ | GET | `/api/v1/trips/telematics` | رحلات Samsara (مصفوفة، صفحات) `{data:[...],meta,links}` |
| ✅ | GET | `/api/v1/trips/platform` | رحلات المنصات (أوبر) — عناوين + geocoded + مسافة/سعر |
| ⬜ | GET | `/api/v1/trips` | رحلات telematics + platform موحّدة (فلترة) — P3 |
| ⬜ | GET | `/api/v1/trips/{id}` | تفاصيل رحلة |
| ✅ | GET | `/api/v1/review-queue` | `{ambiguous:[...], identity:[...]}` (مطابقات غامضة + لوحات غير محلولة) |
| ✅ | POST | `/api/v1/matches/{id}/approve` | تأكيد مطابقة غامضة (+ audit) |
| ✅ | POST | `/api/v1/matches/{id}/reject` | رفض مطابقة (+ audit) |
| ✅ | POST | `/api/v1/identity/link` | `{provider,provider_vehicle_id,vehicle_id}` يربط ويحلّ الرحلات (+ audit) |

---

## 7. الرحلات الشخصية والتقارير (Personal Trips & Reports) — P3/P4

| الحالة | Method | Path | الوصف |
|---|---|---|---|
| ✅ | POST | `/api/v1/matching/run` | تشغيل محرك المطابقة → `{data:{matched,personal,gaps}}` |
| ✅ | GET | `/api/v1/personal-trips` | الرحلات الشخصية المُعلَّمة (**buckets فقط**: vehicle, within_working_window, duration/distance bucket) |
| ✅ | POST | `/api/v1/personal-trips/{id}/review` | `{status: reviewed\|dismissed}` |
| ⬜ | GET | `/api/v1/personal-trips/{id}` | تفاصيل مصغّرة + access trail |
| ✅ | GET | `/api/v1/reports/personal-use` | تجميعات لكل مركبة (total + outside-hours + by_vehicle) |
| ✅ | GET | `/api/v1/reports/personal-use/export` | تصدير CSV **مصغّر** (بلا إحداثيات/عناوين) |
| ✅ | GET/PUT | `/api/v1/billing/settings` | تعرفة per-km + عملة (PUT + audit) |
| ✅ | GET | `/api/v1/billing/statement` | رسوم **تقديرية** (bucket midpoint × rate) + by_vehicle |

> ⚠️ **DSGVO:** `personal-trips` لا يُرجِع أبداً polyline/وجهة — فقط buckets (مدة/مسافة) + within/outside working hours.

---

## 8. الامتثال والحوكمة (Compliance) — P0/P6

| الحالة | Method | Path | الوصف |
|---|---|---|---|
| ✅ | GET | `/api/v1/compliance/settings` | ساعات العمل، retention، private mode، regime |
| ✅ | PUT | `/api/v1/compliance/settings` | تحديث الإعدادات (+ audit) |
| ✅ | GET | `/api/v1/compliance/attestations` | حالة works agreement + DPIA + `detection_enabled` |
| ✅ | POST | `/api/v1/compliance/attestations` | تسجيل attestation (يفتح gating) (+ audit) |
| ✅ | GET | `/api/v1/audit-logs` | سجل الوصول/التغييرات (append-only، tenant-scoped) |

---

## 9. التنبيهات (Notifications) — P4

| الحالة | Method | Path | الوصف |
|---|---|---|---|
| ✅ | GET | `/api/v1/notifications` | قائمة الإشعارات + `meta.unread` |
| ✅ | POST | `/api/v1/notifications/read` | تعليم الكل مقروء |

---

## 10. شفافية السائق (Driver Transparency) — P4

| الحالة | Method | Path | الوصف |
|---|---|---|---|
| ✅ | GET | `/api/v1/transparency/me` | ما يُجمع/لا يُجمع + الأساس القانوني + retention/mode/regime + Art.13 |
| ✅ | POST | `/api/v1/transparency/data-request` | طلب بيانات (Art.15) → 202 + audit |
| ✅ | POST | `/api/v1/transparency/object` | اعتراض (Art.21) → 202 + audit |

---

## ملاحظة تحديث
> عند بناء أي endpoint: غيّر حالته إلى ✅، أضف مثال طلب/استجابة فعلي، وحدّث `04-progress.md`.
