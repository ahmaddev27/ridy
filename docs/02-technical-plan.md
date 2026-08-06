# الخطة التقنية (Technical Design) — منصة DASHCAM

> **يُقرأ مع:** [01-project-analysis.md](./01-project-analysis.md) (التحليل الشامل وخارطة الطريق).
> **النطاق:** التصميم التقني الكامل للـ MVP (المراحل P0–P4) + أساس قابل للتوسّع للمراحل اللاحقة.
> **الحالة:** خطة تقنية معتمدة القرارات — جاهزة لاشتقاق specs لكل مرحلة.

---

## 0. القرارات التقنية المثبّتة

| المجال | القرار | ملاحظة |
|---|---|---|
| Backend | **Laravel 12 + PHP 8.3+** | Modular Monolith، clean architecture |
| تنظيم الكود | **مجلدات Domain داخل `app/Domain/*`** | بدون حزمة modules |
| قاعدة البيانات | **MySQL 8** | spatial (`POINT` + `ST_Distance_Sphere`) للتأكيد الجغرافي |
| التعددية | **DB مشترك + `tenant_id` + Global Scopes** | عزل على مستوى التطبيق |
| Queues/Jobs | **Laravel Horizon + Redis** | pollers، matching، retention، notifications |
| Frontend | **Next.js (App Router) + React** SPA منفصل | i18n ألماني+إنجليزي عبر `next-intl` |
| المصادقة | **Laravel Sanctum (SPA / cookies)** | first-party، httpOnly، CSRF |
| التفويض | **spatie/laravel-permission** (RBAC) | أدوار وصلاحيات لكل tenant |
| API | **REST داخلي، `/api/v1`** | حدود نظيفة للفتح للعام لاحقاً |
| Connectors | **Saloon (PHP SDK)** لكل مزوّد | OAuth + retries + rate limit + اختبار سهل |
| Geocoding | **HERE** خلف `GeocoderInterface` | أوروبي مُدار + DPA؛ قابل للاستبدال |
| Notifications | **بريد + in-app** (Laravel Notifications) | قنوات mail + database |
| الاستضافة | **Hetzner (ألمانيا)** | إقامة بيانات داخل الـ EU (DSGVO) |
| النشر | **Docker Compose** | app, mysql, redis, horizon, scheduler, nginx |
| المستودع | **Monorepo** (`/backend`, `/frontend`) | تنسيق إصدارات أسهل |
| الاختبارات | **Pest** (+ TDD لمحرك المطابقة) | |
| Error tracking | **Sentry (EU region)** | + structured logging |

---

## 1. المعمارية عالية المستوى

```
┌──────────────┐      cookies (Sanctum SPA)      ┌────────────────────────────┐
│ Next.js SPA  │ ───────────────────────────────►│  Laravel REST API /api/v1  │
│ (dashboard)  │◄─────────── JSON ───────────────│  Controllers (thin)        │
└──────────────┘                                 │     ↓ Services             │
                                                  │     ↓ Repositories         │
                                                  │     ↓ Models (MySQL)       │
                                                  └──────────┬─────────────────┘
                                                             │ dispatch jobs
                                   ┌─────────────────────────▼─────────────────────────┐
                                   │  Horizon (Redis queues) + Scheduler                │
                                   │  • IngestionJobs (Samsara/Uber/Bolt pollers)       │
                                   │  • MatchingJobs (trip matching per vehicle/window) │
                                   │  • RetentionJobs / NotificationJobs                │
                                   └───────┬──────────────┬──────────────┬─────────────┘
                                           │              │              │
                                      Samsara API     Uber API       Bolt API   + HERE Geocoding
                                      (Saloon)        (Saloon)       (Saloon)
```

**نمطان للتشغيل:**
- **متزامن (sync):** طلبات الـ SPA → REST → Services → DB (قراءة/كتابة سريعة، لا I/O خارجي ثقيل).
- **غير متزامن (async):** كل تكامل خارجي (سحب رحلات، geocoding، مطابقة، حذف retention، تنبيهات) عبر **queued jobs** على Horizon — لا يحجب الطلبات.

