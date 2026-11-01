# 29 — العناوين والجيوكودينج: كيف يُتعامَل مع كل عنوان، بكل مرحلة وكل حالة

> **للقارئ:** مهندس (أو موديل AI) بدّه يشتغل على نظام العناوين/المسافة/الجيوكودينج في Reidey.
> كل المسارات تحت `backend/app/`. النص عربي والمصطلحات/الكود/الحقول إنجليزي.
> موثّق مقابل الكود على `main` (2026-11-01). لو تعارض: **الكود هو المرجع** — صلّح هالملف.

اختصارات: `DOI`=`Domain/Dispatch/DispatchOfferIngestor`، `TG`=`Domain/Dispatch/TripGeocoder`،
`DN`=`Domain/Notifications/DispatchNotifier`، `AN`=`Domain/Dispatch/AddressNormalizer`،
`AF`=`Domain/Dispatch/AddressFormatter`، `AL`=`Domain/Dispatch/AddressLatinizer`،
`OL`=`Domain/Dispatch/OfferLifecycle`، `DSI`=`Domain/Fleet/DriverStatusIngestor`.

---

## 0. الحقيقة الأساسية (اقرأها أول)

**عرض الديسباتش (RAMEN) ما بيجي فيه إحداثيات. العنوان نصّ حرّ فقط.** كل أعمدة
`*_lat/*_lng` بتتعبّى **بالجيوكودينج** (عند الدفع أو بالخلفية)، أو لاحقاً من **waypoints** بعد القبول.

عيّنات حقيقية من `raw_payload` (معمّاة — الأسماء/الـUUIDs مستبدَلة):

```jsonc
// 29247 — عنوان كامل صح
{ "offerUUID":"<uuid>", "requestAt":1793559896643, "driverInfo":{"driverUUID":"<uuid>","firstName":"<drv>","lastName":"<drv>"},
  "partnerUUID":"<uuid>", "formattedUFP":"€4.89",
  "pickupAddress":"Kleine Budengasse 7-11, 50667 Köln, Germany",
  "dropoffAddress":"Flandrische Str. 3-11, 50674 Köln, Germany",
  "riderFirstName":"<rider>", "offerGeneratedAtMs":1793559912772, "acceptWindowInSeconds":5 }

// 29222 — حيّ بلا شارع
{ ... "formattedUFP":"20,32 €",
  "pickupAddress":"Innenstadt, 50668 Köln, Deutschland",
  "dropoffAddress":"Sudetenstraße 67, 50354 Hürth-Efferen, Deutschland" ... }

// 29226 — شارع بلا رقم + دولة بالإسباني + بلا PLZ بالوصول
{ ... "formattedUFP":"EUR75.52",
  "pickupAddress":"Bahnhofstraße 1D, 42781 Haan, Deutschland",
  "dropoffAddress":"Königsallee, Düsseldorf-Stadtbezirk 1, Alemania" ... }
```

**ملاحظتان حاسمتان من العيّنات:**
1. **الأجرة `formattedUFP` بصيغ مختلفة:** `€4.89` · `20,32 €` · `EUR75.52` → لهيك `DriverStatsService::parseFare` معقّد.
2. **اسم الدولة بلغة الراكب:** `Germany` · `Deutschland` · `Alemania` → لهيك `AF::stripCountryTail` بيشيلها بأي لغة.

مفاتيح الـ payload اللي بيقراها `DOI::route` (DOI:90-141): `offerUUID→offer_uuid` (مفتاح idempotency)،
`realOfferUUID`، `offerType`، `partnerUUID`، `riderFirstName`، `driverInfo.driverUUID` (يُطابَق مع
`drivers.uber_driver_uuid`، DOI:104)، `driverInfo.firstName/lastName`، **`pickupAddress→pickup_address`**
و**`dropoffAddress→dropoff_address`** (بعد `AF::tidy`)، `formattedUFP→fare_formatted` (أرقام لاتينية) + `fare_amount`،
`acceptWindowInSeconds`، `requestAt→requested_at` (ms→Berlin)، `offerGeneratedAtMs`. الـ payload كامل→`raw_payload`.

