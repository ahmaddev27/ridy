# دليل التشغيل (Run Guide) — DASHCAM

> **الغرض:** كيف تشغّل المنصة محلياً من الصفر (Backend + Frontend) وتمشي بالـ value loop كامل.
> **يُقرأ مع:** [01-project-analysis.md](./01-project-analysis.md) · [02-technical-plan.md](./02-technical-plan.md) · [04-progress.md](./04-progress.md) · [05-api-reference.md](./05-api-reference.md)
> **الستاك:** Backend = **Laravel 13 + PHP 8.4** (SQLite للتطوير، MySQL-ready) · Frontend = **Next.js 16 + React 19 + Tailwind v4**.
> **اللغة:** شرح بالعربي + الأوامر/المصطلحات بالإنجليزي.

---

## 0. المنافذ (Ports) — مهم

| الخدمة | المنفذ | السبب |
|---|---|---|
| Backend (`php artisan serve`) | **8090** | المنفذ 8000 مشغول محلياً |
| Frontend (`npm run dev`) | **3000** | الافتراضي لـ Next.js |

> الواجهة تتوقّع الباك على **8090** عبر `frontend/.env.local` → `NEXT_PUBLIC_API_URL=http://localhost:8090`. لو غيّرت منفذ الباك، غيّر هذا المتغيّر أيضاً.

---

## 1. المتطلّبات (Prerequisites)

| الأداة | النسخة | ملاحظة |
|---|---|---|
| **PHP** | **8.4+** | مع إضافات Laravel المعتادة (`pdo_sqlite`, `mbstring`, `openssl`, `ctype`, `json`, `curl`). `pdo_mysql` لو رح تستخدم MySQL |
| **Composer** | 2.x | لإدارة حزم PHP |
| **Node.js** | **20+** | لتشغيل الواجهة |
| **npm** | المرافق لـ Node 20+ | (أو pnpm/yarn حسب تفضيلك) |
| MySQL 8.4 | اختياري | فقط لو رح تحوّل عن SQLite (مثلاً عبر Laragon) |

> التطوير الافتراضي على **SQLite** — ما تحتاج تشغّل أي خادم DB. MySQL اختياري للاحقاً.

---

## 2. تشغيل الـ Backend (Laravel)

كل الأوامر تُنفَّذ داخل مجلّد `backend/`.

### 2.1 الإعداد لأول مرّة (one-time setup)

```bash
cd backend

# 1) تثبيت حزم PHP
composer install

# 2) نسخ ملف البيئة (لو لسا غير منسوخ)
copy .env.example .env        # Windows (PowerShell/CMD)
# cp .env.example .env        # Linux/macOS

# 3) توليد مفتاح التطبيق (APP_KEY)
php artisan key:generate

# 4) إنشاء قاعدة بيانات SQLite (إذا غير موجودة) ثم تشغيل الـ migrations + seed
#    الملف الافتراضي: backend/database/database.sqlite
php artisan migrate --seed
```

> **ملاحظة SQLite:** إذا ما كان ملف `database/database.sqlite` موجود، أنشئه فارغاً قبل `migrate`:
> `New-Item backend/database/database.sqlite -ItemType File` (PowerShell) أو `touch backend/database/database.sqlite` (bash).
> الـ `--seed` يزرع بيانات الديمو (انظر §5).

### 2.2 تشغيل الخادم

```bash
php artisan serve --port=8090
```

→ الـ API صار حيّ على `http://localhost:8090`. تأكّد بسرعة:

```bash
curl http://localhost:8090/api/v1/health     # يفترض يرجّع 200 + حالة الخدمة
```

---

## 3. العمليات الثلاث للـ Backend (شغّلها معاً)

المنصة تعتمد **3 عمليات** بالتوازي. افتح **3 نوافذ terminal** منفصلة داخل `backend/`:

| # | الأمر | الوظيفة | ضروري متى |
|---|---|---|---|
| 1 | `php artisan serve --port=8090` | **HTTP API** — يخدم كل طلبات الـ REST للواجهة | دائماً |
| 2 | `php artisan queue:work` | **Queue worker** — ينفّذ الـ jobs غير المتزامنة: مزامنة Samsara/Uber/Bolt، الـ geocoding، **تشغيل المطابقة (matching)**، حذف الـ retention، الإشعارات (`QUEUE_CONNECTION=database`) | لمّا تزامن/تطابق/تشعر |
| 3 | `php artisan schedule:work` | **Scheduler** — يطلق الـ jobs المجدولة: `samsara-sync` كل **5 دقائق** · `matching-run-all` كل **ساعة** · `retention:purge` **يومياً** (03:00) | للتشغيل التلقائي الدوري |

