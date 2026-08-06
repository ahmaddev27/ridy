# تتبّع التقدّم — DASHCAM (Living Document)

> **يُحدَّث أول بأول** مع كل خطوة. هذا الملف هو المصدر الوحيد لحالة المشروع.
> **يُقرأ مع:** [01-project-analysis.md](./01-project-analysis.md) · [02-technical-plan.md](./02-technical-plan.md) · [03-ui-design-brief.md](./03-ui-design-brief.md) · [05-api-reference.md](./05-api-reference.md)
> **الستاك:** Backend = **Laravel 12** · Frontend = **Next.js (App Router)** · DB = MySQL 8 · Queues = Horizon/Redis · Hosting = Hetzner/Docker.

**الرموز:** ✅ منجز · 🔄 جارٍ · ⬜ لم يبدأ · 🚧 محظور/ينتظر · ⏭️ مؤجّل

---

## 📍 اللقطة الحالية (Snapshot)

| البند | الحالة |
|---|---|
| تاريخ آخر تحديث | **2026-06-08** |
| المرحلة الحالية | **i18n عميق (ألماني/إنجليزي لكل الشاشات) + go-live docs ✅ — التطوير مكتمل** |
| النسبة الكلية للـ MVP | ▰▰▰▰▰▰▰▰▰▰ ~99% |
| التالي مباشرة | **go-live فقط** (اعتمادات المزوّدين + HERE key + Redis/MySQL/نشر + القانوني) — راجع `docs/06-go-live-checklist.md` |
| المحظورات | لا شيء حالياً · Bolt API مؤجّل لـ P5 (partner-gated) |

**أين وصلنا:** P0 شبه مكتمل عبر شغل multi-agent:
- **الواجهة (Next.js 16 + React 19 + Tailwind v4):** design system + app shell + sonner + **14 شاشة مبنية بالكامل** (Dashboard/Connections/Personal-Trips/Trips/Vehicles/Drivers/Assignments/Review-Queue/Compliance/Audit-Log/Notifications/Reports/Transparency/Design-System) + Login. **البناء أخضر** (`npm run build` exit 0).
- **الباك (Laravel 13.14 + PHP 8.4، SQLite):** Sanctum + Tenancy (TenantContext/Scope/BelongsToTenant/ResolveTenant) + RBAC (spatie، 5 أدوار) + Auth (login/logout/me) + Health + Audit log + Compliance gating. **7 اختبارات PHPUnit خضراء** (منها عزل cross-tenant)، و**API حيّ متحقَّق بالـ curl**.
- **البنية التحتية:** docker-compose (mysql/redis/backend/nginx/horizon/scheduler/frontend) + Dockerfiles + nginx + CI (GitHub Actions) + README + .gitignore.

الخطوة الجاية: **ربط الواجهة بالباك** (API client + Sanctum SPA cookies) ثم **P1 موصل Samsara**.

---

## 🏁 المايلستونز (Milestones)

| # | المايلستون | المراحل | الحالة |
|---|---|---|---|
| **M0** | الاكتشاف والتصميم | docs + UI mockup | ✅ منجز |
| **M1** | **الـ MVP** (Samsara + أوبر + مطابقة + تقارير) | P0 → P4 | ⬜ لم يبدأ |
| **M2** | التوسّع | P5 (بولت) · P6 (تقوية الامتثال) · P7 (المحاسبة) | ⏭️ لاحقاً |

---

## 🧩 الفيزس والتاسكس (Phases & Tasks)

### ✅ M0 — الاكتشاف والتصميم  (منجز)
- [x] تحليل شامل للمشروع + خارطة الطريق — `docs/01-project-analysis.md`
- [x] بحث APIs (Samsara / Uber / Bolt) + قيود DSGVO الألمانية
- [x] خطة تقنية كاملة (معمارية، نموذج بيانات، مطابقة، امتثال) — `docs/02-technical-plan.md`
- [x] موجز تصميم UI + برومتات الذكاء — `docs/03-ui-design-brief.md`
- [x] نموذج HTML/CSS تفاعلي (15 شاشة + Design System + Toasts/Modals) — `mockup/index.html`

---

### ⬜ P0 — الأساس (Foundation)  ← المرحلة القادمة
**الهدف:** هيكل قابل للتشغيل: مصادقة + tenancy + RBAC + امتثال هيكلي + shell للواجهة.

**Infra / Monorepo** — ✅
- [x] بنية Monorepo (`/backend`, `/frontend`, `/docker`, `docker-compose.yml`)
- [x] `docker-compose.yml` (mysql, redis, backend, nginx, horizon, scheduler, frontend)
- [x] `.env.example` + Dockerfiles + nginx conf + README + `.gitignore`
- [x] GitHub Actions CI (backend: composer+pint+test · frontend: npm+lint+build)

