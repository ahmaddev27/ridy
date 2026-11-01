# تصميم: تسجيل دخول أوبر بدون باسوورد (إيميل + كود 4 أرقام) — المتغيّران A و B

**الحالة:** تصميم فقط، لا كود. **التاريخ:** 2026-11-01. **المالك وافق على البناء** (A + B).
**الهدف:** إعادة الدخول/إعادة المصادقة الشهرية لأوبر من لوحة Reidey **بدون الإضافة (extension)** وبدون باسوورد.

- **A (ترحيل بشري):** المدير يكتب إيميل حساب أوبر في صفحة Reidey ← أوبر يرسل كوداً من 4 أرقام ← المدير يقرأه من إيميله/واتسابه ويكتبه في Reidey ← الباكند يمرّره لـ uber-auth ← تُلتقط الجلسة.
- **B (آلي بالكامل):** حساب أوبر يتحقق عبر **Email** + الشركة تضبط إعادة توجيه تلقائية لإيميل أوبر إلى عنوان استقبال Reidey ← نستخلص الكود ونحقنه تلقائياً. **B = A + مسار استقبال إيميل واحد.**

---

## 0. تغيير الموقف (Posture change) — يُنسَخ حرفياً إلى docs/23

> **قرار المالك بتاريخ 2026-11-01:** الحدّ القديم «لا نخزّن باسوورد أوبر ولا نؤتمت الـOTP» (docs/23 أعلى الملف، وذاكرة
> `session-monthly-reauth-needs-human`) **مُعدَّل**: يُسمح بأتمتة إدخال كود التحقق الأحادي (OTP) لحساب أوبر **الخاص بالمؤسسة نفسها**
> عبر الإيميل (المتغيّر B)، **مقيَّداً بعلم لكل شركة (opt-in، الافتراضي OFF)**.
> هذا **قرار المالك وتحمُّله لمخاطر شروط الاستخدام (ToS)** لدى أوبر (خطر: حظر/تقييد الحساب عند اكتشاف أتمتة الدخول). Reidey لا تضمن عدم الحظر.
> ما **لم** يتغيّر: (1) لا باسوورد مخزَّن أصلاً — دخول أوبر passwordless. (2) لا نخزّن ولا نسجّل **الكود** أبداً. (3) القاعدة الذهبية #1:
> الحصول على جلسة المؤسسة **ليس** كتابة جديدة على أوبر؛ الكتابة الوحيدة تبقى decline من الـdispatch. (4) لا نقبل (accept) ولا نتصرّف نيابة عن السائق.
> ما زالت مرفوضة: passkey تحتفظ به Reidey، حذف passkeys المنافسين، تسجيل دخول headless بباسوورد مخزَّن.

التعديل المطلوب في docs/23: سطر «الحدّ الثابت» يُستبدل بإحالة إلى هذا القسم + docs/27.

---

## 1. مبادئ ثابتة للتصميم

1. **المتصفح لا يكلّم uber-auth أبداً.** الباكند وحده يملك `X-Auth-Secret` (`UBER_AUTH_URL/UBER_AUTH_SECRET` موجودان في docker-compose.prod.yml).
2. **`login_id` سرّ داخلي:** يبقى في الباكند (cache)، **لا يُرسَل للمتصفح**. الواجهة تتكلّم بمفهوم «محاولة دخول الشركة الحالية» فقط. هذا يسدّ ثغرة تخمين/تبديل login_id بين الشركات.
3. **محاولة دخول واحدة معلّقة لكل شركة** (قفل + مفتاح cache واحد لكل tenant).
4. **الكود parse-and-discard:** لا DB، لا queue payload، لا log، لا Sentry، لا activity log (§7).
5. **كل شيء خلف علم، OFF افتراضياً، قابل للتراجع بقلب علم** (§6، §10).
6. طبقات: Controller رفيع ← Service ← Repository/Store ← Model، كما في بقية `app/Domain/**`.

---

## 2. التسلسل الكامل

### 2.1 المتغيّر A (ترحيل بشري)