**الـ waypoints مصدرها مختلف تماماً:** تيار حالة السائق (`DSI:150` يقرا `row['waypoints']` لما السائق عندو fix)،
كل waypoint = `{lat,lng,type}`، تُخزّن `drivers.trip_waypoints` (DSI:442)، فلترة خارج صندوق DACH (DSI:491)، و`0,0` تُلغى (DSI:479).

**أعمدة `dispatch_offers`:** `pickup_address, dropoff_address, pickup_display, dropoff_display,
pickup_station_name, dropoff_station_name, pickup_lat/lng, dropoff_lat/lng, distance_m, route_geometry,
geo_confidence, geo_source, stops(JSON), stops_count, geo_synced_at, geo_attempts, notify_latency_ms, raw_payload`.
وجدول كاش مشترك `geocode_cache`: `query, lat, lng, label, confidence` (forward + reverse).

---

## 1. المراحل بالترتيب (دورة حياة العنوان)

### المرحلة 1 — الدخول (Ingest)
`ingest()` من `DispatchIngestController` (daemon، batchDeadline لكل دفعة) أو `DispatchOfferController` (الإضافة؛ عروض شركة تانية مرفوضة ~:200).
بيُخزَّن العنوان نصّ خام + الأجرة + الأوقات. **بلا إحداثيات.**

### المرحلة 2 — جيوكودينج قبل الدفع (المسار الحرج)
بـ `DOI::notifyDriver` (DOI:267-309)، فقط إذا السائق مربوط + مش محذوف من الـroster + ما في auto-decline.
- **الميزانية** `GEOCODE_BUDGET_SECONDS = 0.4` ثانية (DOI:46؛ كانت 2.5 لحد 31.10)، `batchDeadline` مشتركة لكل الدفعة.
- `TG::enrich` (131-265): تخطّى لو `geo_synced_at` موجود → خُد موقع السائق كـ **bias** → ابنِ الاستعلامات
  (`fillBareStationCity`, `borrowCounterpartCity`, `StationResolver` لعنوان "PLZ City" بلا شارع) → حُلّ الطرف اللي
  عندو PLZ أول وحيّز الطرف التاني عليه → عبّي lat/lng → اضبط `*_display` عبر `completePostcode`→`latinDisplay`.
- لو الطرفين انحلّوا: `minTrustedDistance` يقرّر إذا بنحسب مسافة أصلاً → `route()` (OSRM، أو haversine بعد الـdeadline)
  → `geo_confidence` + `geo_synced_at`. لو فشل طرف: `geo_attempts++` (MAX=20).
- **رُتب الثقة** (TG:869): `exact 5, street 4, area 3, postal 2, approx 1`. المسافة تُوثَّق **بأضعف طرف**:
  exact+exact = أي طول · street أو أحسن = ≥1500م · postal/area = ≥4000م · approx/unknown = **أبداً**.
- **الشارة والمقاييس** (DN): `€€€` عند €/km ≥3، `€€` >1، غيرها `€` (مسافة مجهولة → `€`). نص المقياس
  `[~]12.3 km · €1.26/km` (الـ`~` لما الثقة ≠ exact). ما في مسافة = ما في مقياس.

### المرحلة 3 — آليات الجيوكودينج والمسار
- **Forward** `TG::geocode` (547-727): `AN::clean` يشيل غير-اللاتيني والدولة؛ كاش key = العنوان (+`|@lat,lng` لو بلا PLZ ومع bias)؛
  Nominatim `countrycodes=de`, `lang=de`, بلا بروكسي. **سلسلة Tiers** (أول نتيجة):
  - T1: شارع+PLZ+مدينة (`exact` لو الشارع فيه رقم، غيرها `street`).
  - T1b: شارع+مدينة بلا PLZ (نفس القاعدة).
  - T2: "Bahnhof, PLZ City" لو محطة والـpostcode مطابق، غيرها postalcode+city (`area`).
  - T3: `plzCentroidFallback` (جدول PLZ ثابت، بلا شبكة) (`postal`).
  - T4: نص حرّ **فقط لو بلا PLZ**، مع viewbox ±0.2° محيّز (`approx`، أو `street` لو مطار).
