import { getLocales } from "expo-localization";
import { I18nManager } from "react-native";
import { useSyncExternalStore } from "react";

type Dict = Record<string, string>;

const de: Dict = {
  "login.title": "Anmelden",
  "login.email": "E-Mail",
  "login.password": "Passwort",
  "login.submit": "Anmelden",
  "login.error": "Anmeldung fehlgeschlagen",
  "activate.title": "Konto aktivieren",
  "activate.intro": "Lege ein Passwort fest, um Fahrtangebote zu empfangen.",
  "activate.submit": "Aktivieren",
  "activate.invalid": "Einladung ungültig oder abgelaufen",
  "offers.title": "Angebote",
  "offers.empty": "Noch keine Angebote",
  "offers.pickup": "Abholung",
  "offers.dropoff": "Ziel",
  "offer.expiresIn": "Läuft ab in",
  "offer.expired": "Abgelaufen",
  "offer.openUber": "In Uber öffnen",
  "offer.distance": "Distanz",
  "offer.total": "Gesamtpreis", "offer.remaining": "verbleibend",
  "status.pending": "Offen",
  "status.accepted": "Angenommen",
  "status.started": "Auf Fahrt",
  "status.completed": "Fertig",
  "status.rejected": "Abgelehnt",
  "status.canceled": "Storniert",
  // Home / offer / profile (exact design wording)
  "home.greetingDay": "Guten Tag",
  "home.greetingEvening": "Guten Abend",
  "home.st.offers": "Angebote",
  "home.st.accept": "Annahme",
  "home.st.earnings": "Verdienst",
  "home.st.distance": "Strecke",
  "home.ago": "vor {n} Min",
  "home.eta": "ca. {n} Min",
  "home.details": "Details",
  "home.all": "Alle",
  "offer.header": "Angebot",
  "offer.abholung": "Abholung",
  "offer.ziel": "Ziel",
  "offer.strecke": "Strecke",
  "offer.qualitaet": "Qualität",
  "offer.openMaps": "Karte öffnen",
  "offer.observe": "Annahme erfolgt in der Uber Driver App.\nReidey beobachtet nur.",
  "offer.rider": "Fahrgast",
  "offer.eta": "Dauer",
  "offer.received": "Erhalten",
  "offer.requested": "Angefragt",
  "offer.acceptWindow": "Annahmefenster",
  "offer.duration": "Fahrtdauer", "offer.minShort": "Min", "offer.secShort": "Sek", "offer.hrShort": "Std",
  "offer.qualityHint": "€€ ist die Preisqualität pro km, kein zweiter Preis.",
  "offer.noGeo": "Strecke und Preis pro km erscheinen, sobald die Fahrt geokodiert ist.",
  "profile.verdienstToday": "Verdienst heute",
  "profile.vsYesterday": "ggü. gestern",
  "profile.accepted": "{n} angenommen",
  "profile.declined": "{n} abgelehnt",
  "profile.konto": "Konto",
  "profile.notifications": "Benachrichtigungen",
  "profile.pushNew": "Push für neue Angebote",
  "profile.pushNewSub": "Erlaubt · hohe Priorität",
  "signin.subtitle": "Melde dich mit deinen Flottendaten an",
  "update.title": "Aktualisierung erforderlich",
  "update.body": "Es ist eine neuere Version der App verfügbar. Bitte aktualisiere, um fortzufahren.",
  "update.button": "Jetzt aktualisieren",
  "signin.forgot": "Passwort vergessen?",
  "signin.forgotHint": "Wende dich an deine Flotte, um dein Passwort zurückzusetzen. Der Zugang wird über die Einladung deines Unternehmens verwaltet.",
  "signin.inviteNote": "Zugang erhältst du per Einladung deiner Flotte.",
  "settings.title": "Einstellungen",
  "settings.logout": "Abmelden",
  "settings.language": "Sprache",
  "settings.profile": "Profil",
  "settings.name": "Name",
  "settings.newPassword": "Neues Passwort (optional)",
  "settings.save": "Speichern",
  "settings.saved": "Gespeichert",
  "settings.saveError": "Konnte nicht gespeichert werden",
  "common.seconds": "Sek.",
  // Tabs
  "tabs.home": "Startseite",
  "tabs.offers": "Angebote",
  "tabs.profile": "Profil",
  "tabs.statistics": "Statistiken", "stats.title": "Statistiken", "stats.totalIncome": "Gesamteinnahmen", "stats.avgPerKm": "Ø €/km",
  // Home
  "home.greeting": "Hallo",
  "home.online": "Online",
  "home.offline": "Offline",
  "home.engagement.0": "Bereit",
  "home.engagement.1": "Auf dem Weg",
  "home.engagement.2": "Auf Fahrt",
  "home.today": "Heute",
  "home.activeOffer": "Aktives Angebot",
  "home.recent": "Letzte Angebote",
  "home.week": "Diese Woche",
  "home.empty": "Noch keine Angebote heute",
  // Stat cards
  "stat.offers": "Angebote",
  "stat.accepted": "Angenommen",
  "stat.acceptanceRate": "Annahmequote",
  "stat.earnings": "Einnahmen",
  "stat.km": "km",
  "stat.completed": "Abgeschlossen",
  "stat.declined": "Abgelehnt",
  // Offers filters
  "offers.search": "Suchen",
  "offers.from": "Von",
  "offers.to": "Bis",
  "offers.loadMore": "Mehr laden",
  "filter.all": "Alle",
  // Profile
  "profile.stats": "Statistik",
  "profile.settings": "Einstellungen",
  "profile.company": "Unternehmen", "profile.email": "E-Mail", "profile.verified": "Verifiziert", "profile.personalInfo": "Persönliche Angaben", "profile.support": "Support", "profile.logout": "Abmelden", "profile.appName": "REIDEY Driver", "settings.preferences": "Präferenzen", "settings.offerNotifications": "Angebotsbenachrichtigungen", "settings.sound": "Ton", "settings.haptic": "Haptisches Feedback", "settings.account": "Konto", "settings.personalInfo": "Persönliche Daten", "settings.security": "Sicherheit", "settings.support": "Support", "settings.helpCenter": "Hilfecenter", "settings.contactSupport": "Support kontaktieren", "splash.caption": "VERBINDET FAHRER", "language.choose": "Sprache wählen", "language.subtitle": "Du kannst dies später in den Einstellungen ändern.", "language.continue": "Weiter",
  "range.today": "Heute",
  "range.7d": "7 Tage",
  "range.30d": "30 Tage",
  // Fleet-owner mode
  "home.fleetTitle": "Flotte",
  "fleet.driver": "Fahrer",
  "fleet.onlineDrivers": "Fahrer online",
  "fleet.activeNow": "Aktive Fahrten",
};

