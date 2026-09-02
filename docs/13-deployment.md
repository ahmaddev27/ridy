# دليل النشر — Ridy على VPS جديد (`reidey.de`)

> **الطريقة:** Docker Compose + Caddy (شهادة HTTPS تلقائية). أنت تنفّذ على السيرفر؛ المطوّر يوجّه.
> **الملفات:** [docker-compose.prod.yml](../docker-compose.prod.yml) · [.env.prod.example](../.env.prod.example) · [docker/Caddyfile](../docker/Caddyfile)

---

## المعمارية على السيرفر

```
                          الإنترنت
                             │  (443 / 80)
                        ┌────▼────┐
                        │  Caddy  │  TLS تلقائي (Let's Encrypt)
                        └──┬───┬──┘
          /api /sanctum /up │   │ كل شي آخر
                     ┌──────▼┐ ┌▼─────────┐
                     │backend│ │ frontend │  (Next.js)
                     │php-fpm│ └──────────┘
                     └───┬───┘
                         │  (scheduler + queue + reverb = نفس صورة backend)
        ┌────────┬───────┼─────────┬──────────┐
    ┌───▼───┐ ┌──▼─────┐ ┌▼──────┐ ┌▼───────┐
    │ mysql │ │schedule│ │ queue │ │ reverb │  ← WebSocket للتطبيق
    └───────┘ │ :work  │ │ :work │ └────────┘
              └────────┘ └───────┘

        ┌──────────────────┐   ┌──────────────────────────────┐
        │ dispatch-daemon  │→  │ nominatim + osrm (اختياري،    │
        │   RAMEN 24/7     │   │ profile geo — جيوكودنغ ذاتي)  │
        └──────────────────┘   └──────────────────────────────┘
              → Uber RAMEN
```

---

## المتطلّبات

- VPS لينكس (Ubuntu 22.04+ موصى) + دومين `reidey.de` يشير لـIP السيرفر (سجل DNS **A**).
- منفذا **80** و**443** مفتوحين (Caddy يحتاجهم للشهادة).

---

## 1. DNS

في مزوّد الدومين، اعمل سجل **A**:

```
reidey.de   A   <IP-السيرفر>
```

تأكّد (من جهازك): `ping reidey.de` يرجّع IP السيرفر.

---

## 2. تثبيت Docker على السيرفر

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER    # ثم أعد تسجيل الدخول (logout/login)
docker compose version           # تأكيد
```

---

## 3. جلب الكود (Git)

على جهازك، ادفع المشروع لريبو (GitHub/GitLab خاص):

```bash
cd /path/to/DASHCAM
git init && git add -A && git commit -m "Ridy"
git remote add origin git@github.com:<you>/ridy.git
git push -u origin main
```

على السيرفر:

```bash
git clone git@github.com:<you>/ridy.git ridy
cd ridy
```

> **مفتاح SSH للسيرفر:** ولّد مفتاحاً على السيرفر (`ssh-keygen`) وأضف الـ`.pub` لـDeploy Keys في الريبو — ليقدر السيرفر يعمل `git pull`.

---

## 4. الإعداد

```bash
cp .env.prod.example .env
nano .env            # املأ القيم
```

**عبّئ:** `DOMAIN` + `SITE_ADDRESS` = `reidey.de` · كلمات مرور DB قوية · `DISPATCH_INGEST_SECRET` (أي نص عشوائي طويل).

ولّد `APP_KEY`:

```bash
docker compose -f docker-compose.prod.yml run --rm backend php artisan key:generate --show
# انسخ الناتج (base64:...) وحطّه APP_KEY في .env
```

---

## 5. الإقلاع

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

أول مرّة: Caddy يجيب الشهادة تلقائياً (خلال ثوانٍ). تابع اللوجات:

```bash
docker compose -f docker-compose.prod.yml logs -f caddy backend
```

---

## 6. تهيئة قاعدة البيانات

```bash
docker compose -f docker-compose.prod.yml exec backend php artisan migrate --force --seed
```

الـseed ينشئ مستخدم إدارة: `manager@fleet.de` / `password` — **غيّر كلمة السر فوراً بعد أول دخول**.

---

## 7. التحقّق

- افتح `https://reidey.de` → لازم تشوف لوحة Ridy (بشهادة صالحة 🔒).
- `https://reidey.de/api/v1/health` → `{"status":"ok"}`.

---

## 8. ربط أوبر (على الإنتاج)

> **مهم:** الدخول المؤتمَت من السيرفر **محجوب** (أوبر تحجب داتا سنتر). على الإنتاج، الربط عبر **إضافة المتصفّح** فقط (المدير يربط من متصفّحه هو).

1. المدير يثبّت **إضافة Ridy** (Chrome Web Store أو unpacked — انظر [extension/README.md](../extension/README.md)).
2. لوحة Ridy → **Uber-Verbindung** → «Uber öffnen & verbinden» → يسجّل دخول أوبر عادي → الجلسة تُلتقط.
3. الـ`dispatch-daemon` يمسك التيار تلقائياً ويجيب العروض.

> الإضافة معدّة أصلاً لـ`https://reidey.de` ضمن `host_permissions`.

---

## 9. التحديثات لاحقاً

الـ`backend` **متّصل كـvolume** (مش مبني داخل الصورة)، فتحديث كود الباك = سحب + هجرة + مسح كاش + إعادة تشغيل، **بلا إعادة بناء**. النشر الآلي عبر CI (`git reset --hard origin/main` + `migrate --force`) هو المرجع الرسمي للنشر الروتيني — راجع **[16-server-migration-handoff.md](./16-server-migration-handoff.md)**.

```bash
git pull
# كود backend فقط (متّصل volume): هجرة + مسح كاش + إعادة تشغيل — بلا build
docker compose -f docker-compose.prod.yml exec backend php artisan migrate --force
docker compose -f docker-compose.prod.yml exec backend php artisan config:clear
docker compose -f docker-compose.prod.yml restart backend scheduler queue

# تغييرات frontend أو dispatch-daemon (داخل الصورة) تحتاج إعادة بناء:
docker compose -f docker-compose.prod.yml up -d --build frontend dispatch-daemon
```

---

## ملاحظات مهمة

- **قانوني (DSGVO):** تخزين بيانات سواقين/ركاب حقيقية على دومين حيّ يرفع مسؤوليتك القانونية بالسوق الألماني. قرارك.
- **ToS أوبر:** التقاط تيار الديسباتش عبر جلسة ملتقطة يخالف شروط أوبر وقد يتغيّر. قرار تجاري.
- **الأسرار:** لا ترفع `.env` للريبو (موجود بـ`.gitignore`). كلمات المرور والـsecret على السيرفر فقط.
- **uber-auth (الدخول المؤتمَت):** غير مضمّن بالـcompose الإنتاجي عمداً (محجوب من السيرفر + ثقيل). الربط عبر الإضافة.
