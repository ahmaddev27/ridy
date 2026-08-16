# Reidey Uber Connector — إضافة المتصفّح (Chrome + Firefox)

إضافة تلتقط جلسة أوبر تبع المدير **تلقائياً** بعد ما يسجّل دخوله عادي — بدون أتمتة (فأوبر ما بتحجبها)، وبدون نسخ كوكيز يدوي.

## كيف تشتغل

1. المدير يفتح `vsdispatch.uber.com` ويسجّل دخوله **عادي** (رمز SMS بيشتغل — إنسان حقيقي).
2. [content.js](content.js) يكشف نجاح الدخول → [background.js](background.js) يقرأ كل كوكيز `*.uber.com` (httpOnly كمان) + الـorg uuid → يرسلهم لـ`POST /api/v1/fleet-session` بتوكن المدير.
3. يظهر توست «✓ verbunden». يلتقط **مرة وحدة لكل جلسة** (ما يكرّر). لو مسجّل دخول مسبقاً → يلتقط فوراً عند فتح الصفحة.

## التوافق

كود واحد للمتصفّحين عبر طبقة `const api = globalThis.browser || globalThis.chrome`. الـmanifest فيه `service_worker` (Chrome) و`scripts` (Firefox) + `browser_specific_settings.gecko`.

---

## التثبيت — للتطوير (الآن)

**Chrome/Edge:**
1. `chrome://extensions` → فعّل **Developer mode**
2. **Load unpacked** → اختر مجلّد `extension/`

**Firefox:**
1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on** → اختر `extension/manifest.json`
   > مؤقّت — بينمسح عند إغلاق فايرفوكس (للتطوير فقط).

## الإعداد (مرة واحدة)

1. لوحة رايدي → **Uber-Verbindung** → **Kopplungs-Token generieren** → انسخ التوكن
2. أيقونة الإضافة → Einstellungen → الصق **Reidey-URL** (`http://localhost:8090` أو `https://reidey.de`) + **Token** → Speichern

---

## التوزيع للمستخدمين النهائيين (إنتاج) — من الأسهل

| الطريقة | تجربة المستخدم | تحديث تلقائي | يحتاج منك |
|---|---|---|---|
| **Chrome Web Store** (unlisted) | لينك → «Add to Chrome» (ضغطة) | ✅ | حساب مطوّر $5 + رفع + مراجعة (~أيام) |
| **Firefox AMO** (unlisted) | لينك → «Add to Firefox» | ✅ | رفع + توقيع مجاني |
| **Firefox .xpi موقّع self-hosted** | لينك على `reidey.de/download` → تثبيت | ✅ | توقيع مجاني عبر AMO (بدون إدراج) |
| **Enterprise force-install** | **صفر خطوات** (يتثبّت تلقائياً) | ✅ | الشركة تدير أجهزة Chrome (سياسة `ExtensionInstallForcelist`) |

**التوصية:**
- **مدير فردي:** انشرها على **Chrome Web Store (unlisted)** — يضغط لينك من داخل لوحة رايدي «ثبّت الإضافة» → «Add to Chrome». أسهل شي، وتحديث تلقائي.
- **أسطول بأجهزة مُدارة:** **enterprise force-install** — تتثبّت لحالها بدون أي تدخّل من المستخدم.

## أسهل خطوة جاية (اختياري — نبنيها)

**الاقتران التلقائي:** نضيف content script على دومين لوحة رايدي يقرأ التوكن + الـURL تلقائياً من الصفحة ويحفظهم بالإضافة. عندها تصير التجربة: **ثبّت الإضافة (ضغطة) → افتح لوحة رايدي (تقترن لحالها) → افتح أوبر وسجّل دخول → خلص.** بدون لصق توكن نهائياً.