const en: Dict = {
  "login.title": "Sign in",
  "login.email": "Email",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.error": "Sign-in failed",
  "activate.title": "Activate account",
  "activate.intro": "Set a password to start receiving ride offers.",
  "activate.submit": "Activate",
  "activate.invalid": "Invitation invalid or expired",
  "offers.title": "Offers",
  "offers.empty": "No offers yet",
  "offers.pickup": "Pickup",
  "offers.dropoff": "Drop-off",
  "offer.expiresIn": "Expires in",
  "offer.expired": "Expired",
  "offer.openUber": "Open in Uber",
  "offer.distance": "Distance",
  "offer.total": "Total Price", "offer.remaining": "remaining",
  "status.pending": "Open",
  "status.accepted": "Accepted",
  "status.started": "On trip",
  "status.completed": "Done",
  "status.rejected": "Declined",
  "status.canceled": "Canceled",
  "home.greetingDay": "Good day",
  "home.greetingEvening": "Good evening",
  "home.st.offers": "Offers",
  "home.st.accept": "Accept",
  "home.st.earnings": "Earned",
  "home.st.distance": "Distance",
  "home.ago": "{n} min ago",
  "home.eta": "~{n} min",
  "home.details": "Details",
  "home.all": "All",
  "offer.header": "Offer",
  "offer.abholung": "Pickup",
  "offer.ziel": "Drop-off",
  "offer.strecke": "Distance",
  "offer.qualitaet": "Quality",
  "offer.openMaps": "Open in Maps",
  "offer.observe": "Accept it in the Uber Driver app.\nReidey only observes.",
  "offer.rider": "Rider",
  "offer.eta": "Duration",
  "offer.received": "Received",
  "offer.requested": "Requested",
  "offer.acceptWindow": "Accept window",
  "offer.duration": "Trip duration", "offer.minShort": "min", "offer.secShort": "sec", "offer.hrShort": "hr",
  "offer.qualityHint": "€€ is the price-per-km quality rating, not a second price.",
  "offer.noGeo": "Distance and price per km appear once the trip is geocoded.",
  "profile.verdienstToday": "Earned today",
  "profile.vsYesterday": "vs. yesterday",
  "profile.accepted": "{n} accepted",
  "profile.declined": "{n} declined",
  "profile.konto": "Account",
  "profile.notifications": "Notifications",
  "profile.pushNew": "Push for new offers",
  "profile.pushNewSub": "Allowed · high priority",
  "signin.subtitle": "Sign in with your fleet details",
  "update.title": "Update required",
  "update.body": "A newer version of the app is available. Please update to continue.",
  "update.button": "Update now",
  "signin.forgot": "Forgot password?",
  "signin.forgotHint": "Contact your fleet to reset your password. Access is managed through your company's invitation.",
  "signin.inviteNote": "Access is granted by your fleet's invitation.",
  "settings.title": "Settings",
  "settings.logout": "Log out",
  "settings.language": "Language",
  "settings.profile": "Profile",
  "settings.name": "Name",
  "settings.newPassword": "New password (optional)",
  "settings.save": "Save",
  "settings.saved": "Saved",
  "settings.saveError": "Couldn’t save",
  "common.seconds": "s",
  // Tabs
  "tabs.home": "Home",
  "tabs.offers": "Offers",
  "tabs.profile": "Profile",
  "tabs.statistics": "Statistics", "stats.title": "Statistics", "stats.totalIncome": "Total income", "stats.avgPerKm": "Avg. €/km",
  // Home
  "home.greeting": "Hi",
  "home.online": "Online",
  "home.offline": "Offline",
  "home.engagement.0": "Idle",
  "home.engagement.1": "En route",
  "home.engagement.2": "On trip",
  "home.today": "Today",
  "home.activeOffer": "Active offer",
  "home.recent": "Recent offers",
  "home.week": "This week",
  "home.empty": "No offers yet today",
  // Stat cards
  "stat.offers": "Offers",
  "stat.accepted": "Accepted",
  "stat.acceptanceRate": "Acceptance",
  "stat.earnings": "Earnings",
  "stat.km": "km",
  "stat.completed": "Completed",
  "stat.declined": "Declined",
  // Offers filters
  "offers.search": "Search",
  "offers.from": "From",
  "offers.to": "To",
  "offers.loadMore": "Load more",
  "filter.all": "All",
  // Profile
  "profile.stats": "Stats",
  "profile.settings": "Settings",
  "profile.company": "Company", "profile.email": "Email", "profile.verified": "Verified", "profile.personalInfo": "Personal information", "profile.support": "Support", "profile.logout": "Log out", "profile.appName": "REIDEY Driver", "settings.preferences": "Preferences", "settings.offerNotifications": "Offer notifications", "settings.sound": "Sound", "settings.haptic": "Haptic feedback", "settings.account": "Account", "settings.personalInfo": "Personal information", "settings.security": "Security", "settings.support": "Support", "settings.helpCenter": "Help center", "settings.contactSupport": "Contact support", "splash.caption": "CONNECTING DRIVERS", "language.choose": "Choose your language", "language.subtitle": "You can change this later in settings.", "language.continue": "Continue",
  "range.today": "Today",
  "range.7d": "7 days",
  "range.30d": "30 days",
  // Fleet-owner mode
  "home.fleetTitle": "Fleet",
  "fleet.driver": "Driver",
  "fleet.onlineDrivers": "drivers online",
  "fleet.activeNow": "Active trips",
};

