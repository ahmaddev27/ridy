# موجز تصميم الواجهة + برومتات الذكاء — DASHCAM Dashboard

> **الغرض:** تجهيز تصميم الويب سايت (الداشبورد) باستخدام أداة ذكاء (v0.dev / Lovable / Bolt.new) أو Figma Make.
> **يُقرأ مع:** [02-technical-plan.md](./02-technical-plan.md). الستاك: **Next.js + React + Tailwind + shadcn/ui** — نفس مخرجات هذه الأدوات، فالكود قابل لإعادة الاستخدام مباشرة.
> **مبدأ حاكم:** السوق ألماني + DSGVO → تصميم **privacy-forward**: "اكشف بدون ما تراقب" (نعرض ميتاداتا مصغّرة للرحلات الشخصية، لا خرائط مسار خاص).

---

## القسم أ — تعليمات الاستخدام (اقرأها أولاً)

1. **ولّد شاشة-شاشة، مش كل شي دفعة وحدة.** ابدأ بالبرومت الرئيسي (القسم ج) لتثبيت الـ design system + الـ layout، بعدها استخدم برومت كل شاشة (القسم د).
2. **الكتابة (copy) ألماني أولاً + إنجليزي.** اطلب من الأداة تجهيز النصوص بالألماني افتراضياً ومفاتيح i18n.
3. **استخدم shadcn/ui + Tailwind + lucide-react + recharts** (للرسوم). هيك الكود ينزرع بـ frontend/ مباشرة.
4. **اطلب الحالات كلها:** loading (skeletons)، empty، error، و states الشارات (matched/personal/ambiguous/gap).
5. **لا تطلب خرائط لمسار الرحلات الشخصية** — هذا قرار امتثال؛ بدّلها بـ buckets/مؤشرات مصغّرة.
6. بعد التوليد، راجع التباين/الـ accessibility (WCAG AA) وملاءمة الموبايل/التابلت لمدير الأسطول.

---

## القسم ب — موجز التصميم (Design System & Scope)

### الهوية والإحساس
- **B2B SaaS احترافي، نظيف، موثوق، هادئ** (مش "أداة مراقبة"). يوحي بالشفافية والامتثال.
- جمهور: **مدير أسطول، محلل، مالك، DPO/مسؤول امتثال** (أدوار مختلفة = صلاحيات مختلفة).

### الألوان (Design Tokens)
| الدور | اللون المقترح |
|---|---|
| Primary (ثقة/أساسي) | Indigo/Blue عميق (`indigo-600/700`) |
| Neutrals | Slate (`slate-50` خلفية، `white` بطاقات، `slate-200` حدود، `slate-700/900` نص) |
| Work / Matched | Emerald (`emerald-500/600`) |
| Personal / Flagged | Rose هادئ (`rose-500` — **معلوماتي لا عدائي**) |
| Ambiguous / Review | Amber (`amber-500`) |
| Data Gap (كاميرا مطفأة) | Slate/Gray |
| Private mode | Violet خفيف (`violet-500`) |
- وضع داكن (dark mode) اختياري لكن مدعوم.

### الطباعة والتخطيط
- خط **Inter** (أو system)، تدرّج واضح للعناوين.
- **Layout:** Sidebar تنقل يسار + Topbar (بحث، locale switch DE/EN، إشعارات، مستخدم) + منطقة محتوى.
- بطاقات إحصائية (stat cards)، جداول بيانات مع فلاتر، side-panel للتفاصيل، modals، toasts.

### مكوّنات أساسية (shadcn/ui)
`Sidebar/Nav`, `DataTable` (فرز/فلترة/صفحات), `Badge` (status), `Card/StatCard`, `Tabs`, `Dialog/Sheet` (تفاصيل), `Select/DatePicker/Combobox` (فلاتر), `Charts` (recharts), `Skeleton`, `EmptyState`, `Toast`, `Banner` (gating/تنبيه امتثال), `Avatar`, `DropdownMenu`.

### قواعد UX خاصة بـ DSGVO (مهمة)
- **شارة الخصوصية:** الرحلات الشخصية تُعرض كـ صف فيه: حصلت؟، ضمن/خارج ساعات العمل، **شريحة مدة** (مثل 15–30د)، **شريحة مسافة** (مثل 5–10كم) — **بدون مسار/وجهة**.
- **Banner الـ gating:** لو ما اكتمل (Betriebsvereinbarung + DPIA) → الميزات الحساسة مقفولة بوضوح مع رسالة "يتطلب اتفاق مجلس العمال + DPIA".
- **شاشة شفافية السائق:** تعرض للسائق شو يُجمع عنه + إشعار Art.13 (ألماني).
- لوحات افتراضية = **تجميعات وإحصاءات**، مش حركة حيّة لحظية.