```
Manager(UI)        Next.js            Laravel                         uber-auth                    Uber
   | email            |                  |                               |                            |
   |----------------->| POST /api/v1/uber-login/start {email}            |                            |
   |                  |----------------->| UberLoginController::start    |                            |
   |                  |                  |  -> PasswordlessLoginService::start(tenant,email)          |
   |                  |                  |     gates: global env + tenant flag + can:connections.manage
   |                  |                  |     LoginAttemptStore::lock(tenant)                         |
   |                  |                  |  -> UberAuthClient::startLogin(tenant,email,channel=email)  |
   |                  |                  |------------------------------>| POST /login/start          |
   |                  |                  |                               | manager.markLoggingIn(key) |
   |                  |                  |                               | browser.startLogin() --------> vsdispatch login
   |                  |                  |                               | detectStep: channel_choice |
   |                  |                  |                               |   -> More options -> Email  |
   |                  |                  |                               | detectStep: otp  <---------- Uber sends 4-digit code
   |                  |                  |<------------------------------| {mfa_required, login_id, channel:"email", expires_at}
   |                  |                  |  LoginAttemptStore::put(tenant,{login_id,mode:manual,...},TTL 290s)
   |                  |<-----------------| 202 {state:"awaiting_code", channel, expires_at}
   | reads code (own inbox/phone) ...
   | code             | POST /api/v1/uber-login/code {code:"1234"}        |                            |
   |----------------->|----------------->| UberLoginController::code -> Service::submitCode(tenant,code,'manual')
   |                  |                  |  attempt = store.get(tenant)  (login_id)                    |
   |                  |                  |------------------------------>| POST /login/mfa {login_id,code,company_key}
   |                  |                  |                               | submitMfa -> typeOtp -> Uber verifies
   |                  |                  |                               | onLoginSuccess -> adoptLogin(key,session,result)
   |                  |                  |                               |   -> manager.renew()  (dual-jar capture)
   |                  |                  |                               |   -> postCapture ----------> POST /internal/session-browser/{tenant}/capture
   |                  |                  |                               |                              -> FleetSessionService::capture(via: VIA_BROWSER)
   |                  |                  |<------------------------------| {status:"success", persistent:true, org_uuid}
   |                  |                  |  store.forget(tenant); state -> active
   |                  |<-----------------| 200 {state:"connected"}
```

### 2.2 المتغيّر B (آلي)

```
(مرة واحدة) المدير يفعّل auto_code + ينسخ عنوان الاستقبال  uber-<token>@in.reidey.de  + يضبط forwarding في إيميله (فلتر على "Uber verification code" فقط)

Trigger:  أ) المدير يضغط "Start" (mode=auto لأن auto_code مفعّل)    ب) uber-auth يدفع status=needs_otp  -> الباكند يطلق AutoReloginJob (§5)
   Laravel: Service::start(tenant,email,mode=auto) -> UberAuthClient::startLogin (نفس A) -> store.put({login_id, mode:auto, started_at})

Uber --(email "code 1234")--> إيميل الشركة --(forward)--> in.reidey.de (MX = VPS Reidey)
   Postfix (receive-only, transport=pipe) -> php artisan inbound-mail:ingest  (stdin = raw MIME, rcpt=uber-<token>@in.reidey.de)
      InboundMailHandler::handle(raw, rcpt):
        1 tenant = InboundAddressResolver::resolve(token(rcpt))          // hash lookup، غير موجود -> drop صامت
        2 DkimVerifier::passes(raw, d=uber.com aligned with From)         // فشل -> drop
        3 attempt = LoginAttemptStore::get(tenant) && mode=auto && message.Date في [started_at-60s, now]   // لا محاولة معلّقة -> drop
        4 ReplayGuard::first(hash(Message-ID))                            // مكرّر -> drop
        5 code = UberCodeExtractor::extract(subject,text)                 // null -> drop (لا log للمحتوى)
        6 Service::submitCode(tenant, code, source:'inbound') -> UberAuthClient::submitCode(login_id, code, company_key)
        7 unset(raw, code)
   uber-auth: نفس مسار A بعد /login/mfa -> capture -> active
Next.js: الصفحة تعمل polling على GET /uber-login/status حتى state=connected (أو fallback §8)
```

**الملفات/الدوال الملموسة:**