- **سُلطة المدينة** (TG:611): `city = PostalCodes::city(plz) ?? المُحلَّلة ?? townOf`. **جدول PLZ بيغلب التحليل الحرّ.**
  `completePostcode` بيضيف PLZ **ناقصة فقط**، وفقط لو المدينة المجيوكودة طابقت مدينة ذيل العنوان الخام — غيرها **بيترك الخام كما هو**
  (= "ما تغيّر المدينة غلط").
- **Reverse** `TG::reverse` (749-792): `rev|lat5,lng5`، zoom18، label = `shortGermanLabel`.
- **المسار:** `route()` = OSRM واحد (مسافة+geometry) أو haversine fallback (بلا geometry → `estimated`)؛ `routeThrough()` متعدد النقاط.
- مساعدات: `Domain/Geo/PostalCodes.php` (CSV)، `Domain/Geo/StationResolver.php` (جدول محطات محلي، بلا شبكة).

### المرحلة 4 — جيوكودينج بالخلفية بعد الدفع
`Jobs/GeocodeOffer`: tries3 timeout45 uniqueFor300؛ `enrich()` بلا deadline httpTimeout6؛ **بلا إشعار.**
يُطلَق من: DOI:302 (ما كمّل قبل الدفع)، فتح المدير لعرض بارد (DispatchOfferController:242)، `AutoDeclineFallback`.
شبكات أمان: `offers:backfill-geo --limit=12` كل 10د، الـscheduler بيصرّف الطابور كل دقيقة، `BackfillAddresses`.
**بيوصل الداشبورد/التطبيق:** الصفّ بيتحدّث، **بلا push/broadcast** (شوف §التباينات) → العميل بيشوفها عند الـrefetch التالي.

### المرحلة 5 — Multi-stop (فقط بعد القبول)
`DSI:199-203` يُدرج `SyncTripFromWaypoints` لما السائق engaged + عندو waypoints + تغيّر العدد. الـjob يقرا `trip_waypoints`،
يلاقي العرض النشط، `applyFromWaypoints` (TG:1114): ينظّف (يشيل 0,0، cap=12)، يحتاج ≥2، `stopsCount=points-1`،
**يعيد الحلّ فقط لما العدد يكبر** (قائمة أوبر بتصغر مع تقدّم الرحلة فالنقص يُتجاهل)، نقاط وسطية reverse حتى 5، كل stop `leg_m`+`cumulative_m`.
**الدفع** `DN::notifyMultiStop`: يُطلَق stops≥2، **مش مقيّد بعلم** (كل سائق كل شركة) + الملّاك؛ عنوان مترجَم de/en/ar؛
جسم `🔵 x{n} · metrics` + bullet لكل stop، حد 8 ثم "… +k"؛ stop بلا عنوان → "lat,lng"؛ تشذيب عند 3500 bytes.

### المرحلة 6 — مسار الدفع المعلَّم (dispatch_reject مفعّل)
البوابة `$fast = tenant->dispatchRejectEnabled()` (DOI:269). **الجيوكودينج يُتخطّى كلياً** (DOI:271-273).
`DN::notify(offer, true)`: الترتيب ينعكس (OfferBroadcast('new') بسقف 0.3ث **أول**، ثم FCM)؛ العنوان = الأجرة + `€` مجرّدة (بلا مسافة)؛
الجسم = العناوين الخام منظّفة+لاتينية. **دفعة واحدة لكل عرض.** المقاييس لاحقاً عبر `GeocodeOffer` (شوف §التباينات).

### المرحلة 7 — بعد القبول
`applyFromWaypoints` بيكتب فوق: `pickup/dropoff lat/lng` (إحداثيات أوبر)، `distance_m`+`route_geometry` (OSRM عبر كل النقاط)،
`*_display` عبر `labelForPoint`، `stops`+`stops_count`، `geo_source='uber'`، `geo_confidence='exact'`، `geo_synced_at`.
`saveUnlessUberResolved` بيمنع جيوكود-نصّي متأخّر من الكتابة فوق صفّ انحلّ من waypoints.

### المرحلة 8 — الأرقام اللاتينية / i18n
`AN::latinizeDigits` بيحوّل الأرقام العربية/الفارسية + الفواصل → لاتيني؛ مطبَّق على الأجرة (DOI:109) والعناوين (`AN::clean`).
أرقام الدفع `number_format` بنقطة؛ الأوقات → Berlin. العنوان غير-اللاتيني (أوبر بتترجمه للغة الراكب):
`AN::clean` يشيل المقاطع غير-اللاتينية، `AF::tidy` يشيل ذيل الدولة بأي لغة، `AL::toLatin` يستبدل القيمة غير-اللاتينية بـ"PLZ City" من الجدول أو null.

