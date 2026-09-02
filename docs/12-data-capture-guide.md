# دليل التقاط بيانات أوبر — للاختبار على حساب شركة حقيقي

> **الغرض:** خطة العمل + أدوات الالتقاط الثلاثة (كاملة) لاكتشاف endpoints بيانات أوبر وبناء السحب.
> **يُنفَّذ على:** `fleethub.uber.com` و `vsdispatch.uber.com` وأنت داخل حساب الشركة الحقيقي.

---

## الوضع الحالي (جاهز)

| المكوّن | الحالة |
|---|---|
| التقاط الجلسة (إضافة المتصفّح) | ✅ يعمل بجلسة حقيقية |
| الـdaemon + تيار RAMEN | ✅ يتّصل ويستمع |
| التقاط العروض + تخزين + توجيه بالـdriverUUID | ✅ مبني ومختبَر |
| شاشات Offers / Drivers / الإحصائيات | ✅ جاهزة |
| **قائمة السواقين الكاملة (أسماء/صور/جوال)** | ⏳ تنتظر اكتشاف الـendpoint |

---

## خطة العمل (نُنفّذها معاً)

```
1. أنت: تدخل حساب الشركة الحقيقي على fleethub.uber.com
2. أنت: تربط الجلسة عبر الإضافة (زر واحد) → جلسة حقيقية مخزّنة
3. أنت: تشغّل find-roster.js على صفحة السواقين → ترسل الردّ
4. المطوّر: يبني RosterSync — يسحب السواقين ويخزّنهم
5. معاً: نكتشف endpoints أخرى (رحلات، أرباح، تفاصيل سائق) → نبنيها
6. المطوّر: يبني الشاشات + الإحصائيات + العرض
```

---

## اللي نحتاج نلتقطه (بالترتيب)

وأنت داخل الحساب الحقيقي، شغّل الأدوات (تحت) والتقط:

1. **صفحة السواقين** → `find-roster.js` → قائمة السواقين (أسماء/صور/UUID).
2. **بروفايل سائق واحد** (اضغط على سائق) → `find-driver-me.js` → تفاصيل السائق الفردي (جوال؟ صورة؟ حالة؟).
3. **صفحة الأرباح/الرحلات** (إن وُجدت) → `find-roster.js` → تفاصيل الرحلات/الأرباح.
4. **رابط كل صفحة** — انسخه (مثال معروف: `fleethub.uber.com/orgs/{ORG}/drivers/{DRIVER}`).

> **مهم — الخصوصية:** احذف أي **كوكيز/توكن حقيقي** قبل إرسال أي ردّ. المطلوب فقط **بنية البيانات** (أسماء الحقول والشكل)، لا القيم السرّية.

---

## طريقة التشغيل العامة

1. افتح الصفحة المطلوبة على أوبر وأنت مسجّل دخول.
2. اضغط `F12` → تبويب **Console**.
3. الصق كامل السكربت واضغط Enter.
4. تنقّل بالصفحة (**بدون F5** — التحديث يمسح السكربت).
5. عند ظهور النتيجة، شغّل أمر `copy(...)` المذكور وأرسل الناتج.

---

## الأداة 1 — `find-roster.js` (قائمة السواقين)

> شغّلها على صفحة **Drivers / Team / Fleet** في `fleethub.uber.com`.
> بعد الالتقاط: `copy(JSON.stringify(getRosterHits(), null, 2))`