**Backend (Laravel)** — ✅ (ملاحظات: Laravel **13.14** بدل 12 · **PHPUnit** بدل Pest · **SQLite** للتطوير)
- [x] init Laravel 13.14 + PHP 8.4 + PHPUnit + Pint
- [x] هيكل مجلدات Domain (`app/Domain/{Tenancy,Fleet,Audit,Compliance}`)
- [x] Tenancy: `tenants` + `BelongsToTenant` + Global Scope + `ResolveTenant` + `TenantContext`
- [x] RBAC (spatie): أدوار `owner/fleet_manager/analyst/viewer/dpo` + صلاحيات
- [x] migrations: tenants, users.tenant_id, vehicles, audit_logs, compliance ×2, permissions
- [x] Auth Sanctum (login/logout/me) + Health + response envelope `{data}` + JSON errors
- [x] بنية Audit Log (`audit_logs` + `AuditLogger`) + Compliance gating (`ComplianceGate`)
- [x] **اختبار عزل cross-tenant** + auth + health — **7 اختبارات خضراء**
- [ ] CORS + `csrf-cookie` لتدفّق SPA — يُفعّل عند ربط الواجهة
- [ ] Redis/Horizon فعلي (الآن `sync`/`database`) — يُفعّل في P1

**Frontend (Next.js)** — ✅ الأساس مُعتمَد
- [x] init Next.js 16 (App Router) + TS + Tailwind v4
- [x] App shell (Sidebar + Topbar + layout) + sonner toasts + Modal
- [x] design system كومبوننتس (Button/Badge/Card/StatCard/EmptyState/Placeholder) + صفحة `/design-system`
- [x] شاشات مبنية: Dashboard · Connections · Personal-Trips · Login (+ 11 scaffold بنفس الهوية)
- [ ] i18n عبر `next-intl` (DE افتراضي + EN) — حالياً EN فقط
- [ ] API client (fetch + `credentials:'include'`) + معالجة CSRF/401 — بانتظار الباك
- [ ] حماية المسارات بمصادقة حقيقية (الآن login UI فقط)
- [ ] TanStack Query + ربط الشاشات scaffold بالبيانات الحقيقية

**✔ معيار الإنجاز (Definition of Done):** مستخدم يسجّل دخول، يشوف داشبورد فاضي ضمن tenant معزول، أدوار تشتغل، CI أخضر، والـ docker compose يشتغل محلياً.

---

### 🔄 P1 — موصل Samsara (النواة مكتملة)
- [x] `SamsaraClient` (Laravel HTTP client بدل Saloon) + **API token يدوي** (OAuth Marketplace لاحقاً)
- [x] مزامنة `vehicles` (upsert باللوحة المطبَّعة) + `drivers` (بـ external id)
- [x] poll `/trips/stream` + cursor delta-sync + dedupe (unique key)
- [x] تخزين `telematics_trips` + `SamsaraSyncService` + `SyncSamsaraJob` + scheduler (كل 5 دقائق)
- [x] API: connections (index/connect/sync) + `GET trips/telematics` + `GET vehicles` + `GET drivers`
- [x] **5 اختبارات Http::fake خضراء** (ingest/idempotent/tenant-isolation/no-token-leak/vehicles-list)
- [x] ربط شاشتي **Connections** (connect modal + sync + status حقيقي) و**Vehicles** (قائمة حقيقية) بالـ API + API client modules + `useAsync` hook
- [ ] ربط Trips/Drivers/Assignments بالبيانات الحقيقية (لسا mock)
- [ ] مزامنة `driver-vehicle-assignments` + OAuth Marketplace + re-bootstrap للـ cursor