---

## 2. بنية المستودع (Monorepo)

```
DASHCAM/
├─ docs/                      # 01-project-analysis.md, 02-technical-plan.md, specs/*
├─ backend/                   # Laravel
│  ├─ app/
│  │  ├─ Domain/              # ← قلب التنظيم (bounded contexts)
│  │  │  ├─ Tenancy/          # Tenant, الـ tenant resolution, BelongsToTenant
│  │  │  ├─ Identity/         # Users, Roles, RBAC, onboarding
│  │  │  ├─ Fleet/            # Drivers, Vehicles, Assignments, IdentityResolution
│  │  │  ├─ Integrations/     # Connectors (Samsara/Uber/Bolt), tokens, cursors
│  │  │  ├─ Ingestion/        # Normalizers, sync jobs, raw payload store
│  │  │  ├─ Matching/         # MatchingEngine, scoring, review queue
│  │  │  ├─ Trips/            # TelematicsTrip, PlatformTrip, PersonalTrip
│  │  │  ├─ Reporting/        # dashboards, exports, alerts
│  │  │  ├─ Compliance/       # gating, retention, audit, pseudonymization
│  │  │  └─ Geocoding/        # GeocoderInterface + HERE driver + cache
│  │  ├─ Http/                # Controllers (thin), FormRequests, Resources, Middleware
│  │  └─ Support/             # shared helpers, value objects
│  ├─ database/migrations/
│  ├─ routes/api.php          # /api/v1
│  └─ tests/                  # Pest (Unit + Feature)
├─ frontend/                  # Next.js (App Router)
│  ├─ app/[locale]/...        # i18n routes (next-intl)
│  ├─ lib/api/                # API client (fetch + cookies)
│  └─ components/
├─ docker/                    # Dockerfiles, nginx conf
└─ docker-compose.yml
```

**كل Domain** يحتوي داخلياً على: `Models/`, `Services/`, `Repositories/` (+ `Contracts/`), `Jobs/`, `DTOs/`, `Actions/` حسب الحاجة. القاعدة: **Controllers رفيعة → Services (منطق العمل) → Repositories (الوصول للبيانات) → Models**، مع DI و interfaces.

---

## 3. التعددية (Multi-tenancy)

- جدول **`tenants`** (الشركة = tenant). كل جدول tenant-scoped فيه `tenant_id` (FK + index).
- **`BelongsToTenant` trait** على الـ Models: يطبّق **Global Scope** يحقن `where tenant_id = current_tenant` تلقائياً، ويملأ `tenant_id` عند الإنشاء.
- **TenantContext** (singleton مربوط بالطلب) يُحلّ من **المستخدم المصادق** (كل user ينتمي لـ tenant) عبر middleware `ResolveTenant`. لا نعتمد على subdomain في الـ MVP.
- **الـ Jobs:** كل job يحمل `tenant_id` ويعيد ضبط `TenantContext` عند التنفيذ (مهم — الـ jobs خارج دورة الطلب).
- **حماية:** اختبار feature يتأكد أن tenant A لا يرى بيانات tenant B (cross-tenant isolation test إلزامي).
- مسار الترقية المستقبلي لـ DB-per-tenant محفوظ عبر عزل الوصول داخل Repositories.

---

## 4. المصادقة والتفويض

**المصادقة — Sanctum SPA (cookies):**
- Next.js و Laravel على **نفس الدومين الأب** (مثلاً `app.dashcam.de` + `api.dashcam.de`) → cookies `SameSite`.
- التدفّق: `GET /sanctum/csrf-cookie` → `POST /login` (يُنشئ session cookie httpOnly) → الطلبات اللاحقة تحمل الكوكي تلقائياً.
- إعداد `config/cors.php` (`supports_credentials=true`)، `SANCTUM_STATEFUL_DOMAINS`, `SESSION_DOMAIN`.

