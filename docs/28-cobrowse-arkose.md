# تصميم: Co-browse لحلّ تحدّي Arkose داخل متصفح السيرفر (بدون الإضافة)

**الحالة:** تصميم فقط، لا كود. **التاريخ:** 2026-11-01. **يعتمد على:** docs/27 (تسجيل الدخول بدون باسوورد A/B) و#266 (بروكسي لكل شركة + بصمة Chrome حقيقي) و docs/23 (متصفح الجلسة الدائم).
**الهدف:** عندما يعترض Arkose ("Protecting your account / Start Puzzle") أول دخول بارد (أو إعادة مصادقة قاسية)، يحلّ **مدير الشركة بنفسه** اللغز **داخل متصفح السيرفر نفسه** (نفس IP السكني ونفس البصمة التي ستحمل الجلسة)، عبر بثّ تبويب الدخول فقط ونقل مدخلاته. هذا يُنهي آخر دور لا يمكن الاستغناء عنه للإضافة (Arkose bootstrap).

---

## 0. القيود الملزِمة (لا تُكسَر)

1. **القاعدة الذهبية #1:** لا كتابة جديدة على أوبر. المدير الذي يحلّ اللغز ويُكمل دخوله هو إنسان يتصرّف في حسابه، وليس Reidey تكتب. لا accept، لا trip، لا رسائل. الكتابة الوحيدة تبقى decline من الـdispatch.
2. **لا حلّ آلي لـArkose:** لا مزارع captcha ولا نموذج رؤية ولا تدوير هويات (ToS + حظر + اكتشاف عدم تطابق IP/بصمة). الحلّ بشري فقط، وفي سياق المتصفح الذي سيحمل الجلسة.
3. **DSGVO "detect, don't surveil":** البثّ **محصور بتبويب الدخول فقط**؛ لا تبويبات أخرى، لا cookies، لا بيانات مستأجرين آخرين. **لا شيء من البثّ يُسجَّل أو يُخزَّن** (لا فيديو، لا لقطات، لا إحداثيات). توكن/حلّ Arkose عابر في ذاكرة المتصفح ولا نلمسه.
4. **علم، OFF افتراضياً، opt-in، قابل للتراجع**، ومقيَّد بـ`connections.manage`. الإضافة تبقى المسار الاحتياطي الأخير حتى يثبت هذا المسار.
5. لا تغيير في ثوابت docs/27 المجمّدة إلا بالتعديلات المسمّاة في §10 (هذه الوثيقة تعدّلها صراحةً).

---

## 1. نقل البثّ: CDP screencast مقابل noVNC

| | **(a) CDP `Page.startScreencast` + `Input.dispatchMouseEvent`** عبر WebSocket إلى `<canvas>` | **(b) noVNC على شاشة Xvfb** |
|---|---|---|
| نطاق ما يُعرض | **صفحة واحدة** (CDP session مرتبط بالـPage) | **الشاشة كلها** |
| العزل بين المستأجرين | ممتاز: كل شركة لها `browser` خاصة (`launchBrowser` لكل شركة)، والـCDP session يُنشأ للصفحة فقط | **سيّئ:** Xvfb واحد تشاركه متصفحات كل الشركات، فـVNC يكشف نوافذ شركات أخرى، وعزل الشاشة بحاجة Xvfb لكل شركة |
| تحكّم بالمدخلات | كامل: نسمح بنقر الماوس فقط ونفلتر الباقي في الخادم | مفتوح: لوحة مفاتيح كاملة، اختصارات نظام، شريط عنوان Chrome (headed)، يمكن التنقل لأي مكان |
| لا إطار Chrome (chrome UI) | يظهر محتوى الصفحة فقط | يظهر شريط العنوان/التبويبات (headed) = مسار هروب |
| التبعيات | لا شيء جديد (Playwright يعطي `context.newCDPSession(page)`) | x11vnc + websockify + noVNC + إدارة DISPLAY لكل شركة |
| الجودة/الكمون | JPEG مضغوط، تحكّم بالجودة والحجم، backpressure عبر `screencastFrameAck` | جيد لكن أثقل وأقل تحكماً |