| الطبقة | ملف | تغيير |
|---|---|---|
| uber-auth | `src/server.js` `handleStart` (السطر ~80) | إزالة رفض غياب `password` (422) → يشترط `email` فقط؛ تمرير `channel`؛ استدعاء `manager.markLoggingIn`؛ فحص `company_key` في `handleMfa`؛ sweeper يعيد الحالة |
| uber-auth | `src/browser.js` `startLogin`, `detectStep`, `submitMfa` | خطوة `channel_choice`، password اختياري، `locale` ثابت |
| uber-auth | `src/sessionManager.js` | `markLoggingIn` (موجود) + `markNeedsOtp` (جديد: العودة عند الفشل/انتهاء TTL) |
| uber-auth | `src/persistent.js` `adoptLogin` | بلا تغيير (يستمر → renew → postCapture) |
| backend | `app/Domain/Dispatch/UberAuthClient.php` | استعادة من `git show 4877daa^:...` + `submitCode`, `cancel` |
| backend | `app/Domain/Dispatch/PasswordlessLoginService.php` | جديد: start/submitCode/cancel/status |
| backend | `app/Domain/Dispatch/LoginAttemptStore.php` | جديد (Repository فوق Cache) |
| backend | `app/Domain/Dispatch/PasswordlessLoginSettings.php` | قراءة/كتابة `tenants.settings['passwordless_login']` |
| backend | `app/Domain/Dispatch/Inbound/{InboundMailHandler,InboundAddressResolver,DkimVerifier,UberCodeExtractor,ReplayGuard}.php` | جديد (B) |
| backend | `app/Console/Commands/IngestInboundMail.php` | جديد (B، نقطة دخول pipe) |
| backend | `app/Http/Controllers/Api/V1/UberLoginController.php` | جديد، رفيع |
| backend | `app/Http/Controllers/Api/V1/Admin/UberLoginFlagController.php` | جديد: علم `enabled` (super-admin) |
| backend | `app/Jobs/AutoReloginJob.php` | جديد: يحمل `tenant_id` فقط |
| backend | `routes/api.php` (قرب `extension/token` ~388) + `config/services.php` (`uber_auth`) | مسارات + إعداد |
| backend | معالج دفع الحالة في `Internal\SessionBrowserController` | عند `needs_otp` → قرار A/B (§5) |
| frontend | بطاقة في صفحة الاتصال + `lib/api` + i18n de/en/ar | واجهة + polling |

---

## 3. العقود الدقيقة (مجمّدة)

### 3.1 uber-auth (تغييرات)

**`POST /login/start`** — Header `X-Auth-Secret`. Body:
```json
{ "email": "ops@fleet.de", "company_key": "42", "channel": "email", "password": null }
```
- `email` مطلوب. `password` **اختياري** (legacy، يُتجاهل إن غاب). `channel`: `"email"` (الافتراضي هنا). `company_key` مطلوب لمسار الإنتاج (لا one-shot بلا company_key في هذا التدفق).
- 422 فقط إن غاب `email` (يُزال شرط password).
- الردود (HTTP 200 ما لم يُذكر):
  - `{"status":"mfa_required","login_id":"<uuid>","channel":"email|sms|whatsapp|unknown","code_length":4,"expires_at":"<ISO8601 Europe/Berlin>"}`
  - `{"status":"success","persistent":true,"org_uuid":"..."}` (جلسة قائمة/لا حاجة لكود)
  - `{"status":"passkey_unsupported"}`
  - `{"status":"blocked","message":"arkose|datacenter_ip"}` (جديد)
  - `{"status":"channel_unavailable"}` (لم نجد خيار Email؛ يُنقل لـA/يدوي)
  - `{"status":"password_required"}` (أوبر طلب باسوورد، لا نملكه)
  - `{"status":"error","message":"..."}`
- سلوك: `manager.markLoggingIn(company_key)` عند البدء؛ أي نتيجة غير `mfa_required/success` ← `manager.markNeedsOtp(company_key)` (يعيد الحالة السابقة).

**`POST /login/mfa`** Body: `{"login_id","code":"\\d{4,8}","company_key":"42"}`
- 404 `unknown or expired login_id`؛ **403 `company_mismatch`** إذا `company_key` ≠ `entry.companyKey` (جديد، عزل tenants).
- ردود: `{"status":"success",...}` | `{"status":"mfa_required","login_id":"..","retry":true}` | `{"status":"error|blocked|passkey_unsupported"}`.
- `code` لا يُسجَّل: `readJson` لا يُطبع، لا `console.log(body)`، ولا تُمرَّر الأخطاء مع النص الخام.

**`POST /login/cancel`** كما هو + `markNeedsOtp` عند الإلغاء. TTL pending **5 دقائق** كما هو؛ عند انتهائه الـsweeper يغلق المتصفح ويستدعي `markNeedsOtp`.

**`browser.js`:**
- `startLogin({email, password?, channel, proxy})`: يثبّت `locale:'en-US'` للـcontext (يوحّد النصوص)، ويستخدم **نفس محلّ البروكسي لكل شركة المضاف في #266** (للاتساق مع بصمة الجلسة؛ المنفّذ يستعمل نفس resolver ولا يخترع آخر). يُملأ الإيميل ثم يُقرر `detectStep()`.
- `detectStep()` يُضاف إليه `channel_choice` (شاشة «Welcome back»/«More options»/اختيار طريقة التحقق). المعالجة: النقر على «More options» ثم خيار Email (locators نصّية متسامحة: `/^e-?mail$/i`, «E-Mail», «Weitere Optionen», «More options»؛ تُضبط على لقطات حيّة). إن غاب الخيار → `channel_unavailable`.
- إن ظهرت خطوة `password` بلا password → محاولة رابط «use code instead/Send code»؛ إن لم يوجد → `password_required`.
- `typeOtp` الحالي (حقل واحد أو خانات) يبقى لـ`submitMfa`. إن اختلفت `code_length` عن 4 يُرجع الطول الفعلي.