### المرحلة 9 — الحالات الحديّة
عنوان ناقص/فاضي → null، إعادة محاولة لـ20 ثم ختم بلا مسافة · بلا PLZ → T4 approx · deadline → transient، بلا كاش، job بالخلفية، دفع بالخام ·
Nominatim واقع → transient، إعادة لاحقاً · miss نهائي → كاش 30 يوم · OSRM واقع → haversine `estimated` (`~`) · رحلة قصيرة جداً → `distance_m=null` ·
PLZ مش بالجدول → centroid null → display فاضي · غير-لاتيني → "PLZ City" أو فاضي، **أبداً خام** · waypoints `0,0` → تُلغى · <2 waypoints → لا شي ·
سائق خارج DACH → موقعه null · payload >3500B → stops تُحذف ثم الجسم يُقصّ · Reverb بطيء → broadcast يُهمَل (ما بيوقف الدفع) · عرض مكرّر → `duplicate` عبر unique index.

---

## 2. الحالات الأربعة للعنوان (مع الأمثلة الحقيقية)

| الحالة | مثال حقيقي | شو بيصير |
|---|---|---|
| **1. عنوان كامل صح** | `Kleine Budengasse 7-11, 50667 Köln` (29247) | `AN::parse`→شارع+PLZ+مدينة؛ **T1 hit**؛ `exact` مع رقم البيت؛ `completePostcode` no-op؛ العرض = الخام منظّف. **أحسن حالة.** |
| **2. اسم مدينة/حيّ بس** | `Innenstadt, 50668 Köln` (29222) | بلا شارع حقيقي؛ `townOf` بيلاقي بلدة معروفة؛ T1b أو T4 **approx** → **ما في مسافة بالدفع** (فاضية لحد ما تجي الـwaypoints). العرض ما بيتغيّر. |
| **3. بلا شارع (PLZ+مدينة)** | `42697 Solingen` | `StationResolver` بيحاول يرقّيه لمحطة حقيقية (لو محطة وحدة واثقة بالـPLZ → بيضبط `*_station_name`)؛ غيرها T2 (area) ثم T3 centroid (postal). مسافة تُوثَّق فقط ≥4كم. |
| **4. معلم / محطة قطار** | `Königsallee, Düsseldorf-Stadtbezirk 1` (شارع بلا رقم/PLZ، 29226)؛ أو `Hauptbahnhof/Hbf` | كلمة محطة مجرّدة (`Hbf/Bahnhof/Bf`) → `bareStationLabel`؛ `fillBareStationCity` بيضيف مدينة الطرف التاني **للاستعلام فقط** (مش للعرض)؛ يمشي كحالة بلا-PLZ (T1b مع المدينة المستعارة، غيرها T4 محيّز لموقع السائق). المطارات → `street` (مسافة ~). أي POI تاني بلا PLZ → `approx` (بلا مسافة). |

**ملاحظة على 29226:** `Königsallee, Düsseldorf-Stadtbezirk 1, Alemania` = شارع **بلا رقم بيت وبلا PLZ** + `Stadtbezirk 1`
(زائدة حيّ) + `Alemania` (الدولة بالإسباني). `AF::tidy` بيشيل `Alemania`، وبما إنه بلا PLZ وبلا رقم → T4 نص حرّ → غالباً `approx`.
زوائد الأحياء اللي شفناها (`-Nord`, ` S`, `-Stadtbezirk 1`, `-Ehrenfeld`, `-Oberbarmen`) بيتعامل معها `knownTown`/`townOf`
(بيرجّع الاسم للمدينة الأساس بالاعتماد على جدول PLZ).

---

## 2.5 التوزيع الحقيقي (عيّنة 2297 رحلة، 4 شركات — 2026-11-01)

عيّنة فعلية من الإنتاج (آخر ~2300 عرض عبر tenants 7/8/9/11؛ 741/789/311/456):

