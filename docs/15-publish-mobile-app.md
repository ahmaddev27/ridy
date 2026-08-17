# نشر تطبيق السائق (Expo / EAS) على المتاجر

دليل نشر تطبيق `driver-app` (Expo SDK 52) على **Google Play** و**App Store**، مع OTA للتحديثات السريعة.

> المتغيّرات الحالية: `slug: reidey-driver` · `version: 1.1.0` · Android `package: de.fleeteye.reidey.driver` (versionCode 2) · iOS `bundleIdentifier: de.fleeteye.reidey.driver`.

---

## 0) مفاهيم أساسية

- **EAS Build**: يبني APK/AAB (أندرويد) و IPA (آيفون) على سحابة Expo.
- **EAS Submit**: يرفع البناء للمتجر مباشرة.
- **EAS Update (OTA)**: يدفع تعديلات **JavaScript/أصول** للتطبيق المثبّت بدون بناء/مراجعة جديدة. **يشتغل فقط للتغييرات غير-النيتف** (مش لإضافة مكتبة نيتف أو تغيير صلاحية/أيقونة تطبيق).

> ⚠️ **تنبيه حساب EAS:** إذا بنيت على حساب Expo مختلف عن اللي نشرت عليه OTA، التحديث ما بيوصل الجهاز (project/channel مختلف). خليك على **حساب واحد ثابت** لكل تطبيق.

---

## A) Google Play (أندرويد)

### 1) تجهيز
- حساب **Google Play Console** (رسوم لمرة واحدة **$25**).
- `google-services.json` موجود بالمشروع (لـFCM) ✅.
- تأكد `app.json`: `android.versionCode` **يرتفع** مع كل رفعة للمتجر.

### 2) بناء AAB للمتجر
```bash
cd driver-app
eas build -p android --profile production   # ينتج .aab (app-bundle)
```
> `eas.json` عندك: `production` = app-bundle. `preview` = APK للتجربة الجانبية (sideload).

### 3) أول رفعة (يدوي — لإنشاء التطبيق بالكونسول)
1. Play Console → **Create app** → الاسم/اللغة/النوع (App, Free).
2. عبّي: Privacy policy (`https://reidey.de/datenschutz`)، Data safety، Content rating، Target audience.
3. **Internal testing** (موصى أول) → Create release → ارفع الـ`.aab` → أضف مختبرين بإيميلاتهم → انشر. بيوصلهم رابط تثبيت.
4. بعد التجربة: **Production** → Create release → ارفع → Review (عادة أيام).

### 4) الرفعات التالية (أوتوماتيك)
```bash
eas build -p android --profile production --auto-submit
```
> أول مرة لـ`eas submit` بيطلب **Google service account JSON** (من Play Console → API access) — خزّنه، بعدها الرفع تلقائي.

---

## B) App Store (آيفون)

> ⚠️ iOS يحتاج **حساب Apple Developer ($99/سنة)** + إعداد إضافي للإشعارات (مش جاهز بعد — انظر القسم D).

### 1) تجهيز
- حساب Apple Developer.
- `app.json` → `ios.bundleIdentifier` موجود ✅.
- **iOS push مش مضبوط بعد** (لا `GoogleService-Info.plist`، لا مفتاح APNs) — التطبيق بيشتغل بس الإشعارات ما بتوصل لحد ما تضبط القسم D.

### 2) بناء + رفع
```bash
cd driver-app
eas build -p ios --profile production        # يطلب شهادات Apple (EAS بيديرها)
eas submit -p ios --latest                   # يرفع لـApp Store Connect / TestFlight
```
- **TestFlight** أول (تجربة داخلية/خارجية) → بعدها Submit for Review على App Store Connect.
- عبّي: Privacy policy، App privacy (nutrition label)، لقطات لكل مقاس شاشة مطلوب.

---

## C) التحديثات السريعة (OTA — بدون مراجعة متجر)

لأي تعديل **JavaScript/أصول** (نصوص، ألوان، إصلاحات UI، خطوط، منطق):
```bash
cd driver-app
eas update --branch preview --message "وصف التعديل"     # لقناة التجربة
eas update --branch production --message "وصف التعديل"   # للإنتاج
```
- التطبيق يسحب التحديث **عند الإقلاع**؛ يطبّق بالإقلاع اللي بعده → **أغلق التطبيق وافتحه مرتين**.
- **متى OTA ما يكفي (لازم بناء جديد):** إضافة/تحديث مكتبة نيتف، تغيير صلاحية، تغيير **أيقونة التطبيق**، تغيير `runtimeVersion`.

> `runtimeVersion.policy = "appVersion"` عندك — يعني OTA يطبّق فقط على بناء بنفس `version` (1.1.0). أي تغيير نيتف بيحتاج رفع الإصدار + بناء جديد.

---

## D) ⚠️ ناقص لإشعارات iOS (خطوة إعداد لمرة واحدة)

الإشعارات مضبوطة لأندرويد فقط حالياً. لتفعيل iOS:
1. أنشئ **APNs Authentication Key** من Apple Developer → Keys.
2. ارفعه على **Firebase** (Project settings → Cloud Messaging → APNs). هيك FCM يوصل لأجهزة آبل.
3. أضف **`GoogleService-Info.plist`** لـiOS (Firebase → iOS app) وحطّه بـ`app.json` (`ios.googleServicesFile`).
4. أعد بناء iOS.

---

## ✅ قائمة تحقّق سريعة

**أندرويد (Play):**
- [ ] `versionCode` ارتفع.
- [ ] `eas build -p android --profile production`.
- [ ] Data safety + Privacy policy معبّاة.
- [ ] Internal testing قبل Production.

**آيفون (App Store):**
- [ ] حساب Apple Developer فعّال.
- [ ] القسم D (APNs + plist) لتفعيل الإشعارات.
- [ ] `eas build -p ios --profile production` + TestFlight.

**OTA:**
- [ ] نفس الحساب/القناة للبناء والتحديث.
- [ ] تعديل JS فقط (مش نيتف).
- [ ] إغلاق/فتح مرتين على الجهاز.