**التوصية: (a) CDP screencast.** السبب الحاسم: العزل (صفحة واحدة، مستأجر واحد) وإمكانية تقييد المدخلات في الخادم. noVNC مرفوض لأنه يكشف عرض Xvfb المشترك ويفتح لوحة المفاتيح/شريط العنوان.

**هل يعمل مع iframe الخاص بـArkose (cross-origin / OOPIF)؟** نعم، حسب آلية Chrome:
- الـscreencast يلتقط **سطح التركيب المركّب (composited surface)** للتبويب، والـOOPIF يُركَّب ضمن سطح الصفحة الأم، فيظهر لغز Arkose في الإطارات كجزء عادي من الصورة.
- `Input.dispatchMouseEvent` على target الصفحة يمرّ بعملية المتصفح (browser process) التي تقوم بـhit-testing وتوجّه الحدث إلى الإطار الصحيح (OOPIF) تلقائياً؛ هكذا تعمل أدوات live-view القائمة على CDP (Browserless وغيره). إحداثيات الحدث في إحداثيات viewport الصفحة الأم، لا حاجة لمعرفة موضع الـiframe.
- **ليس مؤكَّداً بالتجربة عندنا بعد** → هذا هو **Spike 0 (§9)**: يجب إثبات (1) ظهور اللغز في البثّ، (2) قبول Arkose للنقرات المنقولة (لا رفض بسبب توقيت/pointer-type)، قبل بناء أي شيء آخر. معيار الإلغاء: نجاح < ~70% على 10 محاولات حيّة بمدير بشري = نوقف المشروع ونُبقي الإضافة.

**أين يمر البثّ؟ (Reverb؟)** Reverb/Pusher بروتوكولاً لا يصلح للإطارات: حدّ حجم الرسالة الافتراضي ~10KB، وبروتوكول JSON/نصي، وبطء/تكلفة PHP لبثّ 10–20 إطار/ثانية. **القرار:** WebSocket **مخصّص ثنائي** يُقدَّم من **uber-auth** نفسها على منفذ مستقل (`COBROWSE_PORT`)، ويُنشر عبر Caddy تحت مسار `/cobrowse/ws` فقط (انظر §2.4). Reverb يبقى لما صُمم له (إشارات الحالة إن لزم)، لكن حالة الدخول تبقى polling كل ثانيتين كما في docs/27 §9، فلا حاجة لـReverb هنا. **استثناء مقصود** من مبدأ docs/27 #1 ("المتصفح لا يكلّم uber-auth"): المتصفح يكلّم **قناة البثّ فقط** بتذكرة موقّعة من الباكند، لا واجهة `/login/*` أبداً.

---

## 2. النطاق والعزل ووسيط الجلسة (broker)

### 2.1 ما الذي يُكشف (وما لا يُكشف)
- **صفحة الدخول فقط** من `browser`/`context` الخاصة بشركة واحدة. CDP session يُنشأ بـ`context.newCDPSession(page)` على **الـPage** التي يملكها `pending[login_id]` (تدفق الدخول)، وليس على `Browser` ولا على Target آخر؛ لا استدعاء لـ`Target.*` ولا `Browser.*` ولا `Network.getCookies`.
- لا يوجد في متصفح الدخول (pending login) سوى تبويب الدخول، لكن نمنع التوسّع: أي `popup`/صفحة جديدة في الـcontext تُغلق فوراً، والتنزيلات تُلغى، والـdialogs تُرفض.
- مستأجر آخر لا يمكن الوصول إليه: التذكرة مرتبطة بـ`company_key`، والخادم يبحث عن `pending` بـ(`login_id`,`company_key`) معاً (نفس فحص `company_mismatch` في docs/27 §3.1).

