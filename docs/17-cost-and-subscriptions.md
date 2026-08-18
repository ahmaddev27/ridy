# 17 · Cost & Subscriptions Report — Reidey
# ‏17 · تقرير الكلفة والاشتراكات — Reidey

> Bilingual. Prices are estimates as of 2026-08; always confirm on the provider's
> current pricing page. All USD/EUR figures exclude local taxes.
>
> ‏ثنائي اللغة. الأسعار تقديرية بتاريخ 2026-08؛ تأكد دائماً من صفحة أسعار المزوّد
> الحالية. كل الأرقام بدون ضرائب محلية.

---

## 1. How the proxy actually scales · كيف يتوسّع البروكسي فعلياً

**EN —** The proxy is **not** per-driver. The `dispatch-daemon` uses **one proxy per
company (one Uber fleet account)** to hold that company's RAMEN dispatch stream.
That stream is lightweight: JSON events + a 45s heartbeat + a 60s reconcile + a
periodic roster fetch — a few MB/hour **regardless of how many drivers** the company
has. So a single proxy comfortably serves a company with **10,000 drivers**; traffic
is never the bottleneck for one company.

The only hard rule: **never route multiple companies (separate Uber accounts) through
the same proxy IP** — Uber ties a session to its IP, and many fleet accounts on one IP
looks like fraud and gets banned. That is a ban risk, not a bandwidth limit.

**‏عربي —** البروكسي **ليس** لكل سائق. الديمون يستعمل **بروكسي واحد لكل شركة (حساب أوبر
واحد)** ليمسك ستريم الديسباتش (RAMEN) لتلك الشركة. الستريم خفيف: أحداث JSON + heartbeat
كل 45 ثانية + reconcile كل 60 ثانية + جلب roster دوري — بضعة ميغابايت بالساعة **بغضّ النظر
عن عدد السائقين**. فبروكسي واحد يكفي لشركة فيها **10,000 سائق**؛ الترافيك ليس عائقاً لشركة
واحدة.

القاعدة الوحيدة الصارمة: **لا تمرّر شركات متعددة (حسابات أوبر مختلفة) عبر نفس الـIP** —
أوبر تربط الجلسة بالـIP، وتعدّد الحسابات على IP واحد يبدو احتيالاً ويُحظر. هذا خطر حظر،
وليس حدّ باندويث.

> **Rule of thumb · القاعدة:** `1 proxy = 1 company` — not per driver.
> `‏1 بروكسي = 1 شركة` — لا لكل سائق.

---

## 2. Subscriptions needed NOW · الاشتراكات المطلوبة الآن

Android-only launch, small scale.
‏إطلاق أندرويد فقط، حجم صغير.

| Service · الخدمة | Status · الحالة | Cost now · الكلفة الآن | Note · ملاحظة |
|---|---|---|---|
| **Server** · السيرفر (Hetzner) | Upgrade needed · لازم ترقية | **CCX33 ~€148/mo** or **Dedicated Auction ~€45/mo** | Dedicated = far better value · أوفر بكثير |
| **Proxy** · البروكسي (ISP Frankfurt) | 1 active · نشط | **$6.60/mo per company · للشركة** | One per company · واحد لكل شركة |
| **Email** · الإيميل (Resend) | Free · مجاني | **$0** | Free: 3,000/mo, 100/day — enough for invites now · كافي للدعوات |
| **Push** · الإشعارات (FCM + Firebase) | Wired · مربوط | **$0 forever · مجاني للأبد** | Unlimited, no subscription · بلا حد ولا اشتراك |
| **Domain** · الدومين (reidey.de) | Owned · عندك | ~€10/yr · سنة | — |
| **Google Play Console** | To publish app · لنشر التطبيق | **$25 one-time · مرة وحدة** | Required for Android release · ضروري لأندرويد |
| **Apple Developer** | iOS only · فقط لو iOS | $99/yr · سنة | **Skip — Android now** · تجاهله |
| **EAS / Expo** (build + OTA) | Free · مجاني | **$0** | Free tier enough now · المجاني كافي الآن |

**Total now · المجموع الآن (Android):**
- One-time · مرة وحدة: **$25** (Google Play).
- Monthly · شهري: Server (**~€45–148**) + **$6.60/company** proxy + **$0** everything else.
- ‏تبدأ فعلياً بـ **~€50–150/شهر + $25 لمرة وحدة**.

---

## 3. Subscriptions at SCALE · الاشتراكات عند التوسع

