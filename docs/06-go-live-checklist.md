# قائمة الإطلاق للإنتاج (Go-Live Checklist) — DASHCAM

> **الحالة:** المنتج مكتمل وظيفياً بنسبة **~98%** و**متوافق مع DSGVO بالتصميم** (P0–P7 منجزة، 38 اختبار باك أخضر). هذه القائمة تغطّي مهام **الإطلاق (go-live)** — **ليست** مهام تطوير ميزات. الميزات جاهزة؛ المطلوب هو الجاهزية التشغيلية + التكاملات الحقيقية + الغطاء القانوني.
> **يُقرأ مع:** [01-project-analysis.md](./01-project-analysis.md) · [02-technical-plan.md](./02-technical-plan.md) · [04-progress.md](./04-progress.md) · [07-run-guide.md](./07-run-guide.md)
> **اللغة:** شرح بالعربي + المصطلحات بالإنجليزي. كل بند checkbox مع ملاحظة سطر واحد.

---

## 1. التقنية / Technical readiness

- [ ] **Tests green** — `php artisan test` كلها خضراء (38+) قبل أي نشر.
- [ ] **Frontend build green** — `npm run build` ينجح (exit 0) بلا أخطاء type/lint.
- [ ] **Config + route + event cache** — `php artisan config:cache && route:cache && event:cache` في الإنتاج.
- [ ] **APP_ENV=production / APP_DEBUG=false** — إخفاء آثار الأخطاء التفصيلية عن المستخدم.
- [ ] **Error tracking (Sentry EU)** — ربط Sentry (إقليم EU) + structured logging لالتقاط الأخطاء.
- [ ] **Health checks** — `GET /api/v1/health` موصول بـ uptime monitor + فحص اتصال DB/Redis/queue.
- [ ] **Frontend production deploy** — Next.js مبنيّ ومخدوم production (مش `npm run dev`).
- [ ] **Versioning/migrations gate** — `php artisan migrate --force` ضمن خط النشر بعد أخذ نسخة احتياطية.

---

## 2. التكاملات / Provider integrations

- [ ] **Samsara — اعتماد حقيقي** — API token حقيقي، أو (الأفضل) OAuth **Marketplace app** (install لكل org → token لكل tenant).
- [ ] **Samsara rate limits + cursors** — احترام 5 req/s و`Retry-After`، وآلية re-bootstrap للـ cursor (تنتهي صلاحيته بعد 30 يوم).
- [ ] **Uber — Supplier credentials حقيقية** — `client_id`/`client_secret`/`org_id` فعليّة.
- [ ] **Uber — Offline Reporting الكامل** — تأكيد دورة **request → poll → download** الحقيقية (بدل النداء المبسّط) + **field mapping** لـ `REPORT_TYPE_TRIP_ACTIVITY`.
- [ ] **Bolt — partner onboarding** — اجتياز بوّابة Bolt (partner-gated) للحصول على وصول Fleet Integration API.
- [ ] **Bolt — تأكيد أشكال الـ API** — تثبيت الحقول/الحدود الفعلية (المُعلَّمة "تُؤكَّد عند الـ onboarding") ومطابقتها للـ normalizer.
- [ ] **HERE_API_KEY** — مفتاح HERE حقيقي للـ geocoding (تحويل عناوين Uber/Bolt → lat/lng) — مفقود حالياً، **حاجِب** للمطابقة الجغرافية.
- [ ] **مراقبة فشل المزامنة** — تنبيه عند فشل أي connector + عكس الحالة على `integration_connections.status`.

---

## 3. البنية التحتية / Infrastructure

