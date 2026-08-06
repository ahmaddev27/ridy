# تحليل شامل — منصة إدارة أساطيل أوبر/بولت مع كشف الرحلات الشخصية عبر Samsara

> **النوع:** تحليل معماري كامل + خارطة طريق (Greenfield SaaS). **الحالة:** خطة معتمدة — لا يوجد كود بعد.
> **اللغة:** شرح بالعربي + مصطلحات تقنية بالإنجليزي.

---

## 1. السياق (Context) — ليش هذا المشروع

شركات الأساطيل في ألمانيا اللي تشغّل سواقين على أوبر/بولت بسيارات تملكها الشركة، عندها مشكلة حقيقية:
السائق ممكن يستخدم سيارة الشركة لرحلات **شخصية / خارج المنصة** (cash rides off-platform، أو استخدام شخصي) — وهذا يكلّف الشركة وقود + استهلاك + مسؤولية + إيراد ضائع، بدون أي رؤية.

**الفكرة الأساسية:** Samsara (telematics مركّب في السيارة) يسجّل **كل** حركة السيارة. أوبر/بولت يخبروك بالرحلات **الرسمية** فقط. الفرق بين الاثنين (رحلات سجّلها Samsara وما إلها مقابل رسمي) = **الرحلات الشخصية**. المنتج عبارة عن **SaaS متعدد المستأجرين (multi-tenant)** يربط الحسابات الثلاثة، يطابق الرحلات، ويعرض الرحلات الشخصية للشركة (تقرير وتنبيه فقط في الـ MVP).

**القرارات المثبّتة من المستخدم:**
| القرار | الاختيار |
|---|---|
| مصدر بيانات الكاميرا/التتبع | **Samsara API** (telematics حقيقي) |
| وصول أوبر/بولت | وصول رسمي للاثنين (Fleet APIs) |
| النموذج التجاري | **SaaS** متعدد المستأجرين لشركات الأساطيل |
| السوق | **ألمانيا** → DSGVO قيد من الدرجة الأولى |
| المحاسبة | **تقرير وتنبيه فقط** (لا فوترة/رواتب في الـ MVP) |
| وضع السواقين | **موظفين** → قانون العمل الألماني بالكامل (Betriebsrat، DPIA) |
| مفتاح المطابقة | **لوحة/رقم السيارة** (مسجّل في الأنظمة الثلاثة) |

---

## 2. أهم اكتشافين من البحث (يحكمان كل التصميم)

### 2.1 توفّر البيانات عبر المنصات الثلاث
| الحقل المطلوب للمطابقة | Samsara (`/trips/stream`) | Uber (Supplier / Offline Reporting) | Bolt (Fleet Integration API) |
|---|---|---|---|
| معرّف الرحلة | ✅ `id` | ✅ `Trip UUID` | ✅ order id |
| لوحة السيارة (مفتاح الربط) | ✅ `licensePlate` + `vin` | ✅ (Vehicle Management) | ✅ plate |
| وقت البداية | ✅ `startTime` | ✅ `Trip Request Time` | ✅ |
| وقت النهاية | ✅ `endTime` | ✅ `Trip DropOff Time` | ✅ |
| **GPS بداية/نهاية** | ✅ **lat/lng فعلي** | ❌ **عنوان فقط** | ❌ **عنوان فقط** |
| المسافة | ✅ `distanceMeters` | ✅ (miles) | ✅ |
| العنوان | ✅ formatted | ✅ pickup+dropoff | ✅ pickup |

**الخلاصة الحاسمة:** أوبر/بولت **لا يعطيان إحداثيات GPS**. لذلك المطابقة **ليست GPS↔GPS**. المفتاح القوي اللي حدّده المستخدم صح 100%: **لوحة السيارة تربط السيارة عبر الأنظمة الثلاثة**، وبعدها نطابق الرحلات **بتداخل الوقت** (+ المسافة + geocoding للعنوان كتأكيد ثانوي).

