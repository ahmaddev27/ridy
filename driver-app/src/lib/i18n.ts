import { getLocales } from "expo-localization";

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
  "settings.title": "Einstellungen",
  "settings.logout": "Abmelden",
  "settings.language": "Sprache",
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
  "settings.title": "Settings",
  "settings.logout": "Log out",
  "settings.language": "Language",
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
  "settings.title": "الإعدادات",
  "settings.logout": "خروج",
  "settings.language": "اللغة",
  "common.seconds": "ث",
};

const DICTS: Record<string, Dict> = { de, en, ar };

let current = (getLocales()[0]?.languageCode ?? "de").toLowerCase();
if (!DICTS[current]) current = "de";

export function setLocale(code: string) {
  if (DICTS[code]) current = code;
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