- [ ] **MySQL 8 (EU)** — قاعدة إنتاج MySQL 8 مستضافة داخل الـ EU (التحويل = `.env` فقط، التوافق متحقَّق).
- [ ] **Redis + Horizon** — تفعيل Redis وتشغيل Horizon supervisors (بدل `database`/`sync` المحلي) للطوابير.
- [ ] **مزوّد بريد حقيقي** — SMTP أو Resend (إقليم EU) بدل `MAIL_MAILER=log` لإرسال التنبيهات فعلياً.
- [ ] **Hetzner + Docker Compose** — نشر على Hetzner (DE) عبر docker-compose (app/nginx/mysql/redis/horizon/scheduler/frontend).
- [ ] **TLS (Let's Encrypt)** — شهادة HTTPS على nginx + إعادة توجيه HTTP→HTTPS.
- [ ] **نسخ احتياطي مشفّرة (EU)** — backups دورية مشفّرة ومخزّنة داخل الـ EU + اختبار استرجاع.
- [ ] **Queue worker + Scheduler كخدمات** — `queue:work` (أو Horizon) و`schedule:work` كـ services دائمة (systemd/Docker) مع auto-restart.
- [ ] **إقامة البيانات (EU residency)** — تأكيد كل الخدمات والـ sub-processors داخل الـ EU (DSGVO).

---

## 4. الأمان / Security

- [ ] **تشفير التوكنات at-rest** — اعتمادات المزوّدين في `integration_connections` مشفّرة (encrypted casts) مع `APP_KEY` آمن.
- [ ] **CORS / CSRF (Sanctum SPA)** — `supports_credentials=true` + `SANCTUM_STATEFUL_DOMAINS` + `SESSION_DOMAIN` ضبط إنتاج صحيح.
- [ ] **إدارة الأسرار (secrets management)** — `.env`/الأسرار خارج الـ repo، عبر متغيّرات بيئة الخادم أو vault.
- [ ] **Rate limiting** — حدود على endpoints الحساسة (login، مزامنة، تقارير) ضد الإساءة.
- [ ] **Least-privilege DB** — مستخدم DB بصلاحيات محدودة (لا root) للتطبيق.
- [ ] **No PII in logs** — لا بيانات شخصية (مواقع/أسماء سواقين) في اللوجات أو رسائل الأخطاء.
- [ ] **HTTPS-only cookies** — كوكيز الجلسة `Secure` + `HttpOnly` + `SameSite` في الإنتاج.

---

## 5. 🔴 القانوني / DSGVO & Legal (launch blockers)

> 🔴 **حواجب إطلاق إلزامية** — الميزة الأساسية (كشف الرحلات الشخصية للموظفين) أشد فئة مقيّدة في ألمانيا. لا إطلاق فعلي قبل اكتمال هذا القسم. (قيود تصميم، **ليست** استشارة قانونية.)

- [ ] **تعيين DPO ألماني** — مسؤول حماية بيانات (Datenschutzbeauftragter) معتمَد.
- [ ] **اتفاق مجلس العمال (Betriebsvereinbarung)** — موافقة Betriebsrat قبل تفعيل التتبّع/الكشف.
- [ ] **DPIA مكتمل (Art. 35)** — تقييم أثر حماية البيانات منجَز وموثَّق.
- [ ] **RoPA** — سجلّ أنشطة المعالجة (Records of Processing Activities) مكتمل + قائمة sub-processors (Samsara, HERE, Hetzner, Sentry).
- [ ] **DPA مع كل عميل (Art. 28)** — اتفاقية معالجة بيانات (أنت processor، الشركة controller) لكل tenant.
- [ ] **ضبط الـ retention لكل tenant** — مدد الاحتفاظ + auto-delete مضبوطة per-tenant (`retention:purge` يحذف الموقع الخام).
- [ ] **مسار حقوق صاحب البيانات (Art. 15/21)** — workflow فعّال لطلبات الوصول/الاعتراض (الـ endpoints جاهزة: `transparency/data-request` + `object`).
- [ ] **تأكيد "اكشف بدون ما تراقب" في الإنتاج** — التحقق أن `personal_trips` تخزّن buckets فقط بلا polyline/وجهة (data minimization).
- [ ] **Feature-gating مفعّل** — الكشف يبقى مقفولاً حتى إقرار الـ tenant بـ Betriebsvereinbarung + DPIA (`compliance/attestations`).
- [ ] **إشعار الشفافية (Art. 13)** — شاشة شفافية السائق + الأساس القانوني معروضة بالألماني.

---

## 6. التشغيل / Operations

- [ ] **مسار onboarding لكل عميل** — تدفّق إعداد tenant جديد (ربط المزوّدين + الإعدادات + الإقرارات القانونية).
- [ ] **مراقبة وتنبيهات لفشل المزامنة** — alerts عند فشل أي sync/connector أو تراكم الطابور/`failed_jobs`.
- [ ] **Runbook** — دليل تشغيل للحوادث الشائعة (فشل مزوّد، انتهاء token، تراكم queue، استرجاع backup).
- [ ] **دعم (Support)** — قناة دعم + SLA + توثيق للعملاء.
- [ ] **مراقبة الأداء (observability)** — Horizon dashboard + metrics + تنبيهات على زمن الاستجابة/الأخطاء.
- [ ] **خطة استرجاع كوارث (DR)** — اختبار استرجاع من النسخ الاحتياطية دورياً + RTO/RPO معرّفان.