const ar: Dict = {
  "login.title": "تسجيل الدخول",
  "login.email": "الإيميل",
  "login.password": "كلمة المرور",
  "login.submit": "دخول",
  "login.error": "فشل تسجيل الدخول",
  "activate.title": "تفعيل الحساب",
  "activate.intro": "عيّن كلمة مرور لتبدأ باستقبال العروض.",
  "activate.submit": "تفعيل",
  "activate.invalid": "الدعوة غير صالحة أو منتهية",
  "offers.title": "العروض",
  "offers.empty": "لا عروض بعد",
  "offers.pickup": "الانطلاق",
  "offers.dropoff": "الوجهة",
  "offer.expiresIn": "ينتهي خلال",
  "offer.expired": "انتهى",
  "offer.openUber": "افتح في أوبر",
  "offer.distance": "المسافة",
  "offer.total": "السعر الإجمالي", "offer.remaining": "متبقٍ",
  "status.pending": "معلّق",
  "status.accepted": "مقبول",
  "status.started": "جارية",
  "status.completed": "مكتمل",
  "status.rejected": "مرفوض",
  "status.canceled": "ملغى",
  "home.greetingDay": "يومك سعيد",
  "home.greetingEvening": "مساء الخير",
  "home.st.offers": "العروض",
  "home.st.accept": "القبول",
  "home.st.earnings": "الأرباح",
  "home.st.distance": "المسافة",
  "home.ago": "قبل {n} د",
  "home.eta": "~{n} د",
  "home.details": "التفاصيل",
  "home.all": "الكل",
  "offer.header": "العرض",
  "offer.abholung": "الانطلاق",
  "offer.ziel": "الوجهة",
  "offer.strecke": "المسافة",
  "offer.qualitaet": "الجودة",
  "offer.openMaps": "افتح الخريطة",
  "offer.observe": "القبول يتم داخل تطبيق أوبر.\nReidey يراقب فقط.",
  "offer.rider": "الراكب",
  "offer.eta": "المدة",
  "offer.received": "استُلم",
  "offer.requested": "طُلب",
  "offer.acceptWindow": "نافذة القبول",
  "offer.duration": "مدة الرحلة", "offer.minShort": "دقيقة", "offer.secShort": "ثانية", "offer.hrShort": "ساعة",
  "offer.qualityHint": "€€ هو تقييم جودة السعر لكل كم، وليس سعراً ثانياً.",
  "offer.noGeo": "تظهر المسافة والسعر لكل كم بعد ترميز الرحلة جغرافياً.",
  "profile.verdienstToday": "أرباح اليوم",
  "profile.vsYesterday": "عن أمس",
  "profile.accepted": "{n} مقبول",
  "profile.declined": "{n} مرفوض",
  "profile.konto": "الحساب",
  "profile.notifications": "الإشعارات",
  "profile.pushNew": "إشعارات العروض الجديدة",
  "profile.pushNewSub": "مسموح · أولوية عالية",
  "signin.subtitle": "سجّل الدخول ببيانات أسطولك",
  "update.title": "التحديث مطلوب",
  "update.body": "يتوفّر إصدار أحدث من التطبيق. الرجاء التحديث للمتابعة.",
  "update.button": "حدّث الآن",
  "signin.forgot": "نسيت كلمة المرور؟",
  "signin.forgotHint": "تواصل مع أسطولك لإعادة تعيين كلمة المرور. الوصول يُدار عبر دعوة شركتك.",
  "signin.inviteNote": "الوصول يكون عبر دعوة من أسطولك.",
  "settings.title": "الإعدادات",
  "settings.logout": "خروج",
  "settings.language": "اللغة",
  "settings.profile": "الملف الشخصي",
  "settings.name": "الاسم",
  "settings.newPassword": "كلمة مرور جديدة (اختياري)",
  "settings.save": "حفظ",
  "settings.saved": "تم الحفظ",
  "settings.saveError": "تعذّر الحفظ",
  "common.seconds": "ث",
  // Tabs
  "tabs.home": "الرئيسية",
  "tabs.offers": "العروض",
  "tabs.profile": "البروفايل",
  "tabs.statistics": "الإحصائيات", "stats.title": "الإحصائيات", "stats.totalIncome": "إجمالي الدخل", "stats.avgPerKm": "متوسط €/كم",
  // Home
  "home.greeting": "مرحباً",
  "home.online": "متصل",
  "home.offline": "غير متصل",
  "home.engagement.0": "متفرّغ",
  "home.engagement.1": "في الطريق",
  "home.engagement.2": "في رحلة",
  "home.today": "اليوم",
  "home.activeOffer": "العرض الحالي",
  "home.recent": "أحدث العروض",
  "home.week": "هذا الأسبوع",
  "home.empty": "لا عروض اليوم بعد",
  // Stat cards
  "stat.offers": "العروض",
  "stat.accepted": "المقبولة",
  "stat.acceptanceRate": "نسبة القبول",
  "stat.earnings": "الأرباح",
  "stat.km": "كم",
  "stat.completed": "المكتملة",
  "stat.declined": "المرفوضة",
  // Offers filters
  "offers.search": "بحث",
  "offers.from": "من",
  "offers.to": "إلى",
  "offers.loadMore": "تحميل المزيد",
  "filter.all": "الكل",
  // Profile
  "profile.stats": "الإحصائيات",
  "profile.settings": "الإعدادات",
  "profile.company": "الشركة", "profile.email": "البريد الإلكتروني", "profile.verified": "موثّق", "profile.personalInfo": "المعلومات الشخصية", "profile.support": "الدعم", "profile.logout": "تسجيل الخروج", "profile.appName": "REIDEY Driver", "settings.preferences": "التفضيلات", "settings.offerNotifications": "إشعارات العروض", "settings.sound": "الصوت", "settings.haptic": "الاهتزاز", "settings.account": "الحساب", "settings.personalInfo": "المعلومات الشخصية", "settings.security": "الأمان", "settings.support": "الدعم", "settings.helpCenter": "مركز المساعدة", "settings.contactSupport": "تواصل مع الدعم", "splash.caption": "نربط السائقين", "language.choose": "اختر لغتك", "language.subtitle": "يمكنك تغيير هذا لاحقاً من الإعدادات.", "language.continue": "متابعة",
  "range.today": "اليوم",
  "range.7d": "7 أيام",
  "range.30d": "30 يوم",
  // Fleet-owner mode
  "home.fleetTitle": "الأسطول",
  "fleet.driver": "السائق",
  "fleet.onlineDrivers": "سائق متصل",
  "fleet.activeNow": "الرحلات النشطة",
};