### الشاشات (MVP = P0–P4)
1. **Login** (+ نسيت كلمة المرور)
2. **Onboarding / Connections** — بطاقات ربط Samsara / Uber / Bolt (حالة OAuth: متصل/منتهي/خطأ + "اتصل").
3. **Dashboard Overview** — stat cards (مركبات، سواقين، رحلات اليوم، رحلات شخصية مُعلَّمة، صحة المزامنة) + chart اتجاه + آخر التنبيهات.
4. **Drivers** — جدول + side-panel تفاصيل (الهوية الموحّدة عبر المنصات).
5. **Vehicles** — جدول + تفاصيل + حالة مطابقة اللوحة عبر المنصات.
6. **Assignments** — ربط سائق↔مركبة (timeline/جدول زمني).
7. **Trips** — رحلات telematics + platform، فلترة بالمركبة/السائق/التاريخ، شارات الحالة.
8. **Review Queue** — مطابقات غامضة (قبول/رفض) + **Identity Match Queue** للوحات غير المتطابقة.
9. **Personal Trips** ⭐ (قلب القيمة) — قائمة الرحلات غير المطابقة بميتاداتا مصغّرة، تجميع لكل سائق/مركبة.
10. **Reports** — تقارير لكل سائق/مركبة/فترة + تصدير.
11. **Compliance Settings** — ساعات العمل، retention، private mode، regime، + attestations (works agreement + DPIA) مع banner الـ gating.
12. **Audit Log** — سجل وصول/تغييرات (append-only، فلترة).
13. **Driver Transparency View** — شفافية السائق + إشعار Art.13.
14. **Notifications Center** — بريد + in-app.
15. **Settings / Users & Roles** — RBAC (owner/fleet_manager/analyst/viewer/dpo).

---

## القسم ج — البرومت الرئيسي (الصقه أولاً)

```text
You are designing a production-grade B2B SaaS dashboard called "DASHCAM Fleet Compliance".

PRODUCT: A multi-tenant SaaS for German Uber/Bolt fleet companies. It connects each fleet's
Samsara telematics, Uber, and Bolt accounts, matches platform trips against telematics trips,
and surfaces "personal / off-platform" trips (company cars used privately) so the fleet can act.
Audience: fleet manager, analyst, owner, and a DPO/compliance role.

STACK & OUTPUT: Next.js (App Router) + React + TypeScript + Tailwind CSS + shadcn/ui + lucide-react
icons + recharts for charts. Produce clean, reusable components. Make it i18n-ready with German as
the default language and English as secondary (use translation keys, German copy in the UI).

DESIGN SYSTEM:
- Feel: professional, clean, trustworthy, calm, PRIVACY-FORWARD (this is a compliance tool, not a
  surveillance tool). Generous whitespace, clear hierarchy, Inter font.
- Colors: primary = deep indigo (indigo-600/700); neutrals = slate (slate-50 bg, white cards,
  slate-200 borders, slate-700/900 text). Semantic status: Work/Matched = emerald, Personal/Flagged
  = soft rose (informational, NOT aggressive), Ambiguous/Review = amber, Data-gap = slate, Private
  mode = violet. Support optional dark mode.
- Layout: left Sidebar navigation + Topbar (global search, DE/EN locale switch, notifications bell,
  user menu) + content area. Use shadcn DataTable (sortable/filterable/paginated), Badge for status,
  StatCard, Tabs, Sheet/Dialog for detail panels, Skeleton loaders, EmptyState, Toast, and a Banner
  component for compliance gating.

CRITICAL COMPLIANCE UX RULE (German DSGVO — "detect, don't surveil"):
- NEVER show a map or route polyline for PERSONAL trips. Personal trips are displayed as MINIMIZED
  METADATA only: occurred (yes), within/outside working hours, a DURATION BUCKET (e.g. 15–30 min),
  and a DISTANCE BUCKET (e.g. 5–10 km) — no destination, no route.
- Show a compliance gating Banner when "Works Council Agreement (Betriebsvereinbarung) + DPIA" are
  not completed: sensitive features appear locked with a clear explanation.
- Include subtle privacy/transparency cues.

Build a consistent app shell with the sidebar nav containing: Dashboard, Connections, Drivers,
Vehicles, Assignments, Trips, Review Queue, Personal Trips, Reports, Compliance, Audit Log,
Notifications, Settings. Then I will ask you to build each screen. Start by generating the app
shell (sidebar + topbar + responsive layout + theme tokens) and a Dashboard Overview page with
stat cards (Vehicles, Drivers, Trips today, Personal trips flagged, Sync health), a trend chart,
and a "recent flags" list. Cover loading, empty, and error states.
```

---