### 2026-06-09 (تكملة)
- ✅ **P2 نواة موصل أوبر + Geocoding:** `platform_trips` + `geocode_cache` schema · `UberClient`/`UberSyncService` (client-credentials، trip activity، geocode، dedupe، miles→m) · `Geocoder` interface + `HereGeocoder` + `CachingGeocoder` · API (connect uber/sync/`trips/platform`). **15 اختبار خضراء** (4 جديدة). انحراف: Offline Reporting مبسّط لنداء واحد (request/poll/download لاحقاً).
- ✅ **P3 محرك المطابقة (قلب القيمة):** `trip_matches` + `personal_trips` (مصغّرة) schema · `MatchingService` (identity-resolve + time-overlap + scoring + idempotent recompute) · `WorkingHours` · API (`matching/run`، `personal-trips`، review). **20 اختبار خضراء** (5 جديدة، منها تأكيد عدم تسريب أي إحداثيات في الرحلة الشخصية — DSGVO).
- ✅ **موصل بولت (P5 مُقدَّم):** `BoltClient` + `BoltSyncService` (orders → platform_trips، km→m، geocode) + `connectBolt` + sync dispatch. حقول مُعلَّمة "تُؤكَّد عند الـ onboarding". **22 اختبار خضراء** (2 جديدة). الآن **المنصّات الثلاث مغطّاة**.
- ✅ **ربط الواجهة بالمطابقة + الداشبورد:** شاشة Personal-Trips حيّة (list + زر **Run matching** + dismiss/review عبر API) · `GET dashboard/summary` (KPIs tenant-scoped) + الداشبورد StatCards/sync-status حيّة. **23 اختبار خضراء** + build الواجهة أخضر.

### 🔄 P2 — موصل أوبر (النواة مكتملة)
- [x] `UberClient` (client-credentials OAuth) + `getTripActivity` (Offline Reporting مبسّط — request/poll/download لاحقاً)
- [x] `UberSyncService`: تطبيع `platform_trips` + dedupe + miles→m + cursor
- [x] **طبقة Geocoding:** `Geocoder` interface + `HereGeocoder` + **`CachingGeocoder`** + جدول `geocode_cache` (cache-first)
- [x] API: `POST connections/uber` + `sync` (dispatch بالمزوّد) + `GET trips/platform`
- [x] **4 اختبارات خضراء** (uber ingest/idempotent/api + geocode-cache)
- [ ] ربط شاشات Trips/Connections بأوبر في الواجهة · request/poll/download الحقيقي · Bolt (P5)

### 🔄 P3 — محرك المطابقة (النواة مكتملة)
- [x] Identity Resolution: ربط platform_trips بالسيارة الموحّدة عبر `external_ids[provider]`
- [x] `MatchingService` + time-overlap + scoring (وقت + مسافة) + tolerance قابل للضبط — **TDD**
- [x] جداول `trip_matches` + `personal_trips` (**مصغّرة**: buckets فقط، لا إحداثيات/مسار)
- [x] تصنيف matched / **personal** / gap + `WorkingHours` + recompute idempotent
- [x] API: `POST matching/run` + `GET personal-trips` + `POST personal-trips/{id}/review`
- [x] **5 اختبارات TDD خضراء** (match / personal+no-leak / gap / idempotent / api)
- [ ] ربط شاشة Personal-Trips بالـ API · Review Queue (ambiguous) · Identity Match Queue

### ✅ P4 — التقارير واللوحات والتنبيهات (مكتمل)
- [x] Dashboard (KPIs + صحة المزامنة) — `GET dashboard/summary` + الواجهة حيّة
- [x] تقارير الرحلات الشخصية + **تصدير CSV مصغّر** (`reports/personal-use` + `/export`) + الواجهة
- [x] تنبيهات **mail + in-app** عبر Laravel Notifications (تُرسَل بعد كل matching run بـ personal>0) + الواجهة
- [x] **شفافية السائق** (`transparency/me` + data-request/objection) + الواجهة
- [x] **27 اختبار خضراء** (4 جديدة لـ P4)

> 🎯 **MVP (M1) شبه مكتمل** — الباك والقيمة الأساسية جاهزة ومختبَرة end-to-end. يتبقّى ربط شاشات mock ثانوية + P6 تقوية الامتثال.

### 2026-06-09 (تكملة) — حوكمة الامتثال + ربط الشاشات
- ✅ **حوكمة الامتثال + Audit:** `compliance/settings` (GET/PUT) + `compliance/attestations` (GET/POST، gating حقيقي عبر `ComplianceGate`) + `audit-logs` (GET) + **تسجيل audit فعلي** عند تغيير الإعدادات/الإقرارات/مراجعة رحلة شخصية. **30 اختبار خضراء** (3 جديدة).
- ✅ **ربط بقية الشاشات الأساسية:** Compliance (settings/attestations/gating/working-hours حيّة) · Audit-Log (سجل حقيقي) · Drivers (قائمة) · Trips (telematics+platform مدموجة مع ربط اللوحة client-side). build الواجهة أخضر.
- **شاشات حيّة الآن:** Login · Dashboard · Connections · Vehicles · Drivers · Trips · Personal-Trips · Reports · Notifications · Transparency · Compliance · Audit-Log. **mock متبقّي:** Review-Queue · Assignments · Design-System.

