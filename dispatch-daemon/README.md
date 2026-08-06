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
│  • لكل جلسة: ack(seq=-1) ثم recv(seq=0) SSE       │
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
cp .env.example .env      # املأ DISPATCH_INGEST_SECRET ليطابق الباك
npm start                 # node src/index.js
```

> يتطلّب **Node.js 20+** (يستخدم `fetch` المدمج و`getSetCookie`). لا توجد اعتماديات خارجية.

## تدوير الكوكيز (لماذا لا نحتاج كلمة مرور)

الجلسة المُستخدَمة باستمرار لا تنتهي كالخاملة: كل ردّ قد يحمل `Set-Cookie` بكوكيز مُجدَّدة. الـdaemon يلتقطها ويحفظها في الباك، فتبقى الجلسة حيّة أطول بكثير من شهر — **بدون تخزين أي كلمة مرور**. إن رفضت أوبر الجلسة رغم ذلك (401/403)، تُعلَّم `needs_relink` ويُنبَّه المدير لإعادة الربط بنفسه.

## الإنتاج

شغّلها تحت `Supervisor` أو `pm2` لإعادة التشغيل التلقائي:

```ini
[program:ridy-dispatch-daemon]
command=node /var/www/ridy/dispatch-daemon/src/index.js
autostart=true
autorestart=true
environment=RIDY_API_URL="https://api.ridy.de",DISPATCH_INGEST_SECRET="..."
```