### 2.2 لا يوجد Webhooks للرحلات على أي منصة → **Polling مجدول**
- **Samsara:** لا webhook للرحلات. Polling لـ `GET /trips/stream` مع **cursor delta-sync** (`queryBy=updatedAtTime` + `after`)، حد 5 طلب/ثانية. OAuth 2.0 Marketplace app (كل شركة "تثبّت" تطبيقنا → token لكل org).
- **Uber:** Trips عبر **Offline Reporting API** (`REPORT_TYPE_TRIP_ACTIVITY`) — تطلب تقرير ثم تنزّله. OAuth client-credentials + `org_id`. لا trip webhook.
- **Bolt:** Fleet Integration API، OAuth client-credentials + company id، polling. (المواصفات مغلقة partner-gated — تُأكَّد عند الـ onboarding.)

→ المعمارية = **scheduled pollers + queues + cursor state لكل tenant/provider**، مش push.

---

## 3. المعمارية المقترحة (Recommended Architecture)

### 3.1 الخيار الموصى به: **Modular Monolith على Laravel**
ثلاث مقاربات دُرست:
- **(A) Modular Monolith — موصى به ✅:** Laravel منظّم بـ bounded contexts (modules)، Horizon + Redis queues، MySQL 8. أسرع وصول لـ MVP، يطابق ستاك المستخدم المفضّل (Laravel/MySQL/REST/Service Layer)، سهل الصيانة، وقابل لاستخراج خدمات لاحقاً.
- **(B) Microservices:** خدمة ingestion لكل provider + خدمة matching… overhead تشغيلي مبكر وغير مبرر. مرفوض للـ MVP.
- **(C) Monolith + serverless pollers:** تعقيد مختلط بدون فائدة كافية الآن. مرفوض.

### 3.2 الطبقات (وفق clean architecture المعتمد عندك)
```
Controllers (thin)  →  Services (business logic)  →  Repositories  →  Models
                         ↑
        Connectors (Samsara/Uber/Bolt) + Matching Engine + Compliance = خدمات domain
        Jobs/Schedulers (Horizon) تشغّل الـ pollers والـ matching بشكل غير متزامن
```

### 3.3 الستاك
| الطبقة | التقنية |
|---|---|
| Backend | **Laravel** (REST API، Service Layer، DI، Repositories) |
| DB | **MySQL 8** (spatial: `ST_Distance_Sphere` للقرب الجغرافي كتأكيد ثانوي) |
| Queues/Jobs | **Laravel Horizon + Redis** (pollers، matching، retention jobs) |
| Scheduler | Laravel Scheduler (cron) لتشغيل الـ pollers دورياً |
| Geocoding | مزوّد geocoding (تحويل عناوين أوبر/بولت → lat/lng) — يُختار لاحقاً |
| Frontend | لوحة تحكم (Inertia/Vue أو React منفصل عبر REST) — يُحسم في مرحلة الواجهة |
| Auth | Laravel Sanctum/Fortify + RBAC |

---

## 4. الأنظمة الفرعية (Bounded Contexts)

1. **Identity & Tenancy** — مصادقة، multi-tenant (الشركة = tenant)، مستخدمون وأدوار (RBAC)، onboarding الشركة.
2. **Integrations / Connectors** — وحدة لكل مزوّد (Samsara/Uber/Bolt): إدارة OAuth tokens + التجديد + حالة الاتصال + الـ cursors.
3. **Ingestion** — pollers مجدولة تسحب الرحلات وتطبّعها (normalize) لنموذج موحّد + تخزين الـ raw payload لإعادة المعالجة.
4. **Fleet Domain** — السواقون، المركبات، ربط سائق↔مركبة (assignments)، **حلّ هوية المركبة عبر اللوحة**.
5. **Matching Engine** — مطابقة رحلات Samsara ↔ رحلات أوبر/بولت → (مطابَقة / غير مطابَقة=شخصية / غامضة).
6. **Accountability & Reporting** — كشف الرحلات الشخصية، لوحات، تنبيهات، تقارير (ميتاداتا مصغّرة).
7. **Compliance & Governance (DSGVO)** — gating قانوني، نوافذ ساعات العمل، private mode، retention/auto-delete، RBAC، audit log، DPIA/RoPA، حقوق صاحب البيانات، pseudonymization.
8. **Dashboard / Frontend** — واجهة مدير الأسطول.

---

## 5. نموذج البيانات الأساسي (Core Data Model)

> أسماء توضيحية؛ تُحسم تفاصيل الأعمدة في خطة كل مرحلة.

