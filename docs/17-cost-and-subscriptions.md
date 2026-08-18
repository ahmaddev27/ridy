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

## 2. Chosen target · الهدف المعتمد

**Decision · القرار:** one company, **up to 10,000 drivers on a single proxy**, running on
**Hetzner CCX43**. Confirmed by the operator; do not downgrade the plan.
‏القرار: شركة واحدة، **حتى 10,000 سائق على بروكسي واحد**، على **Hetzner CCX43**. معتمد من المشغّل؛
لا يُخفَّض.

**Why one proxy is enough for 10,000 drivers · لماذا بروكسي واحد يكفي 10,000 سائق:** the
proxy carries only the company's single dispatch stream (a few MB/hour), independent of
driver count. The 10,000 drivers talk to **our backend directly** (not through the proxy) —
that load lands on the **server**, which is why CCX43 (16 vCPU / 64 GB) is the right box.
‏البروكسي يحمل ستريم الشركة الوحيد فقط (ميغابايت قليلة/ساعة)، مستقل عن عدد السائقين. الـ10,000
سائق يكلّمون **سيرفرنا مباشرة** (لا عبر البروكسي) — وهذا الحمل يقع على **السيرفر**، ولهذا CCX43
(16 vCPU / 64 GB) هو البوكس الصحيح.

### Hetzner CCX price table · جدول أسعار Hetzner CCX (2026-08)

| Plan | vCPU (AMD) | RAM | NVMe | Hourly | Monthly cap · السقف الشهري |
|---|---|---|---|---|---|
| CCX13 | 2 | 8 GB | 80 GB | €0.0697 | ~€46 |
| CCX23 | 4 | 16 GB | 160 GB | €0.1386 | ~€92 |
| CCX33 | 8 | 32 GB | 240 GB | €0.2227 | ~€148 |
| **CCX43 ✅** | **16** | **64 GB** | **360 GB** | **€0.4431** | **€276.49** |

> Billed hourly with a monthly cap; **no annual contract**, cancel anytime. 20 TB traffic
> included. ‏فوترة بالساعة بسقف شهري؛ **بلا عقد سنوي**، تلغي وقت ما بدك. 20 تيرابايت ترافيك مشمول.

## 3. Subscriptions needed NOW · الاشتراكات المطلوبة الآن

Android-only launch · إطلاق أندرويد فقط.

| Service · الخدمة | Status · الحالة | Cost now · الكلفة الآن | Note · ملاحظة |
|---|---|---|---|
| **Server** · السيرفر (Hetzner **CCX43**) | Upgrade needed · لازم ترقية | **€276.49/mo · شهري** | 16 vCPU / 64 GB / 360 GB — fits 10k drivers + geo · يتّسع لـ10 آلاف سائق + الجيو |
| **Proxy** · البروكسي (ISP Frankfurt) | 1 active · نشط | **$6.60/mo · شهري** | One proxy for the whole company (up to 10k drivers) · بروكسي واحد للشركة كلها |
| **Backups** · نسخ احتياطي (Hetzner) | Recommended · مُوصى | **+€55/mo (~20%)** | Daily automatic snapshots · سناب شوت يومي |
| **Email** · الإيميل (Resend) | Free · مجاني | **$0** | Free: 3,000/mo, 100/day — enough for invites now · كافي للدعوات |
| **Push** · الإشعارات (FCM + Firebase) | Wired · مربوط | **$0 forever · مجاني للأبد** | Unlimited, no subscription · بلا حد ولا اشتراك |
| **Domain** · الدومين (reidey.de) | Owned · عندك | ~€10/yr · سنة | — |
| **Google Play Console** | To publish app · لنشر التطبيق | **$25 one-time · مرة وحدة** | Required for Android release · ضروري لأندرويد |
| **Apple Developer** | iOS only · فقط لو iOS | $99/yr · سنة | **Skip — Android now** · تجاهله |
| **EAS / Expo** (build + OTA) | Free · مجاني | **$0** | Free tier enough now · المجاني كافي الآن |

**Total now · المجموع الآن (Android, one company / 10k drivers):**
- One-time · مرة وحدة: **$25** (Google Play).
- Monthly · شهري: **€276.49** (CCX43) + **$6.60** proxy + optional **€55** backups + **$0** everything else.
- ‏الإجمالي الفعلي: **~€277/شهر (أو ~€332 مع الباك أب) + $6.60 بروكسي + $25 لمرة وحدة**.

---

## 4. Subscriptions at SCALE · الاشتراكات عند التوسع

Only relevant once you onboard **many companies** (each its own Uber account → its own
proxy). A single company staying at 10k drivers does **not** hit these.
‏تخصّ فقط عند ضمّ **شركات كثيرة** (كل شركة حساب أوبر خاص → بروكسي خاص). شركة واحدة بـ10 آلاف
سائق **لا** تصل لهذه.