> **مختصر:** بدون **queue:work** لن تُنفَّذ المزامنة/المطابقة المُرسَلة للطابور (تبقى pending). بدون **schedule:work** لن يحصل أي تشغيل **تلقائي دوري** (بتقدر دائماً تشغّل يدوياً من الواجهة عبر "Sync" و"Run matching"). للتجربة السريعة، العملية (1) + (2) تكفي مع التشغيل اليدوي.

---

## 4. تشغيل الـ Frontend (Next.js)

كل الأوامر داخل مجلّد `frontend/`.

```bash
cd frontend

# 1) تثبيت الحزم
npm install

# 2) تأكّد من ملف البيئة frontend/.env.local
#    لازم يحتوي السطر التالي (يشير لمنفذ الباك 8090):
#    NEXT_PUBLIC_API_URL=http://localhost:8090

# 3) تشغيل خادم التطوير (المنفذ 3000)
npm run dev
```

→ افتح المتصفّح على `http://localhost:3000`.

> **CORS / Cookies:** المصادقة عبر **Sanctum SPA (cookies)**. الواجهة تجلب `GET /sanctum/csrf-cookie` ثم `POST /login` مع `credentials: 'include'`. تأكّد أن `SANCTUM_STATEFUL_DOMAINS` و`SESSION_DOMAIN` و`FRONTEND_URL` في `.env` متّسقة مع `localhost:3000` (انظر §8).

---

## 5. أول تسجيل دخول + مسار القيمة (Value Loop)

**بيانات الديمو المزروعة (seeded):**

| الحقل | القيمة |
|---|---|
| Email | `manager@fleet.de` |
| Password | `password` |
| Tenant | **Berlin Cabs GmbH** |

امشِ بالخطوات بالترتيب لتشوف القيمة الأساسية (كشف الرحلات الشخصية) end-to-end:

1. **Login** — افتح `http://localhost:3000` → سجّل دخول بالبيانات أعلاه. (الواجهة افتراضياً **بالألماني**؛ بدّل DE/EN من الـ topbar.)
2. **Connections** — اذهب لشاشة **Connections** → اربط مزوّداً:
   - **Samsara:** `api_token`
   - **Uber:** `client_id` + `client_secret` + `org_id`
   - **Bolt:** `client_id` + `client_secret` + `company_id`
   > بدون اعتمادات حقيقية، النداءات الفعلية ستفشل (الموصّلات مبنية ومختبَرة عبر `Http::fake`؛ النداء الحقيقي يحتاج اعتمادات حقيقية + `HERE_API_KEY` للـ geocoding — انظر §8). Bolt API بوّابته partner-gated.
3. **Sync** — اضغط **Sync** على المزوّد. (إن كان `queue:work` شغّال، تُنفَّذ المزامنة من الطابور؛ وإلا تبقى pending.) تُسحب المركبات/السواقين/الرحلات وتُخزّن.
4. **Trips / Vehicles / Drivers** — تحقّق أن البيانات وصلت: شاشة **Vehicles** (المركبات باللوحة المطبَّعة) و**Trips** (رحلات telematics من Samsara + platform من Uber/Bolt).
5. **Personal Trips → "Run matching"** — اذهب لشاشة **Personal Trips** واضغط **Run matching**. محرّك المطابقة يربط رحلات Samsara برحلات المنصّات بتداخل الوقت؛ كل رحلة Samsara **بدون مقابل رسمي = رحلة شخصية مُعلَّمة**.
6. **شاهد الرحلات الشخصية المُعلَّمة** — تظهر بـ **buckets فقط** (مركبة، ضمن/خارج ساعات العمل، شريحة مدة، شريحة مسافة) — **بدون** أي مسار أو وجهة (قيد DSGVO "اكشف بدون ما تراقب"). راجِع/تجاهل (review/dismiss) عند الحاجة.
7. **Reports / Billing** — شاشة **Reports** (تجميع لكل مركبة + تصدير CSV مصغّر) و**Billing** (رسوم **تقديرية**: منتصف شريحة المسافة × التعرفة per-km — متوافق DSGVO).

> ملاحظة: شاشات **Review-Queue** (المطابقات الغامضة + اللوحات غير المحلولة) و**Compliance** (ساعات العمل/retention/attestations) و**Audit-Log** و**Transparency** كلها حيّة أيضاً.

---

## 6. التبديل من SQLite إلى MySQL

التطوير الافتراضي على **SQLite**. توافق **MySQL 8.4** متحقَّق (`migrate:fresh` + `db:seed` نجحوا). للتحويل:

1. شغّل MySQL (مثلاً عبر **Laragon**) وأنشئ قاعدة باسم `dashcam`.
2. عدّل `backend/.env` للأسطر التالية:

```dotenv
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=dashcam
DB_USERNAME=root
DB_PASSWORD=
```