**التفويض — RBAC (spatie/laravel-permission):**
- أدوار مبدئية لكل tenant: `owner`, `fleet_manager`, `analyst`, `viewer` (+ دور خاص `dpo`/`compliance` للوصول للبيانات الحساسة).
- **Policies** لكل مورد حساس (telematics_trips، personal_trips، audit_logs). الوصول للموقع الخام مقيّد بـ `need-to-know` (DSGVO قاعدة 5,7).
- كل صلاحية وصول لبيانات الموقع تُسجَّل في **audit log** (قاعدة 6).

---

## 5. نموذج البيانات والـ Migrations (تفصيل)

> توسعة لقسم 5 في التحليل، مع المفاتيح والفهارس.

| الجدول | أعمدة مفتاحية | فهارس/ملاحظات |
|---|---|---|
| `tenants` | id, name, status, country, settings(json) | |
| `users` | id, **tenant_id**, name, email, password | unique(email) |
| `roles`/`permissions`/`model_has_*` | (spatie) | scoped بـ tenant عبر team_id |
| `integration_connections` | id, **tenant_id**, provider(enum), `credentials`(encrypted json), external_org_id, status, `sync_cursors`(json), last_synced_at | unique(tenant_id, provider) |
| `drivers` | id, **tenant_id**, name, phone, license_no, employment_type, `external_ids`(json), `pseudonym_id` | index(tenant_id), index(phone), index(license_no) |
| `vehicles` | id, **tenant_id**, **`plate_normalized`**, vin, make, model, `external_ids`(json) | unique(tenant_id, plate_normalized), index(vin) |
| `driver_vehicle_assignments` | id, **tenant_id**, vehicle_id, driver_id, start_time, end_time | index(vehicle_id, start_time, end_time) |
| `telematics_trips` | id, **tenant_id**, vehicle_id, driver_id, provider_trip_id, start_time, end_time, `start_point`(POINT), `end_point`(POINT), distance_m, `raw_payload`(json), `match_status` | unique(tenant_id, provider_trip_id), SPATIAL(start_point), index(vehicle_id, start_time) |
| `platform_trips` | id, **tenant_id**, provider(enum), provider_trip_id, vehicle_id, driver_id, start_time, end_time, pickup_address, dropoff_address, `pickup_point`(POINT,null), `dropoff_point`(POINT,null), distance_m, fare, currency, status, `raw_payload`(json), `match_status` | unique(tenant_id, provider, provider_trip_id), index(vehicle_id, start_time) |
| `trip_matches` | id, **tenant_id**, telematics_trip_id, platform_trip_id, score, method, status(enum) | unique(telematics_trip_id, platform_trip_id), index per side |
| `personal_trips` | id, **tenant_id**, telematics_trip_id, occurred_on(date), within_working_window(bool), duration_bucket, distance_bucket, status | **بدون** polyline/وجهة — ميتاداتا مصغّرة فقط |
| `tenant_compliance_settings` | tenant_id, working_hours(json), retention(json), private_mode_enabled, regime, features(json) | one-to-one tenant |
| `compliance_attestations` | id, tenant_id, type(works_agreement\|dpia), status, attested_by, attested_at, document_ref | |
| `audit_logs` | id, tenant_id, actor_id, action, subject_type, subject_id, context(json), ip, created_at | append-only، index(tenant_id, created_at) |
| `geocode_cache` | id, address_hash, `point`(POINT), provider, created_at | unique(address_hash) — تقليل نداءات HERE |

**ملاحظات:** التوكنات (`credentials`) **مشفّرة at-rest** عبر encrypted casts. `match_status` على الرحلتين يسرّع الاستعلامات. تخزين الوقت **UTC**.

---

## 6. طبقة التكامل (Connectors) — Saloon