const DICTS: Record<string, Dict> = { de, en, ar };

let current = (getLocales()[0]?.languageCode ?? "de").toLowerCase();
if (!DICTS[current]) current = "de";

/**
 * Direction is handled MANUALLY per-component via `isRTL()` (flexDirection,
 * textAlign, writingDirection, side spacing, chevrons). Native RTL is kept OFF
 * so the base layout is always LTR: this avoids double-flipping (native reversing
 * `row` on top of our manual `row-reverse`) and lets a runtime language switch
 * apply instantly through the listeners below, with no app reload.
 */
export function applyDirection(_code: string) {
  I18nManager.allowRTL(false);
  if (I18nManager.isRTL) {
    I18nManager.forceRTL(false);
  }
}

applyDirection(current);

const listeners = new Set<() => void>();

export function setLocale(code: string) {
  if (DICTS[code] && code !== current) {
    current = code;
    applyDirection(code);
    listeners.forEach((fn) => fn());
  }
}

export function getLocale(): string {
  return current;
}

/** Re-render a component whenever the app language changes (keeps tab labels etc. in sync). */
export function useLocale(): string {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

export function isRTL(): boolean {
  return current === "ar";
}

export function t(key: string): string {
  return DICTS[current]?.[key] ?? DICTS.de[key] ?? key;
}