| Service · الخدمة | When to upgrade · متى تترقّى | Cost at scale · الكلفة عند التوسع |
|---|---|---|
| **Server** · السيرفر | ~300 companies · شركة | Split: DB box + geo box + daemon shards + Redis + app LB · تقسيم |
| **Proxies** · البروكسيات | **Linear with companies · خطّي مع الشركات** | 1000 × $6.60 = **~$6,600/mo** — negotiate bulk · فاوض بالجملة |
| **Email** · الإيميل (Resend) | Big invite waves · حملات دعوات | **Pro $20/mo** (50k) then higher tiers · ثم أعلى |
| **EAS Update (OTA)** | Thousands of active drivers · آلاف السواقة | Free MAU cap exceeded → **~$99/mo** plan or self-host updates · أو استضافة ذاتية |
| **Push** · الإشعارات (FCM) | — | **Stays free, unlimited · يظل مجاني بلا حد** |
| **Geo** (Nominatim/OSRM) | With the big box · مع البوكس الكبير | $0 self-hosted, but eats server resources · ذاتي، يستهلك موارد |

---

## 4. Estimated monthly cost by scale · تقدير الكلفة الشهرية حسب الحجم

Assumes each company brings its own Uber account (worst case: 1 proxy each). A single
large company with many drivers costs far less — just one proxy.
‏بافتراض أن كل شركة تجلب حساب أوبر خاص (أسوأ حالة: بروكسي لكل شركة). شركة واحدة كبيرة
بسائقين كثيرين تكلّف أقل بكثير — بروكسي واحد فقط.

| Scale · الحجم | Server · السيرفر | Proxies · البروكسيات | Email · الإيميل | Push | Est. total/mo · التقدير الشهري |
|---|---|---|---|---|---|
| **1 company · شركة** | ~€45 (dedicated) | $6.60 | $0 | $0 | **~€50 / mo** |
| **100 companies · شركة** | ~€150 (one big box) | ~$660 | $20 | $0 | **~€800 / mo** |
| **500 companies · شركة** | ~€400 (split: app+DB+geo) | ~$3,300 | $20 | $0 | **~€3,700 / mo** |
| **1000 companies · شركة** | ~€700 (full split + Redis + LB) | ~$6,600 | ~$100 | $0 | **~€7,400 / mo** |

> **Key insight · الخلاصة الأهم:** the two costs that grow are the **server (step
> changes as you split)** and the **proxies (linear per company)**. Push, Firebase, and
> geo stay effectively free. Proxies dominate at scale — a bulk proxy deal is the
> single biggest lever on unit economics.
>
> ‏البندان اللذان يكبران هما **السيرفر (قفزات مع التقسيم)** و**البروكسيات (خطّي لكل شركة)**.
> الإشعارات وFirebase والجيو تبقى مجانية عملياً. البروكسيات تهيمن عند التوسع — صفقة بروكسيات
> بالجملة هي أكبر عامل على اقتصاديات الوحدة.

---

## 5. What is free forever · ما هو مجاني للأبد

- **FCM (Firebase Cloud Messaging)** — unlimited push, no subscription. · إشعارات بلا حد، بلا اشتراك.
- **Firebase (Spark plan)** — covers FCM fully at $0. · يغطي FCM بالكامل مجاناً.
- **Self-hosted geo (Nominatim + OSRM)** — no per-request fee; costs only server resources. · بلا رسوم للطلب؛ يكلّف موارد السيرفر فقط.

---

## 6. Action items · بنود التنفيذ

- [ ] Provision the new box (Dedicated Auction preferred for value; CCX33 for flexibility). · جهّز البوكس الجديد.
- [ ] Buy Google Play Console ($25 one-time) to publish the driver app. · اشترِ Google Play Console.
- [ ] Keep Resend on the free tier until invite volume grows; upgrade to Pro then. · أبقِ Resend مجاني ثم رقِّ لاحقاً.
- [ ] For multi-company growth: source a **bulk proxy provider** cheaper than $6.60/unit and automate purchase + binding. · لنمو الشركات: زوّد بروكسيات بالجملة أرخص + أتمتة.
- [ ] Plan the server split (DB → geo → daemon shards → Redis → app LB) around ~300 companies. · خطّط لتقسيم السيرفر عند ~300 شركة.

### References · مراجع
- Migration runbook · دليل النقل: `docs/16-server-migration-handoff.md`
- Self-hosted geo · الجيو الذاتي: `docs/self-hosted-geo.md`
- Deploy internals · تفاصيل النشر: `.github/workflows/deploy.yml`