**واجهة موحّدة** لكل مزوّد:
```
Domain/Integrations/Contracts/TripProviderConnector
  ├─ syncReferenceData(connection): void      # vehicles, drivers, assignments
  ├─ fetchTrips(connection, cursorOrWindow): TripBatch  # delta/backfill
  └─ refreshToken(connection): void
```
- تطبيقات: `SamsaraConnector`, `UberConnector`, `BoltConnector` (كل واحد Saloon Connector + Requests).
- **إدارة التوكنات:** OAuth tokens مخزّنة مشفّرة في `integration_connections.credentials`؛ تجديد استباقي قبل الانتهاء؛ Samsara refresh **single-use** (نحفظ التوكن الجديد فوراً، نمنع التجديد المتزامن عبر قفل Redis).
- **Rate limiting + retries:** Saloon plugins (`AlwaysThrowOnErrors`, rate limiter لكل مزوّد: Samsara `/trips/stream` 5 req/s، احترام `Retry-After`).
- **Cursors:** تُحفظ في `sync_cursors` لكل مزوّد؛ آلية **re-bootstrap** من `startTime` لو cursor انتهت صلاحيته (Samsara 30 يوم).
- **خصوصية المزوّد:**
  - **Samsara:** OAuth Marketplace (install لكل org)، `GET /trips/stream` (`queryBy=updatedAtTime`)، sync `/fleet/vehicles|drivers|driver-vehicle-assignments`. parser متسامح ([Beta] fields).
  - **Uber:** client-credentials + `org_id`، Offline Reporting (`REPORT_TYPE_TRIP_ACTIVITY`): request report → poll status → download → parse.
  - **Bolt:** client-credentials + company id، polling orders على high-water-mark (التفاصيل تُؤكَّد عند الـ onboarding — P5).

---

## 7. الـ Ingestion والـ Jobs

- **Scheduler** (`routes/console.php` / Kernel) يطلق per-tenant per-provider sync jobs على فترات (مثلاً كل 5 دقائق للرحلات، يومي للمرجعيات).
- **Queues (Horizon supervisors):** `ingestion`, `geocoding`, `matching`, `notifications`, `default`, `retention` — أولويات وعمّال منفصلة.
- **سلسلة المعالجة لكل رحلة منصة:** ingest → normalize → **geocode address (job)** → جاهزة للمطابقة.
- **Idempotency:** dedupe عبر `unique(provider, provider_trip_id)`؛ upsert على إعادة السحب.
- **Backfill:** job منفصل بنافذة تاريخية (`queryBy=tripStartTime` لـ Samsara).
- **مرونة الأخطاء:** retries مع backoff، `failed_jobs`، تنبيه عند فشل الاتصال (status على `integration_connections`).

---

## 8. الـ Geocoding (abstraction)

```
Domain/Geocoding/Contracts/Geocoder
  └─ geocode(address, countryHint='DE'): ?GeoPoint
```
- التطبيق الافتراضي `HereGeocoder` (Saloon).
- **Cache أولاً:** `geocode_cache` (hash العنوان) قبل أي نداء خارجي → تقليل التكلفة والمعالجة (DSGVO data minimization).
- قابل للاستبدال بـ `NominatimGeocoder` لاحقاً بدون لمس باقي النظام.

---

## 9. محرك المطابقة (Matching Engine)

- **`MatchingService`** يعمل لكل **(vehicle موحّدة, نافذة زمنية)** عبر queued job بعد توفّر رحلات جديدة.
- **خطوات** (تفصيل القسم 6 من التحليل): Identity Resolution (plate/VIN للسيارة، phone/license للسائق) → جلب T (Samsara) و P (المنصات) → ترشيح بتداخل الوقت → **scoring** (`time_overlap` + `distance_similarity` + `geo_proximity` عبر `ST_Distance_Sphere`) → تعيين (greedy/Hungarian) → تصنيف (مطابَقة / شخصية / فجوة) → كتابة `trip_matches` + `personal_trips` (مصغّرة).
- **قابلية الضبط:** `time_tolerance`, عتبات الثقة، نافذة العمل — من `tenant_compliance_settings`.
- **طابور مراجعة يدوية** للحالات الغامضة + **identity match queue** للوحات غير المتطابقة.
- **TDD إلزامي:** fixtures لحالات (تداخل/لا تداخل، تبديل سائق، انقطاع كاميرا، miles↔km، توقيت).