| المقياس | العدد | % |
|---|---|---|
| `geo_confidence = exact` | 1957 | **85.2%** |
| `approx` | 165 | 7.2% |
| `street` | 152 | 6.6% |
| `area` | 15 | 0.65% |
| `null` (ما انحلّ) | 8 | 0.35% |
| **إلو مسافة (`distance_m`)** | 2115 | **92.1%** |
| `geo_source = uber` (انحلّ من waypoints بعد القبول) | 1377 | 59.9% |
| pickup بلا PLZ (الحالة الصعبة) | 166 | 7.2% |
| pickup محطة (Bahnhof/Hbf) | 38 | 1.7% |

**التفسير:**
- **85% exact وقت العرض** → الجيوكودر بيحلّ أغلب العناوين بدقّة شارع+رقم قبل الدفع (T1).
- **92% إلهن مسافة** بالدفع → غالبية السواقين بيشوفوا €/km + الشارة فوراً.
- **~7% بلا PLZ** (`approx`/`null`) = الحالات 2 و4 (حيّ فقط / معلم بلا PLZ) → **بلا مسافة** لحد ما تجي الـwaypoints.
- **60% `geo_source=uber`** = بعد القبول، إحداثيات أوبر صحّحت العنوان (المرحلة 7).
- المحطات نادرة (1.7%) بس حسّاسة (الحالة 4) — لهيك `StationResolver` + `fillBareStationCity`.

## 3. ⚠️ تباينات بين القواعد الموثّقة والكود (مهمة)

1. **ما في `OfferBroadcast('status')` عند انتهاء الجيوكودينج.** `GeocodeOffer`/`TG::enrich`/`SyncTripFromWaypoints`
   ما فيهن broadcast. الوحيدة `status` هي `OL:484` (announce) و`OL:512` (transition). يعني على مسار الدفع المعلَّم
   (dispatch_reject)، المسافة/€km/الشارة بيوصلوا التطبيق عبر **refetch/poll أو تغيّر حالة لاحق**، مش عبر broadcast من الجيوكود.
   (= "إلى شاشة يفتحها السائق" = refetch عند الفتح، مش دفع حيّ). **يستحق تأكيد: هل السائق فعلاً بيشوف €/km بعد الدفع المعلَّم؟**
2. **مسافة haversine `estimated` ما بتترقّى أبداً** بالـjob الخلفي — فقط waypoints القبول بتصلّحها.
3. "cache-warm = DB فقط" صحيح **للجيوكودينج فقط**؛ حساب المسافة **دايماً** بينادي OSRM (أرضية 0.2ث تحت ميزانية 0.4ث).
4. رحلة deadline **بتحرق محاولة** geo (MAX_ATTEMPTS=20).
5. بعد القبول، المدينة المعكوسة (reverse) **ما بتتفحّص مقابل جدول PLZ** (إحداثيات أوبر تُعتبَر مرجعاً).

قواعد **بتتحقّق** بالكود: المسار المعلَّم يتخطّى الجيوكودينج؛ ما في push ثاني؛ دفع multi-stop مش مقيّد بعلم؛ دفعات العروض بلا أزرار.

---

## 4. مرجع سريع (ثوابت)

- **الميزانية:** `GEOCODE_BUDGET_SECONDS = 0.4` (DOI:46).
- **رتب الثقة:** exact 5 · street 4 · area 3 · postal 2 · approx 1 (TG:869).
- **عتبات المسافة:** `MIN_APPROX_DISTANCE_M = 1500` · `MIN_COARSE_DISTANCE_M = 4000`.
- **المحاولات:** `MAX_ATTEMPTS = 20` · miss TTL = 30 يوم.
- **Multi-stop:** `MAX_WAYPOINTS = 12` · intermediate labelled = 5 · push stops = 8 · `MAX_PUSH_BYTES = 3500`.
- **الشارة:** €€€ ≥3 · €€ >1 · € غيرها (DN:536).
- **الملفات:** `DispatchOfferIngestor`, `TripGeocoder`, `DispatchNotifier`, `AddressNormalizer/Formatter/Latinizer`,
  `OfferLifecycle`, `DriverStatusIngestor`, `Jobs/{GeocodeOffer,SyncTripFromWaypoints}`, `Domain/Geo/{PostalCodes,StationResolver}`.