- **tenants** — شركات الأساطيل (الشركة = tenant).
- **users**, **roles**, **permissions** — RBAC.
- **integration_connections** — `tenant_id`, `provider` (samsara|uber|bolt), tokens (OAuth)، `external_org_id/company_id`, `status`, `sync_cursors` (JSON).
- **drivers** — `tenant_id`, الاسم/التواصل/الرخصة, `employment_type`, معرّفات خارجية لكل مزوّد (`samsara_id`/`uber_id`/`bolt_id` عبر `externalIds`), `pseudonym_id`.
- **vehicles** — `tenant_id`, **`license_plate_normalized`** (مفتاح الربط), `vin`, make/model، معرّفات خارجية لكل مزوّد.
- **driver_vehicle_assignments** — `vehicle_id`, `driver_id`, `start_time`, `end_time` (لحلّ سائق الرحلة).
- **telematics_trips** (Samsara) — `vehicle_id`, `driver_id`, `start/end_time`, `start/end_lat/lng`, `distance_m`, `raw_payload`.
- **platform_trips** (أوبر/بولت) — `provider`, `vehicle_id`, `driver_id`, `start/end_time`, `pickup/dropoff_address`, `pickup/dropoff_lat/lng` (geocoded), `distance_m`, `fare`, `status`, `raw_payload`.
- **trip_matches** — `telematics_trip_id`, `platform_trip_id`, `score`, `method`, `status` (confirmed|ambiguous|rejected).
- **personal_trips** (مشتقّ، مصغّر) — `telematics_trip_id`, `occurred`, `within_working_window` (bool), `duration_bucket`, `distance_bucket` — **بدون** polyline أو وجهة خاصة كاملة.
- **الامتثال:** `tenant_compliance_settings` (working hours، retention، private_mode، regime)، `works_agreement_attestations`، `dpia_status`، `audit_logs`، `retention_jobs`.

---

## 6. محرك المطابقة (Matching Engine) — قلب النظام

**المبدأ:** Samsara = الحقيقة الأرضية لكل الحركة. أوبر+بولت = الرحلات الرسمية. المتبقّي = شخصي.

### 6.0 طبقة Identity Resolution (مهمة — الـ API يعطي السلسلة كاملة)
كل رحلة من أي مزوّد بتحمل **سلسلة جاهزة** `رحلة → سائق → سيارة (لوحة)`، فالربط على مستويين:
- **داخل المزوّد (جاهز من الـ API):** الرحلة فيها `driver_id` + `vehicle_id` مباشرة — لا حاجة لاستنتاج.
- **عبر المزوّدين الثلاثة (نحتاج توحيد):** كل مزوّد عنده IDs داخلية مختلفة، فنبني **كيانات موحّدة (canonical)**:
  - **مركبة موحّدة** ← مفتاح الربط = **اللوحة المطبَّعة (أو VIN)**: `samsara.licensePlate ≡ uber.plate ≡ bolt.plate`.
  - **سائق موحّد** ← مفاتيح الربط = **الهاتف/الرخصة/الاسم** (+ `externalIds` في Samsara): يربط نفس السائق عبر أوبر+بولت+Samsara.
- **المرتكز (anchor):** بما إن جهاز Samsara مركّب **بالسيارة** ويسجّل كل حركتها، **المركبة هي المرتكز الأساسي** لكشف الحركة الكلية؛ و**السائق مفتاح ثانٍ** يرفع ثقة المطابقة ويحلّ "مين كان سايق" وقت الرحلة الشخصية (عبر `driver_vehicle_assignments` أو سائق رحلة Samsara نفسها).
- **التعامل مع نقص المفتاح:** لو لوحة مفقودة/غير متطابقة → السيارة تدخل **طابور مطابقة هوية يدوي** (الأدمن يربط يدوياً مرة واحدة، ويُحفظ الربط).