### 2.2 من يفتح الجلسة
مستخدم لوحة بصلاحية `can:connections.manage` لشركة محاولتها الحالية في حالة `awaiting_challenge`. الواجهة لا ترى `login_id` ولا أسراره (مبدأ docs/27 #2 يبقى).

### 2.3 دورة التذكرة (ticket)
1. الواجهة: `POST /api/v1/uber-login/cobrowse` (محمي بنفس middleware + throttle).
2. الباكند يتحقق: العلم العالمي + علم الشركة + الحالة `awaiting_challenge` + قفل الشركة + حدّ الجلسات (§4). ثم يوقّع **تذكرة قصيرة الأجل**: HMAC-SHA256 بسرّ مشترك (`UBER_AUTH_SECRET` مشتق باسم مجال منفصل `cobrowse-v1`) على الحمولة `{tid: tenant_id, sid: cobrowse_id (uuid), lh: sha256(login_id) مختصر, uid: user_id, jti, exp: now+60s}`. لا cookies، لا `login_id` صريح في التذكرة.
3. يرد: `201 {data:{ws_url, ticket, expires_at, viewport:{w,h}, session_ttl}}`.
4. الواجهة تفتح WebSocket إلى `ws_url?ticket=...` (أو أول رسالة تحمل التذكرة؛ **ليس** في log الـquery إن أمكن، يفضَّل الرسالة الأولى).
5. uber-auth يتحقق من: التوقيع، `exp`، `jti` غير مستعمل (مجموعة في الذاكرة)، `Origin` ∈ قائمة بيضاء (`COBROWSE_ALLOWED_ORIGINS` = أصل الواجهة)، وجود `pending` مطابق للـ`company_key`+`lh` وفي حالة challenge. التذكرة **أحادية الاستعمال**.
6. **مشاهد واحد:** اتصال ثانٍ لنفس `sid` يُرفض (لا استبدال صامت)، ولا يُسمح باتصال لشركة لديها جلسة بثّ حيّة.

### 2.4 الشبكة
uber-auth تبقى واجهتها الداخلية (`/login/*`، السرّ `X-Auth-Secret`) غير منشورة. **مستمع HTTP/WS ثانٍ** على `COBROWSE_PORT` لا يخدم سوى ترقية WebSocket على `/cobrowse/ws`. Caddy: `reverse_proxy /cobrowse/* uber-auth:COBROWSE_PORT` فقط. (الملف `docker/Caddyfile` + `docker-compose.prod.yml` — عمل ops.) TLS عبر Caddy الحالي (`wss://`).

### 2.5 الإنهاء
تنتهي الجلسة عند أول: نجاح (الخروج من حالة challenge إلى otp/landed)، فشل، إغلاق المشاهد، انقطاع الخمول (60ث بلا مدخلات)، السقف الصلب (8 دقائق)، إلغاء المدير، أو انتهاك أمني (§4). عند الإنهاء: `Page.stopScreencast`، فصل CDP session، إغلاق الـWS، مسح كل الحالة المرتبطة بالذاكرة. إن فشل → `/login/cancel` يغلق المتصفح (`markNeedsOtp` كما في docs/27).

---

## 3. التكامل مع تدفق docs/27

اليوم: `blocked(arkose)` ← `failed(blocked)` + "اربط بالإضافة". **الجديد:** عند اكتشاف Arkose والعلم مفعّل، يُبقى المتصفح مفتوحاً وتنتقل المحاولة إلى حالة `awaiting_challenge`.

### 3.1 تسلسل (A و B متطابقان حتى لحظة الـOTP)
```
Manager(UI)        Laravel                        uber-auth                         Uber
  | Start(email)     |-- /login/start {cobrowse:true} -->|  fill email -> detectStep   |
  |                  |<- {status:"challenge_required", login_id, challenge:"arkose",   |
  |                  |    expires_at}                    |  (browser stays open)        |
  |<- state=awaiting_challenge                           |                              |
  | "Solve puzzle" -> POST /uber-login/cobrowse (ticket) |                              |
  |== wss /cobrowse/ws (ticket) =======================>| screencast + input relay     |
  |   manager clicks the puzzle                          |-- dispatchMouseEvent ------->| Arkose iframe
  |                  |-- POST /login/resume (long-poll) ->| detectStep ... until leaves  |
  |                  |<- {status:"mfa_required", ...}    |  challenge; OTP sent  <------| 4-digit code
  |  stream closed by server on leaving challenge        |                              |
  |  then exactly docs/27: A (manager types code) / B (auto-email) ...
```
**نقطة جوهرية:** البثّ **يُقفل قبل خطوة الـOTP** (عند أول انتقال خارج challenge) حتى لا يمرّ الكود/حقل الإدخال في الصورة؛ والكود يبقى parse-and-discard بالمسار نفسه في docs/27 §7.

### 3.2 إضافات uber-auth (عقد)
- `POST /login/start` يقبل `cobrowse?: boolean`. إن اكتشف Arkose: بدل `blocked(arkose)` يرد `{"status":"challenge_required","login_id":"<uuid>","challenge":"arkose","expires_at":"<ISO8601 Europe/Berlin>"}` ويُبقي الجلسة في `pending` (لا يُغلق المتصفح). بدون `cobrowse:true` أو بلا شروط §6: السلوك القديم (`blocked(arkose)`).
- `POST /login/resume` Body `{login_id, company_key}`: long-poll حتى 25ث؛ يرد أحد: `challenge_required` (ما زال) | `mfa_required{...}` | `success{...}` | `blocked{message}` | `challenge_failed` | `challenge_timeout` | `passkey_unsupported`. 404/403 كما `/login/mfa`.
- كشف الخروج من challenge: اختفاء إطار Arkose/نصّ "Start Puzzle" وتغيّر `detectStep()` إلى `otp|password|landed|passkey`. عدّاد "تحدٍّ فاشل" (ظهور رسالة "try again"/إعادة اللغز) ≥3 ← `challenge_failed`.
- مستمع البثّ (§2.4): `GET /cobrowse/ws` (Upgrade). لا مسارات أخرى. `POST /cobrowse/close` داخلي (يستعمله الباكند عند cancel) بسرّ `X-Auth-Secret`.
- الـTTL أثناء challenge: `pending` يمدَّد إلى **10 دقائق** (سقف)، ثم عند `mfa_required` يبدأ عدّاد الـOTP 5 دقائق من جديد (الكود لا يُرسَل إلا بعد حلّ اللغز).

### 3.3 إضافات الباكند
- `state` يضاف: `awaiting_challenge`. `failure` يضاف: `challenge_timeout | challenge_failed | cobrowse_unavailable`. `GET /uber-login/status` يرجع `challenge:"arkose"` و`cobrowse_available:bool` أثناء الحالة.
- مسارات جديدة (مستأجَر-النطاق، `can:connections.manage`، بلا `fleet.connected`، نفس العلم؛ غير مفعّل ← 404):

| Method | Path | Response |
|---|---|---|
| POST | `/api/v1/uber-login/cobrowse` | `201 {data:{ws_url,ticket,expires_at,viewport,session_ttl}}` أو `409` (ليست في challenge) / `429` / `503 cobrowse_unavailable` |
| DELETE | `/api/v1/uber-login/cobrowse` | `200 {data:{state}}` (يغلق البثّ ويُلغي المحاولة) |

- `PasswordlessLoginService`: عند استلام `challenge_required` ← `LoginAttemptStore::put` مع `phase:"challenge"` وTTL 590ث (بدل 290، تعديل صريح لـdocs/27 §3.3)، ثم Job خفيف (أو استدعاء `resume` عند طلب `status`) يقرأ `/login/resume` ويحدّث الحالة؛ عند `mfa_required` يعود التدفق إلى مسار A/B دون تغيير (TTL 290).
- `resume` long-poll يجب ألا يحجز عامل HTTP للمتصفح: يُستدعى من `status` بمهلة قصيرة (≤5ث) أو من Job في الـqueue؛ الأول أبسط (YAGNI).

### 3.4 B بعد اللغز
إن كان `mode=auto`، فبعد `mfa_required` يستمر B كما في docs/27 (استقبال الإيميل → حقن الكود). حل اللغز بشري دائماً؛ لا يتغيّر الموقف الذي قرّره المالك لأتمتة OTP فقط.

---

## 4. الأمان

| الخطر | الضابط |
|---|---|
| اختطاف الجلسة / إعادة استعمال التذكرة | تذكرة موقّعة HMAC، `exp` 60ث، `jti` أحادي الاستعمال، مرتبطة بـ(tenant,user,login) ومشاهد واحد، فحص `Origin`، wss فقط |
| عبور مستأجر | `company_key` + `lh` في التذكرة وفي بحث `pending`؛ المتصفح أصلاً لكل شركة |
| رؤية/التحكم أبعد من الدخول | CDP على Page واحدة فقط؛ لا Target/Browser/Network API؛ يُقفل البثّ فور الخروج من challenge (قبل OTP) |
| الملاحة بعيداً (navigation) | (1) **ماوس فقط**: لا لوحة مفاتيح أصلاً في v1 (الغز نقرات)؛ (2) لا زر يمين/وسط، ولا wheel (يُسمح بنقرة يسرى وmove فقط)؛ (3) حارس ملاحة: `framenavigated` للإطار الرئيسي يجب أن يبقى ضمن قائمة بيضاء (`auth.uber.com`, `*.uber.com`, نطاقات Arkose/FunCaptcha الحاسمة)، وإلا إنهاء + إلغاء الدخول؛ (4) popups/downloads/dialogs ممنوعة؛ (5) لا clipboard؛ (6) لا `Page.navigate`/`Runtime.evaluate` من العميل — القناة تقبل أنواع رسائل ثابتة فقط |
| إساءة استعمال المدخلات | مخطط رسائل صارم: `{t:"m",k:"move\|down\|up",x,y}` (x,y ∈ [0,1] تُحوَّل إلى بكسل viewport في الخادم وتُقصّ للحدود)؛ حجم رسالة ≤ 256B؛ حدّ ≤ 120 رسالة/ث؛ أي مخالفة = إغلاق |
| DoS / كلفة | حدّ جلسة بث متزامنة عالمي (`COBROWSE_MAX`, افتراضي 3)؛ واحدة/شركة؛ throttle 3 فتح/ساعة/شركة؛ JPEG جودة ~60، `maxWidth` 1280، تحكّم backpressure (إسقاط الإطارات إن امتلأ `bufferedAmount`) |
| التسجيل (Audit) | يُسجَّل حدث فقط: `cobrowse.ticket_minted/opened/closed` + tenant + user + المدة + السبب (success/timeout/fail/violation) + عدد الإطارات المُرسلة (رقم فقط) بتوقيت Europe/Berlin. **ممنوع** تخزين/تسجيل إطارات أو إحداثيات أو لقطات؛ لا الإطارات تمرّ بالقرص؛ Sentry/logs لا تلتقط حمولة WS |
| تسرّب بيانات في البثّ | الصفحة أمامنا تعرض الإيميل الذي كتبه الباكند؛ مقبول (يخص المدير). يُقفل البثّ قبل OTP، ولا شيء بعده |

---

## 5. الفشل والرجوع

| الحالة | الكشف | السلوك |
|---|---|---|
| لم يُحَلّ اللغز | سقف 10 دقائق / خمول 60ث | `failed(challenge_timeout)`، إغلاق البثّ والمتصفح، `markNeedsOtp`؛ رسالة: أعد المحاولة أو اربط بالإضافة |
| Arkose يرفض ويكرّر (≥3) | عدّاد "try again" | `failed(challenge_failed)` + تلميح "اربط بالإضافة"؛ نسجّل الرقم للقياس (لا محتوى) |
| لا بروكسي للشركة / بصمة غير مفعّلة | فحص مسبق في الباكند (§6) | `503 cobrowse_unavailable`، السلوك القديم (`blocked`+الإضافة) — لا نعرض بثّاً من IP مركز بيانات |
| IP/بصمة مشبوهان رغم الحلّ | أوبر يعيد challenge بعد الحلّ أو 403 | `blocked(datacenter_ip)`؛ لا تدوير هويات؛ الإضافة |
| uber-auth/WS غير متاح | فشل الاتصال | `cobrowse_unavailable` |
| فصل المشاهد | إغلاق WS | المحاولة تبقى `awaiting_challenge` حتى السقف؛ يمكن إصدار تذكرة جديدة (ضمن الحدود) |
| **الإضافة** | — | تبقى المسار الاحتياطي النهائي ولا تُزال حتى يتم إثبات co-browse (§9 معيار التقاعد) |

---

## 6. الاعتمادية على #266 (شرط صارم)

**لا يُشحن قبل نتيجة طيار #266.** السبب: لغز يُحَلّ من IP مركز بيانات أو ببصمة headless يُكتشف ويُرفض، فيصبح البثّ مضيعة. الشروط الإلزامية (يتحقق منها الباكند قبل منح `cobrowse_available`، وuber-auth قبل البدء):
1. بروكسي الشركة (#266) **مضبوط ويعمل** (يستعمل نفس `proxyUrl` الذي يمرّره `newStealthContext(browser, {}, proxyUrl, companyKey)`).
2. وضع Chrome الحقيقي مفعّل (`REAL_CHROME=1`, headed تحت Xvfb) — لا يُسمح بـ co-browse على Chromium headless.
3. علم عالمي `UBER_COBROWSE_ENABLED` + علم الشركة (super-admin فقط، كما `UberLoginFlagController`) + `passwordless_login.enabled`.
4. نتيجة الطيار: Arkose يظهر فعلاً على الدخول البارد من متصفح السيرفر **بعد** البروكسي (إن اختفى Arkose بالبروكسي وحده فلا حاجة للمكوّن — قد يلغى المشروع).

---

## 7. الواجهة (Next.js 16)

عند `awaiting_challenge` تظهر في بطاقة docs/27 §9 خطوة: شرح قصير + زر «افتح اللغز». المكوّن `CobrowseViewer`: `<canvas>` يُرسَم عليه كل إطار JPEG ثنائي، يحافظ على نسبة الأبعاد، يحوّل أحداث المؤشر إلى إحداثيات [0,1] ويرسل رسائل ماوس فقط (لا keydown)؛ مؤشر "الجلسة تنتهي خلال mm:ss"؛ حالات: connecting/live/ended(reason)/error. يُغلق تلقائياً عند الخروج من challenge ثم يعود التدفق إلى خانات الكود (A) أو انتظار تلقائي (B). نصوص de (افتراضي)/en/ar مع RTL، أرقام لاتينية. إتاحة وصولية: نصّ بديل ومحاولة بلوحة مفاتيح غير مدعومة (يُذكر في النص). قبل الكتابة: قراءة `node_modules/next/dist/docs/` (Next 16).

---

## 8. العقد المجمّد (يلتزم به الجميع؛ أي تغيير = تعديل هذه الوثيقة أولاً)

- **REST uber-auth:** `/login/start{cobrowse}` → `challenge_required`، `/login/resume`، `/cobrowse/close`، القيم الجديدة في §3.2.
- **REST الباكند:** `POST/DELETE /api/v1/uber-login/cobrowse` + حقول `status` الجديدة (§3.3).
- **WS:** `wss://{domain}/cobrowse/ws`، تذكرة HMAC (§2.3). **أسفل→أعلى (server→client):** رسالة ثنائية = إطار JPEG؛ نصية JSON: `{t:"hello",w,h}`، `{t:"end",reason:"solved|timeout|idle|cancel|violation|error"}`. **client→server:** `{t:"auth",ticket}` ثم `{t:"m",k:"move|down|up",x,y}` فقط (§4).
- **الحالات:** `awaiting_challenge`، الأخطاء `challenge_timeout|challenge_failed|cobrowse_unavailable`.
- **الأعلام:** env `UBER_COBROWSE_ENABLED`؛ tenant `settings['passwordless_login']['cobrowse']` (super-admin)؛ env uber-auth: `COBROWSE_PORT`, `COBROWSE_MAX`, `COBROWSE_ALLOWED_ORIGINS`.
- **تعديلات docs/27 المقصودة:** §3.3 (TTL 590 أثناء challenge)، §8 صف Arkose، §3.1 (ردود start الجديدة)، `state/failure` في §3.2.

---

## 9. خطة البناء والإطلاق

**Spike 0 (قبل أي بناء، يدوي، يوم واحد):** سكربت مؤقت خارج المستودع على متصفح بنفس إعداد #266 يبثّ لغز Arkose عبر CDP ويستقبل نقرات، ويقيس: ظهور اللغز، قبول Arkose للنقرات، كمون. **بوابة اتخاذ قرار: لا بناء إن فشل.**

عناصر العمل (متوازية بعد تجميد العقد §8):
1. **uber-auth (البثّ):** مستمع WS منفصل، التحقق من التذكرة/Origin/jti، `newCDPSession(page)` + screencast + ack/backpressure، ترجمة المدخلات، حارس الملاحة وpopups/downloads، منطق `challenge_required`/`resume` + كشف الخروج من challenge، إنهاء/خمول/سقف، `COBROWSE_MAX`. اختبارات `node --test` (رفض تذكرة منتهية/معاد استعمالها/Origin خاطئ، company_mismatch، رفض رسالة خارج المخطط، حدّ المعدّل). تحقق: `node -c src/<file>.js`. **يشترط جولة حيّة** على حساب تجريبي.
2. **الباكند (broker):** `CobrowseTicketSigner`، توسعة `PasswordlessLoginService` و`LoginAttemptStore` (phase/TTL)، `UberLoginCobrowseController` رفيع، فحص الشروط (§6)، throttle/حدود، أحداث audit بلا محتوى، العلم، عتم Sentry. اختبارات: عزل المستأجر، 409 خارج challenge، 429، لا تسرّب login_id في الردود، صلاحية `connections.manage`. تحقق: `vendor/bin/pint --test && php artisan test`.
3. **الواجهة:** `CobrowseViewer` + خطوة البطاقة + i18n ×3 + polling؛ تعتمد على العقد فقط (mock WS). تحقق: `npm run build`.
4. **Ops (بإشراف المالك):** مسار Caddy `/cobrowse/*`، متغيرات compose، تحقق Xvfb/Chrome، مراقبة CPU/RAM (إطار JPEG لكل جلسة)، تحديث HANDOFF.md وROADMAP.md وdocs/23/27.

**الإطلاق (قابل للتراجع):** P0 نشر والأعلام OFF → P1 شركة تجريبية واحدة بعد طيار #266 (بحضور المالك) ← قياس نسبة النجاح/الكمون/ظهور Arkose → P2 توسيع تدريجي. **التراجع:** أطفئ علم الشركة ثم العلم العالمي؛ يعود `blocked`+الإضافة؛ أزل مسار Caddy. لا migration.
**معيار تقاعد الإضافة (للدخول فقط):** ≥ 90% نجاح co-browse على ≥ 20 دخولاً حقيقياً موزّعة على ≥ 3 شركات خلال شهر بلا حظر/403 زائد؛ قبلها الإضافة مسار احتياطي رسمي. (إصدار الإضافة الأدنى `LATEST_EXTENSION_VERSION` قرار يدوي للمالك، لا يُستنتج.)

---

## 10. مخاطر وأسئلة مفتوحة
1. **قبول Arkose لمدخلات CDP المنقولة** (توقيت، pointer events، `isTrusted`)؛ يحسمها Spike 0. وكذلك كشف أتمتة CDP نفسها (Playwright يعمل أصلاً بـCDP).
2. **كمون الشبكة** (VPS ألماني → مدير): مقبول للنقر؛ نقيس.
3. **كلفة الموارد:** ترميز screencast داخل Chrome لكل جلسة؛ `COBROWSE_MAX` يحمي RAM/CPU.
4. **منفذ جديد معرَّض للإنترنت** (عبر Caddy فقط): سطح هجوم صغير لكنه جديد؛ يلزم مراجعة أمنية قبل P1.
5. **تغيّر واجهة Arkose/نصوصها** بحسب الحساب (de/en) → كشف الخروج من challenge يعتمد على إشارات متعددة (إطار + نص + `detectStep`)، ويُضبط بلقطات حيّة.
6. **ToS:** المدير يحلّ بنفسه في حسابه، لكن الدخول عبر متصفح خادم يبقى ضمن قرار المالك المسجَّل في docs/27 §0.
7. هل نحتاج لوحة مفاتيح لتحدٍّ نصي؟ (غير متوقَّع)؛ إن ظهر يُضاف allowlist ضيّق بتعديل العقد.