---

## 10. الامتثال (Compliance) — تنفيذ القواعد الـ12

| القاعدة | التنفيذ التقني |
|---|---|
| Detect-don't-surveil | `personal_trips` تخزّن buckets فقط؛ لا polyline/وجهة. مراجعة كود + اختبار يمنع تسرّب المسار |
| نافذة ساعات العمل | `working_hours` في settings؛ المطابقة تحدّد `within_working_window` |
| Private mode | flag على المركبة/الرحلة → تجاهل التفاصيل، تخزين boolean فقط |
| Retention + auto-delete | `RetentionJob` مجدول يحذف الموقع الخام بعد المدة (أقصر للموقع)، يحترم settings |
| RBAC + need-to-know | Policies + أدوار؛ لوحات افتراضية = تجميعات لا حركة حيّة |
| Audit log | append-only `audit_logs` عبر observers/middleware لكل وصول للموقع/تغيير إعداد |
| Pseudonymization | `pseudonym_id` للسائق في طبقات التحليل/التصدير |
| Driver transparency | endpoint/شاشة تعرض ما يُجمع + إشعار Art.13 (ألماني) |
| Feature-gating | `features` flags مقفولة حتى `compliance_attestations` (works agreement + DPIA) = مكتمل |
| Regime selector | `regime` لكل tenant، افتراضي = الأشد (موظف) |
| DPIA/RoPA | كـ data/templates + قائمة sub-processors (Samsara, HERE, Hetzner, Sentry) |
| DPA (Art.28) | توثيقي/تعاقدي — يُسجَّل في المنصة كـ attestation |

---

## 11. تصميم الـ API

- **`/api/v1`** namespace. موارد: `auth`, `tenants`, `users`, `connections`, `drivers`, `vehicles`, `assignments`, `trips` (telematics/platform read-only)، `personal-trips`، `matches`، `review-queue`، `reports`، `compliance/settings|attestations`، `audit-logs`، `notifications`.
- **Controllers رفيعة** → Services. **FormRequests** للتحقق من المدخلات. **API Resources** للمخرجات (envelope ثابت `{ data, meta }`). pagination قياسي.
- **معالجة أخطاء موحّدة:** `Handler` يرجّع `{ message, errors }` بأكواد HTTP صحيحة.
- **حدود نظيفة للفتح للعام لاحقاً:** versioning موجود، وطبقة auth قابلة لإضافة API keys/Passport بدون إعادة هيكلة.

---

## 12. الواجهة (Next.js)

- **App Router + `next-intl`** (مسارات `/[locale]/...`، ألماني افتراضي + إنجليزي).
- **المصادقة:** عميل fetch بـ `credentials: 'include'`، جلب CSRF cookie ثم login؛ معالجة 401 بإعادة توجيه.
- **البنية:** `lib/api` (typed client)، `components`، صفحات: onboarding/ربط الحسابات، السواقون، المركبات، طابور المطابقة، الرحلات الشخصية، التقارير، الإعدادات/الامتثال، شاشة شفافية السائق.
- **الحالة/البيانات:** TanStack Query (caching + refetch) فوق REST.

---

## 13. البنية التحتية والنشر (Hetzner + Docker Compose)