**الخوارزمية (لكل مركبة موحّدة، ضمن نافذة زمنية مثل يوم/وردية):**
1. **حلّ الهوية:** استخدم الكيانات الموحّدة من 6.0 (المركبة الموحّدة + سائقها) عبر المزوّدين.
2. **جلب الرحلات:** كل رحلات Samsara (T) وكل رحلات المنصات (P) لنفس المركبة الموحّدة/النافذة (مع ربطها بالسائق الموحّد).
3. **التطابق:** لكل `P` نبحث عن `T` مرشّحة بحيث **يتداخل الوقت** (وقت طلب/بداية المنصة يقع ضمن نافذة رحلة Samsara ± tolerance قابل للضبط، مثلاً ±5–10 دقائق).
4. **التسجيل (scoring):** `time_overlap_ratio` + `distance_similarity` (مسافة المنصة مقابل مسافة Samsara، مع تطبيع miles→km لأوبر) + `geo_proximity` (عنوان المنصة المحوّل geocoded مقابل نقطة Samsara). تعيين أمثل/جشِع (greedy/Hungarian) لمنع المطابقة المزدوجة.
5. **التصنيف:**
   - `P` ↔ `T` → **رحلة عمل مؤكَّدة**.
   - `T` بدون مقابل → **رحلة شخصية مرشّحة** (flag، ميتاداتا مصغّرة).
   - `P` بدون مقابل → **فجوة بيانات** (كاميرا مطفأة/مفقودة → تنبيه تشغيلي).
6. **مستويات الثقة + طابور مراجعة يدوية** للحالات الغامضة.

**حالات حافّة يجب التعامل معها:** تبديل السائق خلال اليوم (عبر assignments)، رحلتان متتاليتان لمنصتين، انقطاع الكاميرا، المناطق الزمنية (تخزين UTC)، تطبيع وحدات المسافة، فرق "وقت الطلب" عن "بداية الحركة الفعلية".

---

## 7. تصميم الـ Ingestion (المزامنة)

- **Per-tenant per-provider poller** كـ scheduled job (Horizon).
- **Samsara:** `GET /trips/stream` (`queryBy=updatedAtTime`، batches ≤50 vehicle ids، احترام 5 req/s و `Retry-After`)، تخزين `endCursor` لكل tenant. مزامنة دورية لـ `/fleet/vehicles` و`/fleet/drivers` و`driver-vehicle-assignments`. (GPS breadcrumbs عبر `vehicles/stats/feed?types=gps` فقط لو احتجنا تأكيد مسار — ليس ضرورياً للـ MVP).
- **Uber:** طلب `REPORT_TYPE_TRIP_ACTIVITY` دورياً ثم تنزيله ومعالجته؛ مزامنة drivers/vehicles عبر Supplier Platform.
- **Bolt:** polling لنقطة الطلبات company-scoped على high-water-mark timestamp.
- **عام:** dedupe بـ `platform_trip_id`؛ تخزين raw payload؛ **geocoding للعناوين عند الإدخال** كي يشتغل المطابق على إحداثيات.

---

## 8. تصميم الامتثال DSGVO — العنصر الفارق (drivers = موظفون)

> ميزتك الأساسية (كشف الرحلات الشخصية) = قانونياً **مراقبة تحرّك خاص للموظف** = أكثر فئة مقيّدة في ألمانيا (قضايا Lüneburg/Wiesbaden). قابلة للبناء **فقط** بمبدأ **"اكشف بدون ما تراقب"**.

**قواعد تصميم إلزامية (تُبنى من المرحلة 0):**
1. **"Detect, don't surveil":** الرحلة الشخصية تُخزَّن كـ **ميتاداتا مصغّرة** (حصلت؟، ضمن/خارج ساعات العمل، شريحة مدة، شريحة مسافة) — **بدون** المسار الكامل ولا الوجهة الخاصة.
2. **نافذة ساعات عمل** قابلة للضبط لكل tenant؛ خارجها: لا تجميع أو تجميع خشن فقط.
3. **Private mode** سهل التفعيل للسائق → يُخزَّن فقط flag "استخدام خاص".
4. **Retention + auto-deletion** قابل للضبط؛ retention أقصر للموقع الخام.
5. **RBAC + need-to-know**؛ اللوحات الافتراضية تعرض استثناءات/تجميعات لا حركة حيّة.
6. **Audit log** tamper-evident لكل وصول للموقع وكل تغيير إعداد.
7. **Pseudonymization** لمعرّفات السائقين في طبقة التحليل.
8. **Driver transparency view** + إشعار Art.13.
9. **Feature-gating:** التتبع المستمر وكشف الرحلات الشخصية **مطفأ** حتى يُقرّ الـ tenant بوجود **Betriebsvereinbarung (اتفاق مجلس عمال) + DPIA مكتمل**.
10. **Regime selector** لكل tenant، **افتراضي = الأشد (موظف)**.
11. **DPIA + RoPA templates** + قائمة المعالجين الفرعيين (Samsara، الاستضافة) كميزة منتج.
12. أنت **processor**، الشركة **controller** → **DPA (Art. 28)** مع كل شركة.

