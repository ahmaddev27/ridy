# Ridy Dispatch Daemon

خدمة Node تمسك تيار Uber RAMEN (الإرساليات الحيّة) **24/7** لكل أسطول، وتبعث العروض لـLaravel (الدماغ). خدمة "أذن" فقط — لا منطق أعمال فيها.

## كيف تشتغل

```
┌─ Ridy Laravel API ──────────────────────────────┐
│  GET  /internal/dispatch/sessions   (الجلسات النشطة + كوكيز) │
│  POST /internal/dispatch/ingest     (العروض الخام)          │
│  POST /internal/dispatch/sessions/{id}/cookies   (تدوير)    │
│  POST /internal/dispatch/sessions/{id}/needs-relink         │
│  POST /internal/dispatch/sessions/{id}/heartbeat            │
└──────────────────────────────────────────────────┘
        ▲ secret-guarded (X-Dispatch-Secret)
        │
┌─ dispatch-daemon (هذا) ─────────────────────────┐
│  • يسحب الجلسات النشطة كل دقيقة                    │
│  • لكل جلسة: ack(seq=0) ثم recv(seq=آخر seq) SSE  │
│  • يفكّ push_fleet_unified_offer → ingest         │
│  • يلتقط Set-Cookie → يحفظها (تدوير = جلسة دائمة)  │
│  • 401/403 → needs-relink، ثم إعادة اتصال backoff │
└──────────────────────────────────────────────────┘
        │ cookie (جلسة الأسطول الملتقطة)
        ▼
   vsdispatch.uber.com/ramendca/events
```

## التشغيل

```bash
cd dispatch-daemon
npm install               # undici (بروكسي لكل شركة) + @sentry/node
cp .env.example .env      # املأ DISPATCH_INGEST_SECRET ليطابق الباك
npm run dev               # node --env-file=.env src/index.js
npm test                  # node --test (اختبارات وحدات، بدون شبكة)
```

> يتطلّب **Node.js 20.6+** (`--env-file` و`getSetCookie`). `npm start` لا يقرأ `.env` — في Docker تأتي المتغيّرات من docker-compose.
> الاعتماديات: `undici` (fetch مع `ProxyAgent` لكل شركة، بروكسي http/https فقط — لا SOCKS) و`@sentry/node` (يعمل فقط إذا ضُبط `SENTRY_DSN`، مع حذف الكوكيز والأسرار قبل الإرسال).

## الموثوقية

- **عزل الجلسات:** صفّ جلسة تالف (كوكيز كـobject، بروكسي socks5 أو بدون scheme) يُتجاهَل ويُبلَّغ عنه، ولا يوقف باقي الشركات ولا يُسقط الـdaemon عند الإقلاع.
- **لا ضياع للعروض:** فشل `ingest` (deploy، 5xx، timeout) يدخل طابور إعادة محاولة لكل stream (backoff من 1s حتى 30s، حتى 10 دقائق). ترتيب عروض السائق الواحد محفوظ، والسائقون المختلفون بالتوازي. الـheartbeat والـingest لا يوقفان قراءة الـSSE.
- **إعادة الاتصال:** بعد stream فتح ثم انقطع → إعادة فتح بعد ~250ms من نفس `seq`. عاصفة انقطاعات (≥6 أقل من 1.5s) → backoff أُسّي حقيقي مع jitter.
- **Fleet Hub:** الـstatus poll يرسل فقط السائقين الذين تغيّروا، ودفعة كاملة كل `STATUS_FULL_SYNC_MS`. 429/5xx → backoff يحترم `Retry-After`.
- **الإيقاف:** SIGTERM ينتظر حتى 4s لكتابات الـingest/الكوكيز الجارية ثم يفرّغ Sentry.

## تدوير الكوكيز (لماذا لا نحتاج كلمة مرور)

الجلسة المُستخدَمة باستمرار لا تنتهي كالخاملة: كل ردّ قد يحمل `Set-Cookie` بكوكيز مُجدَّدة. الـdaemon يلتقطها ويحفظها في الباك، فتبقى الجلسة حيّة أطول بكثير من شهر — **بدون تخزين أي كلمة مرور**. إن رفضت أوبر الجلسة رغم ذلك (401/403)، تُعلَّم `needs_relink` ويُنبَّه المدير لإعادة الربط بنفسه.

## الإنتاج

تعمل كخدمة `dispatch-daemon` في `docker-compose.prod.yml` (الصورة من `docker/dispatch-daemon.Dockerfile`، `restart: unless-stopped`).
المتغيّرات من `.env` الجذري على السيرفر: `DISPATCH_INGEST_SECRET`، `UBER_PROXY_URL`، `SHARD_ID`، `DAEMON_SENTRY_DSN`.