```javascript
// Roster endpoint finder — captures the Uber API call that returns the LIST of
// drivers (names, photos, ids). Paste in the console on fleethub.uber.com while
// viewing your drivers/team page. Plain ASCII, safe to paste.
//
// HOW TO USE:
//   1. Open fleethub.uber.com and go to your Drivers / Team / Fleet page.
//   2. F12 -> Console. Paste ALL of this, press Enter -> prints "ROSTER WATCH ON".
//   3. Navigate the drivers list (open it, refresh via in-app nav, page through).
//   4. When a response with MULTIPLE drivers is seen it prints "ROSTER HIT" with
//      the URL + body. Copy them into roster-request.js and roster-response.json.
//   5. Retrieve everything any time:  copy(JSON.stringify(getRosterHits(), null, 2))

(function rosterFinder() {
  const HITS = [];
  window.getRosterHits = () => HITS;

  // A roster response mentions driverUUID/first/last several times over.
  function looksLikeRoster(text) {
    if (typeof text !== "string" || text.length < 80) return false;
    const uuidHits = (text.match(/driverUUID|driverUuid|"uuid"/gi) || []).length;
    const nameHits = (text.match(/firstName|first_name/gi) || []).length;
    return uuidHits >= 2 && nameHits >= 2; // more than one person
  }

  function report(source, url, bodyText) {
    let parsed = bodyText;
    try { parsed = JSON.parse(bodyText); } catch (e) {}
    HITS.push({ source, url, body: parsed });
    console.log("=== ROSTER HIT (" + source + ") ===");
    console.log("URL:", url);
    console.log("BODY:", parsed);
    console.log("copy(JSON.stringify(getRosterHits(), null, 2))");
  }

  const NOISE = /mixpanel|sentry|segment|amplitude|google|doubleclick|analytics|braze|stats/i;

  const of = window.fetch;
  window.fetch = function () {
    const a = arguments;
    const url = typeof a[0] === "string" ? a[0] : (a[0] && a[0].url) || "";
    return of.apply(this, a).then((res) => {
      if (!NOISE.test(url)) {
        res.clone().text().then((t) => { if (looksLikeRoster(t)) report("fetch", url, t); }).catch(() => {});
      }
      return res;
    });
  };

  const oo = XMLHttpRequest.prototype.open;
  const os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", () => {
      if (!NOISE.test(this.__u || "") && looksLikeRoster(this.responseText)) report("XHR", this.__u, this.responseText);
    });
    return os.apply(this, arguments);
  };

  console.log("ROSTER WATCH ON — open your Drivers/Team page (navigate, don't press F5).");
})();
```

---

## الأداة 2 — `find-driver-me.js` (تفاصيل حساب/سائق فردي)

> شغّلها على بروفايل سائق أو صفحة الحساب.
> بعد الالتقاط: `copy(JSON.stringify(getDriverHits(), null, 2))`

```javascript
// Driver identity finder v3 - plain ASCII, safe to paste in the console.
// Desktop-browser Uber driver dashboard.
//
// Does THREE things:
//   1. Scans data already in the page (globals + embedded JSON).
//   2. Watches new fetch/XHR requests for identity fields.
//   3. Logs api/graphql URLs (analytics noise filtered out).
//
// HOW TO USE:
//   1. On the driver dashboard, F12 -> Console. Paste ALL of this, Enter.
//   2. If it prints "HITS: N" with N>0, the data is already found.
//   3. Click around (profile / earnings / account) WITHOUT pressing F5.
//   4. Retrieve everything with:   copy(JSON.stringify(getDriverHits(), null, 2))

(function driverIdentityFinder() {
  var HITS = [];
  var HINTS = [
    "driverUUID", "driverUuid", "driver_uuid", "userUUID", "uuid",
    "firstName", "lastName", "first_name", "last_name",
    "email", "phone", "mobile", "phoneNumber",
  ];
  // URLs worth printing as REQ; analytics/telemetry are filtered out.
  var INTERESTING = /graphql|driver|profile|account|earnings|\/me\b|getDriver|partner/i;
  var NOISE = /mixpanel|sentry|segment|amplitude|google|doubleclick|analytics|braze|stats/i;

  function hintsIn(text) {
    if (typeof text !== "string") return [];
    var found = [];
    for (var i = 0; i < HINTS.length; i++) {
      if (text.indexOf(HINTS[i]) !== -1) found.push(HINTS[i]);
    }
    return found;
  }

  function record(source, url, body) {
    var asText = typeof body === "string" ? body : "";
    if (!asText) { try { asText = JSON.stringify(body); } catch (e) { return; } }
    var hits = hintsIn(asText);
    if (hits.length < 2) return;
    var parsed = body;
    if (typeof body === "string") { try { parsed = JSON.parse(body); } catch (e) {} }
    HITS.push({ source: source, url: url, fields: hits, body: parsed });
    console.log("=== HIT (" + source + ") fields: " + hits.join(", ") + " ===");
    console.log("URL:", url);
    console.log("BODY:", parsed);
  }

  window.getDriverHits = function () { return HITS; };

  // --- 1a. Embedded JSON in <script> tags ---
  try {
    var scripts = document.querySelectorAll("script");
    for (var i = 0; i < scripts.length; i++) {
      var txt = scripts[i].textContent || "";
      if (txt.length > 40 && hintsIn(txt).length >= 3) record("inline-script#" + i, location.href, txt);
    }
  } catch (e) {}

  // --- 1b. Shallow scan of window globals ---
  try {
    var keys = Object.keys(window);
    for (var j = 0; j < keys.length; j++) {
      var val;
      try { val = window[keys[j]]; } catch (e) { continue; }
      if (val && typeof val === "object") {
        var s;
        try { s = JSON.stringify(val); } catch (e) { continue; }
        if (s && s.length < 500000 && hintsIn(s).length >= 3) record("window." + keys[j], location.href, s);
      }
    }
  } catch (e) {}

  // --- 2 + 3. Watch new requests ---
  var originalFetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    var url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
    return originalFetch.apply(this, args).then(function (response) {
      if (INTERESTING.test(url) && !NOISE.test(url)) console.log("REQ:", url);
      try { response.clone().text().then(function (t) { record("fetch", url, t); }); } catch (e) {}
      return response;
    });
  };

  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__u = url; return originalOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    xhr.addEventListener("load", function () {
      var u = xhr.__u || "";
      if (INTERESTING.test(u) && !NOISE.test(u)) console.log("REQ:", u);
      try { record("XHR", u, xhr.responseText); } catch (e) {}
    });
    return originalSend.apply(this, arguments);
  };

  console.log("FINDER ON. HITS: " + HITS.length);
  console.log("Click around (profile / earnings / account) WITHOUT F5.");
  console.log("Then run:  copy(JSON.stringify(getDriverHits(), null, 2))");
})();
```