> ⚠️ هذه قيود تصميم، **ليست استشارة قانونية**. يجب اعتماد DPO ألماني + محامي عمل قبل الإطلاق.

---

## 9. خارطة الطريق — تقسيم لمشاريع فرعية (كل مرحلة لها spec→plan→implementation)

| المرحلة | المحتوى | ملاحظات |
|---|---|---|
| **P0 — الأساس** | Auth، multi-tenant، RBAC، onboarding الشركة، schema أساسي، **هيكل gating الامتثال + audit log** | الامتثال منسوج من البداية (drivers=موظفون) |
| **P1 — موصل Samsara** | OAuth Marketplace، poll `/trips/stream`، مزامنة vehicles/drivers/assignments، تخزين telematics_trips | المصدر الأرضي للحركة |
| **P2 — موصل أوبر** | client-credentials، Offline Reporting (`TRIP_ACTIVITY`)، تطبيع platform_trips + geocoding | |
| **P3 — محرك المطابقة v1** | ربط اللوحة + تداخل الوقت + تأكيد المسافة/الجغرافيا، كشف الرحلات الشخصية، طابور مراجعة | قلب القيمة |
| **P4 — التقارير واللوحات** | كشف وعرض الرحلات الشخصية + تنبيهات (ميتاداتا مصغّرة، متوافق) | |
| **P5 — موصل بولت** | Fleet Integration API (يُؤكَّد عند الـ onboarding) | إضافة منصة ثانية |
| **P6 — تقوية الامتثال** | retention/auto-delete، private mode، driver transparency، DPIA/RoPA، pseudonymization | |
| **P7 — المحاسبة المالية** | حساب رسوم/فوترة (لاحقاً، خارج الـ MVP) | اختياري |

**الـ MVP الموصى به = P0 + P1 + P2 + P3 + P4** (Samsara + أوبر + مطابقة + تقرير، مع أساس الامتثال). بولت والتقوية والفوترة لاحقاً.

---

## 10. المخاطر والأسئلة المفتوحة

- **قانوني (الأعلى):** الميزة الأساسية حسّاسة في ألمانيا — يجب اعتماد DPO/محامي وموافقة Betriebsrat قبل الإطلاق الفعلي.
- **Bolt API مغلق partner-gated:** الحقول/الحدود الدقيقة تُؤكَّد عند الـ onboarding؛ لذلك بولت في P5 وليس الـ MVP.
- **غياب GPS من أوبر/بولت:** يعتمد على جودة الـ geocoding وتطابق الوقت؛ احتمال حالات غامضة → طابور مراجعة ضروري.
- **حدود المعدل (rate limits) و cursors:** تنتهي صلاحية cursors بعد 30 يوم → آلية re-bootstrap من `startTime`.
- **schemas في Samsara معلّمة [Beta]:** كتابة parser متسامح.
- **geocoding:** اختيار مزوّد ودقّته وكلفته (نقطة قرار لاحقة).

---

## 11. التحقق (Verification) — كيف نتأكد أن كل مرحلة تشتغل

- **اختبارات وحدة (TDD):** خوارزمية المطابقة بحالات حافّة مُصطنعة (تداخل/عدم تداخل وقت، تبديل سائق، انقطاع كاميرا، وحدات مسافة).
- **اختبارات تكامل للموصّلات:** ضد بيئة sandbox/توكنات تجريبية لكل مزوّد + fixtures من raw payloads حقيقية.
- **سيناريو end-to-end:** مركبة بلوحة معروفة → حقن رحلات Samsara + رحلات أوبر → تشغيل المطابقة → التأكد أن الرحلة الخارجة عن المنصة تُصنَّف "شخصية" بميتاداتا مصغّرة فقط.
- **تحقق الامتثال:** تأكيد أن المسار الخاص الكامل **لا يُخزَّن**، أن الـ gating يمنع التشغيل بدون إقرار، وأن audit log يسجّل كل وصول.

---

## 12. الخطوة التالية المقترحة

كتابة **الخطة التقنية التفصيلية** (technical design) بناءً على هذا التحليل — تبدأ بمرحلة P0 (الأساس) ثم نمشي مرحلة-مرحلة.
