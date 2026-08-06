# Ridy Uber-Auth Service

خدمة Node تقوم بـ**تسجيل الدخول التفاعلي لأوبر** نيابةً عن لوحة المدير: تشغّل متصفّح Chromium حقيقي، تُدخل الإيميل/الباسوورد، وإذا طلبت أوبر رمز MFA تُبقي المتصفّح مفتوحاً حتى يُمرّر المدير الرمز عبر اللوحة. عند النجاح تلتقط الكوكيز (حتى httpOnly) + org uuid وتعيدها لـLaravel.

## لماذا خدمة منفصلة

- تسجيل دخول أوبر يتطلّب متصفّحاً حقيقياً (Playwright = Node) — لا يصلح داخل PHP.
- الـMFA يتطلّب إبقاء المتصفّح **حيّاً بين طلبين HTTP** (بدء الدخول ← إدخال الرمز)، وهذا يحتاج عملية Node ذات حالة.
- Laravel يبقى الدماغ: يوسّط، يخزّن الجلسة، يربط التينانت.

## التدفّق

```
Frontend ──(email/pass)──> Laravel ──> uber-auth ──> Uber
                                              │  status: mfa_required + login_id
Frontend <──(MFA-Feld)── Laravel <────────────┘
Frontend ──(code)──────> Laravel ──> uber-auth (نفس المتصفّح) ──> Uber
                                              │  status: success + cookies + org_uuid
Laravel: FleetSessionService.capture(...) ────┘  (يخزّن الجلسة، يفعّل الـdaemon)
```

## التشغيل

```bash
cd uber-auth
npm install                 # يثبّت playwright (يعيد استخدام Chromium المثبّت مسبقاً)
cp .env.example .env        # اضبط UBER_AUTH_SECRET ليطابق backend/.env
npm start                   # node src/server.js  ->  :8791
```

> **Node 20+**. لتصحيح محلي: `HEADFUL=1 npm start` لرؤية المتصفّح أثناء الدخول.

## نقاط الوصول (secret-guarded عبر `X-Auth-Secret`)

| Endpoint | الوظيفة |
|---|---|
| `POST /login/start` `{email,password}` | يبدأ الدخول → `success` \| `mfa_required` (+login_id) \| `passkey_unsupported` \| `bad_credentials` |
| `POST /login/mfa` `{login_id,code}` | يمرّر الرمز → `success` (+cookies,org_uuid) \| `mfa_required` (retry) |
| `POST /login/cancel` `{login_id}` | يغلق جلسة متروكة |
| `GET /health` | حالة + عدد الجلسات المعلّقة |

## حدود

- **passkey:** إذا كان الحساب يدخل بـpasskey/بصمة، الدخول من السيرفر مستحيل تشفيرياً → تُعاد الحالة `passkey_unsupported` ويستخدم المدير الطريقة اليدوية أو الموبايل.
- **IP الإنتاج:** الدخول من IP داتا سنتر قد يزيد صرامة تحقّق أوبر. الجلسة تبقى حيّة بعدها عبر **تدوير الكوكيز** في `dispatch-daemon`.
- انتحال عميل أوبر عبر endpoint غير موثّق يخالف ToS — قرار تجاري مقبول من المالك.

## الإنتاج

شغّلها تحت `Supervisor`/`pm2`. تحتاج بيئة رسومية-افتراضية (Chromium headless يعمل بلا شاشة) وذاكرة كافية (~300MB لكل متصفّح دخول نشط).
