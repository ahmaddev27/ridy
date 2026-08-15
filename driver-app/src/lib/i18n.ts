import { getLocales } from "expo-localization";
import { I18nManager } from "react-native";

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
  "status.pending": "Ausstehend",
  "status.accepted": "Angenommen",
  "status.started": "Läuft",
  "status.completed": "Abgeschlossen",
  "status.rejected": "Abgelehnt",
  "status.canceled": "Storniert",
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
  "status.pending": "Pending",
  "status.accepted": "Accepted",
  "status.started": "In progress",
  "status.completed": "Completed",
  "status.rejected": "Rejected",
  "status.canceled": "Canceled",
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
  "status.pending": "معلّق",
  "status.accepted": "مقبول",
  "status.started": "جارية",
  "status.completed": "مكتمل",
  "status.rejected": "غير مقبول",
  "status.canceled": "ملغى",
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
};

const DICTS: Record<string, Dict> = { de, en, ar };

let current = (getLocales()[0]?.languageCode ?? "de").toLowerCase();
if (!DICTS[current]) current = "de";

/** Keep the native layout direction in sync with the chosen language. RTL flips
 *  flexbox + text alignment app-wide (a full reload applies it everywhere). */
export function applyDirection(code: string) {
  const rtl = code === "ar";
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== rtl) {
    I18nManager.forceRTL(rtl);
  }
}

applyDirection(current);

export function setLocale(code: string) {
  if (DICTS[code]) {
    current = code;
    applyDirection(code);
  }
}

export function getLocale(): string {
  return current;
}

export function isRTL(): boolean {
  return current === "ar";
}

export function t(key: string): string {
  return DICTS[current]?.[key] ?? DICTS.de[key] ?? key;
}