3. أعد بناء القاعدة:

```bash
php artisan migrate:fresh --seed
```

> للرجوع إلى SQLite: أعِد `DB_CONNECTION=sqlite` (واحذف/علّق أسطر MySQL)، ثم `php artisan migrate:fresh --seed`.

---

## 7. تشغيل الاختبارات (Test Suite)

```bash
cd backend
php artisan test
# أو:
vendor/bin/phpunit
```

→ يفترض تشاهد **38 اختبار أخضر** (PHPUnit) — تغطّي المصادقة، عزل cross-tenant، الموصّلات (Samsara/Uber/Bolt عبر `Http::fake`)، محرّك المطابقة (بما فيه تأكيد **عدم تسريب أي إحداثيات** في الرحلة الشخصية)، الامتثال، الـ retention، والـ billing.

> الاختبارات تعمل على SQLite (in-memory/ملف) ولا تحتاج اعتمادات حقيقية للمزوّدين.

---

## 8. مرجع مفاتيح البيئة (Environment Keys)

ملف `backend/.env` (انسخه من `.env.example`):

| المفتاح | الوظيفة | مطلوب؟ |
|---|---|---|
| `APP_KEY` | مفتاح تشفير التطبيق (يولّده `key:generate`) — يشفّر الجلسات وتوكنات المزوّدين at-rest | **نعم** (يُولَّد آلياً) |
| `DB_CONNECTION` | `sqlite` (افتراضي) أو `mysql` | **نعم** |
| `DB_DATABASE` | اسم/مسار القاعدة: مسار ملف `.sqlite` لـ SQLite، أو `dashcam` لـ MySQL | **نعم** |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` | إعدادات اتصال MySQL | فقط مع MySQL |
| `QUEUE_CONNECTION` | `database` — لازمه `php artisan queue:work` لتنفيذ الـ jobs | **نعم** (=`database`) |
| `SANCTUM_STATEFUL_DOMAINS` | الدومينات أول-طرف لـ Sanctum SPA (محلياً `localhost:3000`) | **نعم** (للواجهة) |
| `FRONTEND_URL` | عنوان الواجهة لروابط/CORS (محلياً `http://localhost:3000`) | **نعم** (للواجهة) |
| `SESSION_DOMAIN` | دومين كوكي الجلسة (محلياً `localhost`) | **نعم** (للواجهة) |
| `HERE_API_KEY` | مفتاح **HERE** للـ geocoding (تحويل عناوين Uber/Bolt → lat/lng) | **مفقود حالياً** — مطلوب للنداء الحقيقي فقط |
| `MAIL_MAILER` | `log` حالياً (الإيميلات تُكتب باللوج، لا إرسال فعلي) | يُضبط `log` للتطوير |
| `MAIL_*` | إعدادات مزوّد البريد الفعلي (host/port/username/...) | فقط للإنتاج |
| `SAMSARA_BASE_URL` | عنوان Samsara API الأساسي | افتراضي جاهز |
| `UBER_BASE_URL` | عنوان Uber API الأساسي | افتراضي جاهز |
| `BOLT_BASE_URL` | عنوان Bolt API الأساسي | افتراضي جاهز |

> **اعتمادات المزوّدين** (Samsara token / Uber client+secret+org / Bolt client+secret+company) **لا تُخزَّن في `.env`** — تُدخَل من شاشة **Connections** وتُحفظ **مشفّرة at-rest** في جدول `integration_connections`.

---

## 9. مشاكل شائعة (Troubleshooting)

| العَرَض | السبب المحتمل | الحل |
|---|---|---|
| الواجهة 401 / لا تصادق | عدم اتّساق Sanctum domains | تأكّد `NEXT_PUBLIC_API_URL=http://localhost:8090` + `SANCTUM_STATEFUL_DOMAINS`/`SESSION_DOMAIN`/`FRONTEND_URL` تشير لـ `localhost`/`3000` |
| "Sync" ما يعمل شي | `queue:work` غير شغّال | شغّل `php artisan queue:work` (العملية رقم 2) |
| ما في تشغيل تلقائي دوري | `schedule:work` غير شغّال | شغّل `php artisan schedule:work` (العملية رقم 3) |
| فشل geocoding للعناوين | `HERE_API_KEY` مفقود | أضف مفتاح HERE حقيقي (مطلوب للنداء الحقيقي فقط) |
| `database file does not exist` | ملف SQLite غير منشأ | أنشئ `backend/database/database.sqlite` فارغاً ثم `php artisan migrate --seed` |
| المنفذ 8090 مشغول | عملية أخرى تحجزه | استخدم منفذاً آخر وحدّث `NEXT_PUBLIC_API_URL` بنفس المنفذ |