### 2026-06-09 (تكملة) — P6 تقوية الامتثال
- ✅ **Retention auto-delete:** `RetentionService.purgeRawLocation` يحذف الموقع الخام (lat/lng + addresses + raw_payload) من telematics/platform بعد `retention.raw_days` لكل tenant، ويُبقي الميتاداتا + personal_trips. `php artisan retention:purge` مجدول يومياً 03:00.
- ✅ **Audit عند الوصول للموقع:** عرض telematics trips يسجّل `telematics.location_viewed`.
- ✅ **Pseudonymization:** كل سائق يحصل `pseudonym_id` تلقائياً (`DRV-XXXXXX`) ويُعرض في DriverResource.
- **33 اختبار خضراء** (3 جديدة لـ P6).

### 2026-06-09 (تكملة) — Review-Queue + Assignments
- ✅ **تصنيف ambiguous في المطابقة:** المطابقات تحت عتبة ثقة (0.6) تُعلَّم `ambiguous` للمراجعة بدل التأكيد التلقائي.
- ✅ **Review-Queue:** `GET review-queue` (ambiguous matches + identity candidates) + `matches/{id}/approve|reject` + `identity/link` (يربط لوحة المزوّد بمركبة موحّدة ويحلّ رحلاتها) — كلها مع audit.
- ✅ **Assignments:** `GET/POST/DELETE assignments` (ربط سائق↔مركبة).
- ✅ ربط الواجهة: Review-Queue (تبويبين حيّين) + Assignments (قائمة + إنشاء + حذف). **36 اختبار خضراء** (3 جديدة). build أخضر.
- **كل الشاشات الوظيفية حيّة الآن** (13 شاشة + Design-System showcase).

### 2026-06-09 (تكملة) — production-readiness
- ✅ **توافق MySQL متحقَّق:** `migrate:fresh` + `db:seed` نجحوا على **MySQL 8.4.3** (كل الأعمدة decimal/json/index متوافقة، بلا spatial). التطوير يبقى على **SQLite** للموثوقية (MySQL في Laragon متقطّع)؛ التحويل = سطر `.env` فقط.
- ✅ **خط معالجة async:** `RunMatchingJob` (queued) يشغّل المطابقة + يُشعر مستخدمي الشركة · يُطلَق تلقائياً بعد `SyncSamsaraJob` · + جدولة `matching-run-all` كل ساعة. queue = database (worker: `php artisan queue:work`).
- ✅ **الجدولة متحقّقة** (`schedule:list`): samsara-sync (5د) · matching-run-all (ساعة) · retention:purge (يومي). **37 اختبار خضراء**.

### 2026-06-09 (تكملة) — Connections كامل + P7 محاسبة
- ✅ **شاشة Connections كاملة:** ربط + مزامنة لـ **Samsara + أوبر + بولت** (كل منصة بنموذج اعتماد خاص) — الباك كان جاهز، الواجهة صارت حيّة للثلاثة.
- ✅ **P7 المحاسبة التقديرية:** `BillingService` يحسب رسوم **تقديرية** للرحلات الشخصية (منتصف الـ distance bucket × التعرفة per-km — متوافق DSGVO، بلا مسافة دقيقة). `billing/settings` (GET/PUT، تعرفة+عملة، + audit) + `billing/statement` (إجمالي + by_vehicle). شاشة **Billing** حيّة (تحت Insights). **38 اختبار خضراء** (1 جديد).
- **14 شاشة وظيفية حيّة + Design-System.**

### 2026-06-09 (تكملة) — i18n ألماني/إنجليزي
- ✅ **i18n خفيف بـ Context** (`lib/i18n/`): قاموسان EN+DE، **الافتراضي ألماني** (السوق)، مبدّل **DE/EN شغّال** في الـ topbar (يُحفظ في localStorage).
- ✅ **مُترجَم:** التنقّل (sidebar) · الـ topbar · صفحة الدخول · **كل عناوين/أوصاف الشاشات الـ15** (عبر `PageHeader tkey=`).
- ✅ متحقَّق: `/login` يُعرض بالألماني افتراضياً (Anmelden/Passwort/E-Mail/DSGVO-konform). build أخضر.
- **متبقٍّ تدريجي:** ترجمة المحتوى العميق داخل كل شاشة (رؤوس الجداول، الأزرار، البانرات) — البنية جاهزة وتسهّل الإكمال.