| Service · الخدمة | When to upgrade · متى تترقّى | Cost at scale · الكلفة عند التوسع |
|---|---|---|
| **Server** · السيرفر | ~300 companies · شركة | Split: DB box + geo box + daemon shards + Redis + app LB · تقسيم |
| **Proxies** · البروكسيات | **Linear with companies · خطّي مع الشركات** | 1000 × $6.60 = **~$6,600/mo** — negotiate bulk · فاوض بالجملة |
| **Email** · الإيميل (Resend) | Big invite waves · حملات دعوات | **Pro $20/mo** (50k) then higher tiers · ثم أعلى |
| **EAS Update (OTA)** | Thousands of active drivers · آلاف السواقة | Free MAU cap exceeded → **~$99/mo** plan or self-host updates · أو استضافة ذاتية |
| **Push** · الإشعارات (FCM) | — | **Stays free, unlimited · يظل مجاني بلا حد** |
| **Geo** (Nominatim/OSRM) | With the big box · مع البوكس الكبير | $0 self-hosted, but eats server resources · ذاتي، يستهلك موارد |

---

## 5. Estimated monthly cost by scale · تقدير الكلفة الشهرية حسب الحجم

Row 1 is the **committed setup** (one company, 10k drivers, CCX43, one proxy). The rest
assume each company brings its own Uber account (1 proxy each).
‏السطر الأول هو **الإعداد المعتمد** (شركة واحدة، 10 آلاف سائق، CCX43، بروكسي واحد). الباقي بافتراض
أن كل شركة تجلب حساب أوبر خاص (بروكسي لكل شركة).

| Scale · الحجم | Server · السيرفر | Proxies · البروكسيات | Email · الإيميل | Push | Est. total/mo · التقدير الشهري |
|---|---|---|---|---|---|
| **1 company / 10k drivers ✅ · شركة / 10 آلاف سائق** | €276 (CCX43) | $6.60 | $0 | $0 | **~€283 / mo** |
| **100 companies · شركة** | ~€277 (CCX43, one box) | ~$660 | $20 | $0 | **~€900 / mo** |
| **500 companies · شركة** | ~€600 (split: app+DB+geo) | ~$3,300 | $20 | $0 | **~€3,900 / mo** |
| **1000 companies · شركة** | ~€1,000 (full split + Redis + LB) | ~$6,600 | ~$100 | $0 | **~€7,700 / mo** |

> **Key insight · الخلاصة الأهم:** the two costs that grow are the **server (step
> changes as you split)** and the **proxies (linear per company)**. Push, Firebase, and
> geo stay effectively free. Proxies dominate at scale — a bulk proxy deal is the
> single biggest lever on unit economics.
>
> ‏البندان اللذان يكبران هما **السيرفر (قفزات مع التقسيم)** و**البروكسيات (خطّي لكل شركة)**.
> الإشعارات وFirebase والجيو تبقى مجانية عملياً. البروكسيات تهيمن عند التوسع — صفقة بروكسيات
> بالجملة هي أكبر عامل على اقتصاديات الوحدة.

---

## 6. What is free forever · ما هو مجاني للأبد

- **FCM (Firebase Cloud Messaging)** — unlimited push, no subscription. · إشعارات بلا حد، بلا اشتراك.
- **Firebase (Spark plan)** — covers FCM fully at $0. · يغطي FCM بالكامل مجاناً.
- **Self-hosted geo (Nominatim + OSRM)** — no per-request fee; costs only server resources. · بلا رسوم للطلب؛ يكلّف موارد السيرفر فقط.

---

## 7. Action items · بنود التنفيذ

- [ ] Provision **Hetzner CCX43** (16 vCPU / 64 GB / 360 GB), Germany region, Ubuntu 24.04. · جهّز CCX43.
- [ ] Enable Hetzner **Backups** (+~20%) for daily DB snapshots. · فعّل الباك أب.
- [ ] Buy Google Play Console ($25 one-time) to publish the driver app. · اشترِ Google Play Console.
- [ ] Keep Resend on the free tier until invite volume grows; upgrade to Pro then. · أبقِ Resend مجاني ثم رقِّ لاحقاً.
- [ ] For multi-company growth: source a **bulk proxy provider** cheaper than $6.60/unit and automate purchase + binding. · لنمو الشركات: زوّد بروكسيات بالجملة أرخص + أتمتة.
- [ ] Plan the server split (DB → geo → daemon shards → Redis → app LB) around ~300 companies. · خطّط لتقسيم السيرفر عند ~300 شركة.

### References · مراجع
- Migration runbook · دليل النقل: `docs/16-server-migration-handoff.md`
- Self-hosted geo · الجيو الذاتي: `docs/self-hosted-geo.md`
- Deploy internals · تفاصيل النشر: `.github/workflows/deploy.yml`