### 3.2 مسارات الباكند (مستأجَر-النطاق)

داخل نفس مجموعة `auth` للمستأجر (مثل `extension/token`)، middleware: `can:connections.manage`، `throttle:uber-login` (5/دقيقة/tenant، `code` 10/دقيقة)، **بدون** `fleet.connected` (لأن الهدف هو الاتصال). ويُفلتر كل شيء بعلم الشركة (§6): غير مفعّل → `404`.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/v1/uber-login/start` | `{email:string(email,max:255), mode?:"manual"\|"auto"}` | `202 {data:{state,mode,channel,expires_at,code_length}}` |
| POST | `/api/v1/uber-login/code` | `{code:string(digits,4..8)}` | `200 {data:{state,retry?:bool}}` |
| POST | `/api/v1/uber-login/cancel` | — | `200 {data:{state:"idle"}}` |
| GET | `/api/v1/uber-login/status` | — | `200 {data:{state,mode,channel,expires_at,failure?}}` |
| GET | `/api/v1/uber-login/settings` | — | `{data:{enabled,email,auto_code,auto_relogin,inbound_address\|null}}` |
| PUT | `/api/v1/uber-login/settings` | `{email?,auto_code?,auto_relogin?}` | نفس GET |
| POST | `/api/v1/uber-login/inbound-address/rotate` | — | `{data:{inbound_address}}` (يُظهر العنوان الجديد مرّة؛ نخزّن hash فقط) |
| PUT | `/api/v1/admin/companies/{tenant}/uber-login/flag` | `{enabled:bool}` | super-admin فقط (opt-in للشركة) |

`state` ∈ `idle | starting | awaiting_code | submitting | connected | failed`. `failure` ∈ `passkey_unsupported | blocked | channel_unavailable | password_required | code_timeout | wrong_code | unavailable | not_enabled`.
`mode` الافتراضي: `auto` إن كان `auto_code=true` وعنوان الاستقبال مُعدّ، وإلا `manual`. لا يُعاد `login_id` ولا أي cookies في أي رد. أخطاء uber-auth تُحوَّل إلى `failure` محدد، لا نصّ خام (كما فعل `publicResult` القديم).
استدعاءات uber-auth: `timeout(90)` لـstart، `30` لـmfa؛ تُنفَّذ **متزامنة** داخل الطلب (الكود لا يدخل queue).

### 3.3 مخزن الربط login_id ↔ tenant

- **Cache (Redis إن وُجد، وإلا database cache)، لا عمود ولا migration.** حالة عابرة تنتهي بعد 5 دقائق، ولا قيمة لاستمراريتها بعد إعادة تشغيل (uber-auth `pending` في الذاكرة أصلاً وستضيع معه).
- المفتاح: `uber_login:attempt:{tenant_id}` (واحد لكل شركة) → `{login_id, mode, channel, email_hash, started_at, expires_at, submits:int, auto_submitted:bool}`. **لا كود، لا إيميل صريح** (hash للمقارنة فقط).
- TTL = **290 ثانية** (أقصر قليلاً من 300 ثانية لـuber-auth حتى لا نحمل `login_id` ميتاً).
- قفل: `Cache::lock('uber_login:lock:{tenant_id}', 10)` حول start/submit لمنع التسابق. `start` ثانٍ أثناء محاولة معلّقة ← إلغاء القديمة (`/login/cancel`) ثم بدء الجديدة.
- `ReplayGuard`: مفتاح `uber_login:msg:{sha256(Message-ID)}` TTL 10 دقائق (hash لمعرّف الرسالة وليس الكود).

---

## 4. تصميم استقبال الإيميل (B)

### 4.1 الخيارات

| | **1. Postfix استقبال فقط على VPS + pipe إلى artisan** | **2. صندوق IMAP تملكه Reidey + عامل IDLE/polling** | **3. خدمة inbound-parse (Postmark/Mailgun/SendGrid EU) → webhook** |
|---|---|---|---|
| مرور الـOTP | **داخلي بالكامل** | داخلي إن كان الاستضافة ذاتية (Mailcow/Dovecot)، طرف ثالث إن Google/Microsoft | **طرف ثالث يرى الكود** (يحتاج AVV/DPA، منطقة EU) |
| تخزين | لا صندوق بريد؛ طابور Postfix عابر فقط | الرسالة **تبقى في الصندوق** حتى نحذفها (يجب حذف فوري + expunge) | يحتفظ المزوّد بالرسائل أياماً (قابل للضبط) |
| التأخير | ثوانٍ | polling 5–15s أو IDLE | ثوانٍ |
| الـops | منفذ 25 مفتوح، MX/PTR/SPF للنطاق الفرعي، opendkim/تحقق DKIM، مراقبة | خادم بريد كامل أو حساب مزوّد + امتداد imap | الأبسط: webhook موقّع، لا منفذ 25 |
| الموثوقية | خطر: IP VPS مدرج في قوائم سوداء يؤثر على الاستقبال قليلاً (استقبال فقط، أخف من الإرسال) | جيدة | الأعلى |
| الاتساق مع «detect, don't surveil» | **الأفضل** | جيد/متوسط | الأضعف |

### 4.2 التوصية

**الخيار 1 (Postfix استقبال فقط + pipe)** كافتراضي، على نطاق فرعي مخصّص `in.reidey.de` (MX فقط، لا إرسال منه، ولا يختلط ببريد Reidey الحالي).
**السبب:** الـOTP لا يغادر بنية Reidey، بلا صندوق يتراكم، وأقل سطح. **بديل مقبول للمرحلة الأولى إن كلفة الـops عالية:** الخيار 3 بعد توقيع AVV وبمنطقة EU، لأنه لا يغيّر شيئاً في الكود بعد `InboundMailHandler` (نفس الخدمة، فقط `InboundMailController` رفيع يحوّل payload المزوّد إلى raw/نص ويتحقق من توقيع webhook). لذلك نبني **`InboundMailHandler` مستقلاً عن النقل** (واجهة `InboundMailSource` ضمنية: raw MIME + rcpt).

إعداد Postfix المقترح (للمنفّذ/ops): `in.reidey.de` في `virtual_alias_domains` ← transport `reidey-inbound` = `pipe` يستدعي `docker compose exec -T backend php artisan inbound-mail:ingest --rcpt=${original_recipient}`؛ `smtpd_recipient_restrictions` يرفض أي مستلم غير `uber-*@in.reidey.de`؛ حدّ حجم 256KB؛ `maximal_queue_lifetime` للـtransport = 10 دقائق؛ بدون `always_bcc`، بدون mailbox، بدون أرشيف. الأمر دائماً exit 0 بعد المعالجة (drop صامت للرسائل غير المرغوبة، لا bounce فلا backscatter)، و`EX_TEMPFAIL` فقط لعطل بنية تحتية.

### 4.3 أمان نقطة الاستقبال وربط الكود بالـtenant بلا إنسان

1. **العنوان = سرّ لكل شركة:** `uber-<token>@in.reidey.de`، `token` = 26 حرفاً عشوائياً (base32). نخزّن `sha256(token)` فقط في `settings['passwordless_login']['inbound_token_hash']` ونحلّ المستلم إلى tenant بالـhash. تدوير بـ`rotate`.
2. **المصادقة على المرسل:** SPF ينكسر مع إعادة التوجيه، لذلك نعتمد **DKIM**: توقيع صالح بـ`d=uber.com` (أو نطاق فرعي) ومحاذٍ مع `From`. الرسائل غير الموقّعة/الفاشلة تُسقَط. تحقق DKIM يتم داخل `DkimVerifier` (مكتبة PHP أو rspamd على MTA ويقرأ `Authentication-Results` الذي **يضيفه MTA نفسه فقط**؛ تُزال أي ترويسة مماثلة واردة).
3. **ربط بمحاولة معلّقة فقط:** لا شيء يُعالَج إلا إن وُجدت `attempt` للـtenant بـ`mode=auto` وغير مستهلكة (`auto_submitted=false`) وتاريخ الرسالة داخل `[started_at-60s, now]`. كود بلا محاولة ← يُسقَط فوراً (لا يُحفظ لاحقاً). هذا يمنع «زرع» كود قديم/مزيّف.
4. **منع التكرار:** `ReplayGuard` على `Message-ID`؛ محاولة آلية واحدة لكل `login_id` (`auto_submitted` يُرفع قبل الإرسال).
5. **حدود معدّل:** 10 رسائل/دقيقة/عنوان؛ فوقها drop. أي رسالة غير مطابقة لا تُسجَّل بمحتواها (يُسجَّل فقط عدّاد ومنطق السبب: `no_pending|bad_dkim|no_code|replay`).
6. **الاستخلاص:** `UberCodeExtractor::extract(string $subject, string $text): ?string` — يبحث أولاً في Subject ثم نص plain (تُنزع HTML tags)، regex سياقي (`(?:code|Code|Bestätigungscode)\D{0,20}(\d{4})`) ثم احتياطياً رقم 4 خانات منفرد **إن كان الوحيد** في النص؛ التباس (أكثر من مرشح) ← null. **لا يتبع روابط ولا يفتح مرفقات.** القالب الفعلي لإيميل أوبر يُؤكَّد بعينة حقيقية من المالك قبل تثبيت الـregex (بند مفتوح §11).
7. **الحقن:** `PasswordlessLoginService::submitCode(tenant, code, 'inbound')` ← `UberAuthClient::submitCode(login_id, code, company_key)`؛ لا retry آلي عند `retry:true` أو `error` ← الحالة `failed(wrong_code)` + سقوط إلى A (§8).
8. **إعداد forwarding عند الشركة:** يوصي الدليل (في الواجهة) بفلتر يعيد توجيه رسائل «verification code» من أوبر **فقط** لا كل بريد أوبر. وأيّ رسالة أخرى تصل تُسقط دون تخزين. Gmail يتطلب رسالة تأكيد لعنوان إعادة التوجيه: `InboundMailHandler` يتعرّف على مرسل `forwarding-noreply@google.com` ويُظهر للمدير (في الواجهة، مشفّراً في cache 15 دقيقة) رمز/رابط التأكيد مرّة واحدة؛ هذا مساعد إعداد وليس مسار دخول، وخلف نفس العلم. (إن تعقّد يُؤجَّل ويكتفى بدليل يدوي.)

---

## 5. الحالات والانتقالات

حالات المدير في uber-auth: `not_set_up, logging_in, active, needs_otp, down`. مرآة الباكند: `SessionBrowser::STATES`، و`FleetSession.status`: `active|expired|needs_relink`.

```
active --(Uber يطرد الجلسة: renew فاشل)--> needs_otp --notify(needs_otp)--> الباكند يقرّر:
   needs_otp --[A: يدوي]------------------> إشعار للمدير (push/إيميل لمن لديه connections.manage + رابط للصفحة)
                                             المدير يضغط Start -> logging_in(markLoggingIn) -> awaiting_code -> /login/mfa -> adoptLogin->renew -> active
   needs_otp --[B: auto_relogin+auto_code]-> AutoReloginJob(tenant_id) -> PasswordlessLoginService::start(mode=auto) -> logging_in
                                             -> forward email -> submitCode(inbound) -> adoptLogin -> active
   logging_in --(فشل/إلغاء/TTL 5min)--> markNeedsOtp --> needs_otp (+ fallback §8)