---

## الأداة 3 — `request.js` (تيار العروض RAMEN)

> شغّلها على `vsdispatch.uber.com` لالتقاط عروض الرحلات الحيّة.
> تطبع كل حدث `push_fleet_unified_offer` في الكونسول.

```javascript
(async function ramenClientFixed() {
  // 1. معرف الجلسة
  const sessionUUID = crypto.randomUUID();

  // 2. تحديد الرابط الصحيح (نستخدم ramendca كما في طلباتك)
  const baseUrl = 'https://vsdispatch.uber.com/ramendca/events';
  console.log(`📍 باستخدام الرابط: ${baseUrl}`);

  // 3. رؤوس الطلبات (مطابقة لما في Network)
  const headers = {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'x-uber-client-name': 'vs_dispatch',
    'x-uber-client-session': sessionUUID,
    'x-uber-client-version': '1.0.0',
    'x-uber-device': 'web',
    'x-uber-device-id': `vs_dispatch-${crypto.randomUUID()}`,
  };

  // 4. المصافحة (ACK) - seq=-1
  const ackUrl = `${baseUrl}/ack?seq=-1`;
  console.log('📡 جاري المصافحة...');
  try {
    const ackRes = await fetch(ackUrl, {
      method: 'GET',
      headers: headers,
      credentials: 'include',
      mode: 'cors'
    });
    console.log(`✅ المصافحة: الحالة ${ackRes.status}`);
    if (!ackRes.ok) {
      console.error('❌ فشلت المصافحة');
      return;
    }
  } catch (e) {
    console.error('❌ خطأ في المصافحة:', e);
    return;
  }

  // 5. فتح التيار (RECV) - seq=0
  const recvUrl = `${baseUrl}/recv?seq=0`;
  console.log('📡 جاري فتح التيار...');

  try {
    const response = await fetch(recvUrl, {
      method: 'GET',
      headers: headers,
      credentials: 'include',
      mode: 'cors'
    });

    if (!response.ok) {
      console.error(`❌ فشل فتح التيار: ${response.status}`);
      return;
    }

    console.log('✅ التيار مفتوح! في انتظار الأحداث...');

    // قراءة التيار كـ SSE
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('🔌 التيار مغلق من السيرفر، سيتم إعادة المحاولة بعد 5 ثوانٍ...');
        setTimeout(ramenClientFixed, 5000);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data) {
            try {
              const event = JSON.parse(data);
              console.log('📨 حدث:', event);
            } catch (e) {
              console.log('📨 بيانات خام:', data);
            }
          }
        } else if (line.startsWith('event:')) {
          console.log('🏷️ نوع الحدث:', line.slice(6).trim());
        }
      }
    }
  } catch (err) {
    console.error('❌ خطأ في التيار:', err);
    // إعادة المحاولة بعد 5 ثوانٍ
    setTimeout(ramenClientFixed, 5000);
  }
})();
```

---

## بعد الالتقاط — ماذا يُبنى

| المُلتقَط | ما يُبنى منه |
|---|---|
| `find-roster.js` → قائمة السواقين | **RosterSync**: يسحب كل السواقين ويخزّنهم (اسم، صورة، UUID، حالة، جوال/إيميل إن وُجد) |
| `find-driver-me.js` → تفاصيل سائق | إثراء بروفايل السائق (جوال، صورة، حالة) |
| `request.js` → عروض حيّة | مؤكَّد أنه يعمل — الـdaemon يلتقطه تلقائياً |
| روابط الصفحات | تحديد أنماط الـendpoints للبناء |

**المطلوب من المسؤول:** الدخول بحساب الشركة، ربط الجلسة عبر الإضافة، ثم تشغيل الأدوات وإرسال المخرجات (بدون كوكيز/توكن حقيقي).