- **خدمات Compose:** `app` (PHP-FPM)، `nginx`، `mysql`، `redis`، `horizon`، `scheduler` (cron)، (+`frontend` أو نشر منفصل لـ Next.js)، (+`nominatim` لاحقاً اختياري).
- **إقامة البيانات:** كل شي داخل ألمانيا/الـ EU (DSGVO). نسخ احتياطي مشفّر داخل الـ EU.
- **الأسرار:** `.env` خارج الـ repo؛ secrets عبر متغيّرات بيئة الخادم؛ توكنات المزوّدين مشفّرة بالـ DB.
- **CI/CD:** GitHub Actions → اختبارات Pest + lint → بناء صور → نشر (compose pull/up) — مع migration gate.
- **TLS:** Let's Encrypt على nginx.

---

## 14. المراقبة والأمان

- **Observability:** Sentry (EU) للأخطاء، structured logs، Horizon dashboard، health checks، تنبيه فشل المزامنة.
- **الأمان:** تشفير التوكنات at-rest، CSRF/CORS صحيحة لـ Sanctum، تحقق/تعقيم كل المدخلات (FormRequests)، least-privilege على الـ DB، تحديد المعدّل على endpoints الحساسة، عدم تسريب بيانات حساسة في الأخطاء/اللوجات.

---

## 15. استراتيجية الاختبارات (Pest)

- **Unit:** محرك المطابقة (TDD، حالات حافّة)، normalizers، scoring، plate/identity resolution.
- **Feature:** auth (Sanctum)، RBAC/policies، **cross-tenant isolation**، API endpoints، gating الامتثال (يمنع التشغيل بدون attestation)، retention job (يحذف الموقع الخام، يُبقي البَكِت).
- **Integration:** Connectors ضد sandbox/fixtures من raw payloads حقيقية (Saloon fakes/recording).
- **E2E سيناريو القيمة:** مركبة بلوحة معروفة → حقن رحلات Samsara + أوبر → تشغيل المطابقة → الرحلة خارج المنصة تُصنَّف "شخصية" بميتاداتا مصغّرة فقط، وتظهر بالتقرير.

---

## 16. تسلسل التنفيذ (مربوط بالمراحل)

| المرحلة | مخرجات تقنية رئيسية |
|---|---|
| **P0 — الأساس** | إعداد Monorepo + Docker Compose، Laravel + Sanctum + RBAC، Tenancy (BelongsToTenant/Global Scope/ResolveTenant)، schema أساسي، Horizon، audit log + هيكل gating الامتثال، Next.js shell + i18n + auth، CI |
| **P1 — Samsara** | `SamsaraConnector` (OAuth Marketplace)، sync vehicles/drivers/assignments، poll `/trips/stream` + cursors، تخزين `telematics_trips`، شاشات الأسطول |
| **P2 — Uber** | `UberConnector` (client-credentials + Offline Reporting)، normalize `platform_trips`، `HereGeocoder` + cache |
| **P3 — Matching** | `MatchingService` + scoring + جداول matches/personal_trips، identity & review queues، اختبارات TDD |
| **P4 — التقارير** | لوحات + تقارير الرحلات الشخصية + تنبيهات (mail+in-app)، تصدير، شفافية السائق |

> المراحل P5 (بولت)، P6 (تقوية الامتثال)، P7 (المحاسبة) خارج الـ MVP — لكل منها spec لاحق.

---

## 17. بنود تقنية مؤجّلة / مفتوحة

- تفاصيل Bolt Fleet API (تُؤكَّد عند الـ onboarding) → P5.
- قرار Nominatim self-host مقابل البقاء على HERE حسب التكلفة/الحجم.
- نموذج تسعير/اشتراك الـ SaaS (خارج النطاق التقني الحالي).
- تفاصيل GPS breadcrumbs من Samsara (`vehicles/stats/feed`) — فقط لو احتجنا مطابقة مسار أدق لاحقاً.
- اعتماد DPO/محامي ألماني لنصوص DPIA/RoPA/الشفافية قبل الإطلاق.

---

## 18. الخطوة التالية

اشتقاق **spec تفصيلي لمرحلة P0 (الأساس)** ثم خطة تنفيذ (writing-plans)، والبدء بالتنفيذ مرحلة-مرحلة مع مراجعة عند كل checkpoint.