## القسم د — برومتات الشاشات (واحدة-واحدة بعد الرئيسي)

**Connections / Onboarding**
```text
Build the "Connections" page: three provider cards (Samsara, Uber, Bolt). Each card shows the logo
placeholder, connection status badge (Connected / Token expiring / Error / Not connected), last sync
time, and a primary action ("Connect" via OAuth / "Reconnect" / "Manage"). Add a top stepper for
first-time onboarding (1. Connect Samsara, 2. Connect Uber, 3. Connect Bolt, 4. Compliance setup).
States: loading skeleton, empty (nothing connected), error toast.
```

**Personal Trips (core screen)**
```text
Build the "Personal Trips" page — the core value screen. A filterable DataTable of flagged
unmatched telematics trips, grouped/filterable by driver and vehicle and date range. Columns:
date, vehicle (plate), driver (pseudonymized option), within/outside working hours (badge),
duration bucket, distance bucket, status (New/Reviewed/Dismissed), actions. IMPORTANT: no map,
no route, no destination — minimized metadata only. Add a small privacy note explaining data
minimization. Include a detail Sheet with the same minimized fields + an audit trail of who viewed
it. Provide summary StatCards on top (total flagged this period, per-driver top list).
```

**Review Queue + Identity Match**
```text
Build the "Review Queue" page with two tabs: (1) "Ambiguous Matches" — a list of telematics↔platform
trip pairs with a confidence score, side-by-side compact details (times, distance, addresses for the
PLATFORM trip only), and Approve / Reject actions. (2) "Identity Matches" — vehicles whose license
plate did not auto-match across Samsara/Uber/Bolt; let the admin manually link the provider records
into one unified vehicle. Include filters, bulk actions, and empty states.
```

**Trips (telematics + platform)**
```text
Build the "Trips" page: a DataTable combining telematics (Samsara) and platform (Uber/Bolt) trips
with a source column (icon), vehicle (plate), driver, start/end time, distance, status badge
(Matched=emerald / Personal=rose / Ambiguous=amber / Gap=slate). Filters: provider, vehicle, driver,
date range, status. Row click opens a detail Sheet. For platform trips show pickup/dropoff address;
for telematics trips show start/end coordinates summary (no full polyline UI for personal ones).
```

**Compliance Settings**
```text
Build the "Compliance" page with sections: (1) Working hours window (per weekday time ranges),
(2) Data retention (sliders/inputs for raw-location retention vs aggregate retention), (3) Private
mode toggle, (4) Regime selector (Employee / Contractor — default Employee), (5) Attestations:
"Works Council Agreement" and "DPIA" with status (Pending/Completed), upload reference, and dates.
Show a prominent gating Banner at the top: if attestations are incomplete, sensitive detection
features are LOCKED. German-first copy.
```

**Drivers / Vehicles**
```text
Build the "Vehicles" page: DataTable (plate, VIN, make/model, providers linked badges
[Samsara/Uber/Bolt], assigned driver, status), with a detail Sheet showing the unified identity and
external IDs per provider, and the plate-normalization match status. Then build a parallel "Drivers"
page (name, phone, license, employment type, providers linked, current vehicle) with pseudonymization
toggle in the UI.
```

**Driver Transparency View**
```text
Build a "Driver Transparency" page (driver-facing): plainly explains what data is collected, the
legal basis, retention, current mode (work/private), and the GDPR Art. 13 notice. Calm, reassuring,
German-first. Include the driver's own data export / objection request buttons.
```

**Dashboard Overview (إن أردت تحسينه)**
```text
Refine the Dashboard: StatCards (Vehicles, Active drivers, Trips today, Personal trips flagged this
week, Sync health per provider), a trend area-chart (matched vs personal over time), a "Sync status"
panel per provider (last sync, errors), and a "Recent flags" list linking to Personal Trips. Keep it
aggregate-level (no live tracking).
```

---

## القسم هـ — ملاحظات أدوات بديلة

- **Figma Make / Figma design:** استخدم نفس "القسم ج" كوصف، واطلب "high-fidelity Figma screens, desktop 1440px, with a design system / components library and German copy". (وفيني أولّدها مباشرة في Figma عبر الأدوات المتاحة عندي لو حبيت.)
- **مصمّم بشري (Design brief):** سلّمه القسم ب (الهوية + الألوان + الشاشات + قواعد DSGVO) كـ brief.
- **الموبايل:** الأولوية ديسكتوب (مدير أسطول)، بس خلّي الجداول responsive.

---

## القسم و — الخطوة التالية
بعد ما تجهّز الشاشات، ننتقل لـ **spec مرحلة P0** ونبدأ التنفيذ بحيث الواجهة المولّدة تنزرع في `frontend/` فوق REST API.