```

- `markLoggingIn(companyKey)` موجود لكن لا شيء يقوده؛ الآن يقوده `handleStart`. **لا مصالحة زمنية (timeline reconciler)** ولا شيء جديد في قياس القبول.
- **القرار A/B** في الباكند (يعرف الإيميل والأعلام)، لا في uber-auth (يبقى غبياً). عند وصول `needs_otp` عبر معالج الدفع الداخلي:
  1. العلم العام + علم الشركة `enabled` مفعّلان؟ لا ← السلوك الحالي (إشعار قديم).
  2. `auto_relogin && auto_code && email && inbound_token` ← `AutoReloginJob::dispatch($tenantId)->delay(rand 5-30s)`؛ قيود: حد أقصى **2 محاولة آلية/24 ساعة/شركة** مع backoff (15 دقيقة)، ولا محاولة أثناء `attempt` قائمة. بعد استنفاد الحدّ ← A.
  3. غير ذلك ← إشعار «مطلوب إعادة ربط» للمدير مع رابط (A).
- الـJob يحمل `tenant_id` **فقط**؛ لا إيميل ولا كود.

---

## 6. الأعلام (opt-in، OFF افتراضياً)

| العلم | أين | من يغيّره | أثره |
|---|---|---|---|
| `UBER_PASSWORDLESS_LOGIN` (env، kill switch عام) | backend `config/services.php` | ops | false ← كل المسارات 404 + AutoReloginJob لا يعمل |
| `UBER_AUTH_PASSWORDLESS` (env) | uber-auth | ops | false ← يبقى رفض password الحالي (422) |
| `tenants.settings['passwordless_login']['enabled']` | tenant | **super-admin** | بوابة الشركة (A) |
| `…['auto_code']` + `…['inbound_token_hash']` | tenant | `connections.manage` (بعد `enabled`) | يمكّن B (استقبال) |
| `…['auto_relogin']` | tenant | `connections.manage` | الإطلاق الآلي عند needs_otp |
| `…['email']` | tenant | `connections.manage` | إيميل حساب أوبر (معلومة، ليست سراً قاسياً؛ مقيّد بـ`Crypt` cast اتساقاً) |
| `UBER_PASSWORDLESS_TENANTS` (env allowlist) | backend | ops | تجربة تدريجية (نظير `UBER_AUTH_ONLY_TENANTS`) |

كل الأعلام مفقودة = OFF. لا سلوك قائم يتغيّر لأي شركة لم تُفعَّل.

---

## 7. معالجة الكود وDSGVO

- **المسارات التي يمرّ بها الكود:** طلب المدير (A) أو رسالة الإيميل في الذاكرة (B) ← HTTP إلى uber-auth ← مدخل Uber. ثم يُهمَل (`unset`).
- **ممنوع:** DB، cache (لا يُخزَّن حتى في `attempt`)، queue/job payload، Laravel logs، Sentry (breadcrumbs/request body)، activity log، access logs لـCaddy (الكود في **body** POST لا query)، `console.log` في uber-auth.
- تنفيذياً: إضافة `code` إلى `$dontFlash`؛ Sentry `before_send` يمسح `request.data.code` وأي breadcrumb لمسارات `uber-login/*`؛ `Http::` بدون `->withOptions(['debug'=>true])`؛ تعطيل تسجيل body في المراقبة/Telescope إن وُجد؛ نفس التعتيم في Sentry لـuber-auth.
- **ما نسجّله (activity log):** حدث `uber_login.started|connected|failed` + `mode` + `channel` + `failure` + المستخدم + الوقت (Berlin). بلا إيميل صريح (hash مختصر) وبلا كود.
- **الإيميل المُعاد توجيهه:** معالج في الذاكرة، لا تخزين لجسم الرسالة، لا أرشفة. الحد الأدنى من البيانات: نقرأ Subject + نص plain فقط. حقوق صاحب الحساب: نصيحة في الواجهة بفلتر الإعادة الضيّق.
- **الوثائق القانونية:** إدراج «معالجة إيميل التحقق لحساب المؤسسة» في سجل المعالجة (VVT)؛ إن اختير الخيار 3 يلزم AVV مع المزوّد.

---

## 8. الفشل والرجوع (fallback)

| الحالة | الكشف | السلوك |
|---|---|---|
| حساب passkey | `passkey_unsupported` | `failed`؛ تعليمات: استخدم الإضافة/الربط اليدوي (المسار القديم يبقى) |
| Arkose / IP مركز بيانات | `blocked` من detectStep | استخدام بروكسي الشركة (#266) تلقائياً؛ إن بقي ← `failed(blocked)` + الربط بالإضافة. لا تدوير هويّات ولا حلّ captcha آلي |
| لا خيار Email | `channel_unavailable` | في B: سقوط إلى A (يدوي، الكود يصل لقناة أخرى) إن عاد المتصفح `mfa_required` بقناة غير email؛ وإلا `failed` |
| طلب باسوورد | `password_required` | `failed`؛ لا نخزّن باسوورد |
| انتهاء المهلة (5 د) | TTL cache/uber-auth | `failed(code_timeout)`، `markNeedsOtp`، المدير يعيد Start |
| كود خاطئ | `retry:true` | A: حتى **3** محاولات ضمن نفس login؛ B: محاولة آلية **واحدة** ثم يتحوّل `mode` إلى `manual` ويُشعَر المدير ليكتب الكود يدوياً ضمن نفس المهلة |
| B: لم يصل إيميل خلال 90 ثانية | مؤقّت في الواجهة/الـstatus | تلميح «أدخل الكود يدوياً» (مسار A متاح دائماً داخل نفس المحاولة) |
| uber-auth غير متاح | استثناء HTTP | `failed(unavailable)`، 503 للواجهة |
| ازدواج/تسابق | القفل | محاولة واحدة/شركة |

---

## 9. الواجهة (Next.js 16، بدون الإضافة)

بطاقة «تسجيل الدخول إلى أوبر بالكود» في صفحة الاتصال، تظهر فقط إن `settings.enabled`:
خطوة 1 إيميل + زر «أرسل الكود» ← خطوة 2 4 خانات (autofill `one-time-code`، `inputMode=numeric`، أرقام لاتينية حتى في العربية) + عدّاد 5 دقائق + «إلغاء» ← نجاح. في وضع auto: شاشة انتظار «بانتظار الكود التلقائي» مع polling كل ثانيتين (يتوقف عند `connected/failed`) + زر «أدخل يدوياً». قسم إعدادات: تفعيل auto_code/auto_relogin، عرض عنوان الاستقبال مع نسخ، تدوير، دليل إعداد forwarding (Gmail/Outlook). نصوص de (افتراضي)/en/ar مع RTL. أي مفتاح i18n جديد يُضاف للثلاث لغات. قبل الكتابة: قراءة `node_modules/next/dist/docs/`.

---

## 10. خطة البناء والتسليم

### العقد المجمّد (يلتزم به الجميع، أي تغيير = تعديل هذه الوثيقة أولاً)
§3.1 (uber-auth)، §3.2 (مسارات/حالات/failure)، §3.3 (مفاتيح cache وTTL 290)، §6 (أسماء الأعلام)، §4.3 (ترتيب فحوصات الاستقبال).

### عناصر العمل المتوازية
1. **uber-auth** (مستقل): `server.js` (relax password، فحص company_key، sweeper/markNeedsOtp، صفر logging للكود)، `browser.js` (channel_choice، locale، proxy #266، حالات الرد الجديدة)، `sessionManager.js::markNeedsOtp`. اختبارات `node --test` (قائمة الـ8 + حالات: بلا password، company_mismatch، channel_unavailable، TTL revert). تحقق: `node -c src/<file>.js`. **يشترط جولة حيّة على حساب تجريبي لضبط locators** قبل التفعيل.
2. **backend A:** `UberAuthClient` (استعادة+توسعة)، `PasswordlessLoginSettings`، `LoginAttemptStore`، `PasswordlessLoginService`، `UberLoginController`، `UberLoginFlagController`، المسارات/الـthrottle/الإعداد، تعتيم Sentry/`dontFlash`. اختبارات Pest/PHPUnit مع `Http::fake`: عزل tenants، الأعلام، عدم تسريب login_id/code، القفل، TTL.
3. **backend B:** `InboundMailHandler` + `DkimVerifier` + `UberCodeExtractor` + `ReplayGuard` + `InboundAddressResolver` + `IngestInboundMail` + `AutoReloginJob` + ربط معالج `needs_otp`. اختبارات: عينات إيميل (حقيقية بعد أن يزوّدنا المالك) + DKIM صالح/مزوّر + لا محاولة معلّقة + replay + التباس أرقام + عدم ظهور الكود في أي log (assert logs). يعتمد على 2 فقط عبر `PasswordlessLoginService::submitCode` (يمكن تنفيذه بالتوازي بـmock).
4. **frontend:** البطاقة + الإعدادات + i18n ×3 + polling؛ يعتمد على عقد §3.2 فقط (mock). تحقق: `npm run build`.
5. **ops/docs (بإشراف المالك):** Postfix + DNS (MX `in.reidey.de`، PTR، SPF للتخفيف) + تحديث docker-compose/CI حسب الحاجة؛ docs/23 (قسم §0)، `HANDOFF.md` (سطر change-log مؤرَّخ + قسم uber-auth)، `ROADMAP.md`، تحديث ذاكرة `session-monthly-reauth-needs-human`.

التحقق قبل الدمج: `backend`: `vendor/bin/pint --test && php artisan test`؛ `frontend`: `npm run build`؛ `uber-auth`: `node --test` و`node -c`.

### الإطلاق (قابل للتراجع)
- **P0:** نشر الكود، الأعلام OFF، لا أثر.
- **P1 (A):** شركة تجريبية واحدة (`UBER_PASSWORDLESS_TENANTS`) + `enabled`؛ التحقق أن الجلسة تُلتقط وتظل `active` وأن الإضافة ما زالت تعمل بالتوازي.
- **P2 (B):** ops يفتح MX؛ شركة تجريبية بـ`auto_code` ثم `auto_relogin` (آخراً).
- **التراجع:** أطفئ `auto_relogin` ← `auto_code` ← `enabled` ← env العام؛ أزل MX. لا migration، لا بيانات للتنظيف سوى مفاتيح settings (غير ضارّة).

---

## 11. أسئلة/مخاطر مفتوحة
1. **عينة حقيقية** لإيميل أوبر (Subject/نص/DKIM) لتثبيت `UberCodeExtractor` و`DkimVerifier` (اللغة: de/en).
2. **ToS/الحظر** على أتمتة الدخول: قرار المالك؛ نوصي بالبدء بشركة واحدة وقياس معدل 403/حظر قبل التوسّع.
3. هل يختار أوبر Email افتراضياً أم WhatsApp؟ (لقطات تؤكد مسار «More options → Email»)، وهل يتغيّر بحسب الحساب؟
4. صلاحية كود أوبر الفعلية (نفترض ≥5 دقائق).
5. ملف `proxy` في #266: تأكيد اسم الدالة/الإعداد الذي يُعاد استخدامه في `browser.js::startLogin`.
6. مساعد تأكيد Gmail forwarding: هل نبنيه الآن أم دليل يدوي؟ (مقترح: دليل يدوي أولاً).
7. تعارض لحظي: دخول جديد يفتح جلسة أوبر ثانية قد يطرد الجلسة الحالية للمتصفح الدائم — يُختبر في P1.