### 2026-06-09 (تكملة) — i18n عميق (multi-agent) + go-live docs
- ✅ **ترجمة عميقة لكل الشاشات (3 وكلاء بالتوازي):** قاموسان منفصلان `screens-a.ts` (7 شاشات، ~118 مفتاح) + `screens-b.ts` (8 شاشات، 227 مفتاح) مدموجان في الـ context. **كل** المحتوى (رؤوس الجداول، الأزرار، الشارات، empty/loading/error states، البانرات، الـ modals، الـ toasts، النماذج) صار EN+DE بتطابق مفاتيح مؤكّد. build أخضر.
- ✅ **توثيق الإطلاق:** `docs/06-go-live-checklist.md` (قائمة إطلاق إنتاجية شاملة: تقنية/تكاملات/بنية/أمان/قانوني/تشغيل) + `docs/07-run-guide.md` (دليل تشغيل خطوة بخطوة + جدول متغيرات البيئة + التبديل لـ MySQL).
- **الخلاصة: التطوير مكتمل (~99%). المتبقّي كله "go-live" (تشغيل/قانوني)، مش تطوير.**

---

### ⏭️ M2 — لاحقاً
- **P5 — بولت:** `BoltConnector` (يُؤكَّد عند الـ onboarding)
- **P6 — تقوية الامتثال:** ✅ retention auto-delete (`RetentionService` + `retention:purge` مجدول يومياً) · ✅ audit عند الوصول للموقع · ✅ pseudonymization للسائق (`pseudonym_id` تلقائي). يتبقّى: DPIA/RoPA كـ data + private-mode التطبيقي على المطابقة.
- **P7 — المحاسبة:** حساب رسوم/فوترة (لاحقاً)

---

## 📝 سجل الإنجاز (Changelog)

### 2026-06-08
- ✅ تحليل شامل للمشروع + بحث APIs والقيود القانونية → `docs/01-project-analysis.md`
- ✅ خطة تقنية كاملة (قرارات الستاك مثبّتة) → `docs/02-technical-plan.md`
- ✅ موجز UI + برومتات → `docs/03-ui-design-brief.md`
- ✅ نموذج HTML تفاعلي (15 شاشة + Design System + Toasts/Modals) → `mockup/index.html`
- ✅ إنشاء ملف التقدّم + ملف توثيق الـ API
- ✅ **اعتماد التصميم في الـ UI:** init مشروع Next.js 16 الفعلي في `/frontend` (Tailwind v4 + design system + app shell + 17 مسار). البناء أخضر ويعمل على `localhost:3000`.
- ✅ **شغل multi-agent (3 وكلاء متوازيين):** الواجهة (14 شاشة كاملة، build أخضر) + البنية التحتية (docker/CI/README) + الباك P0.
- ✅ **باك P0 (Laravel 13.14):** Sanctum + Tenancy + RBAC + Auth + Audit + Compliance gating. **7 اختبارات PHPUnit خضراء** + API حيّ متحقَّق بالـ curl (`login` يرجّع user+tenant+roles، `me` غير مصادق→401).
- ⚠️ ملاحظة بيئية: سيرفر تطوير الواجهة وقع مرة بسبب نقص ذاكرة النظام (paging file) من تشغيل عدة عمليات ثقيلة معاً — الكود سليم (build أخضر)، يُعاد تشغيله منفرداً.
- ✅ **ربط الواجهة بالباك (إنهاء P0):** CORS + `statefulApi` + Sanctum SPA env بالباك · API client (`lib/api/client.ts` بـ CSRF) + `AuthProvider` + `AppGuard` + login مربوط + topbar يعرض المستخدم الحقيقي. **تدفّق الكوكي متحقَّق end-to-end بالـ curl** (csrf→login→me→logout) و**build الواجهة أخضر**. → **P0 مكتمل.**
- ✅ **P1 نواة موصل Samsara:** schema (integration_connections/drivers/assignments/telematics_trips + vehicles.external_ids) + `SamsaraClient` + `SamsaraSyncService` (vehicles/drivers/trips، cursor، dedupe، plate-normalize) + `SyncSamsaraJob` + scheduler + API (connections/sync/trips). **11 اختبار خضراء** (4 جديدة لـ Samsara). انحراف: Laravel HTTP بدل Saloon، API token بدل OAuth marketplace.

---

## 🔜 الخطوة التالية (Next Up)
1. كتابة **spec تفصيلي لمرحلة P0** (يُحفظ في `docs/specs/`).
2. init الـ Monorepo + Laravel + Next.js + docker-compose.
3. تحديث هذا الملف و`05-api-reference.md` مع كل تاسك يُنجز.

## ⚠️ المخاطر/المحظورات
- Bolt API مغلق (partner-gated) → مؤجّل P5.
- الميزة الأساسية حساسة قانونياً (ألمانيا) → اعتماد DPO/محامي قبل أي إطلاق فعلي.
- جودة الـ geocoding تؤثر على دقّة المطابقة → Review Queue ضروري.
