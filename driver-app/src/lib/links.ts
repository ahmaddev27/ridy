import Constants from "expo-constants";

/** Public site the legal pages live on (same origin as the API). */
const SITE = ((Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? "https://reidey.de").replace(/\/+$/, "");

/** Datenschutzerklärung (DSGVO) — required in-app by Apple 5.1.1(i) / Play. */
export const PRIVACY_URL = `${SITE}/datenschutz`;
/** Impressum (DDG §5). */
export const IMPRINT_URL = `${SITE}/impressum`;

export const SUPPORT_EMAIL = "support@reidey.de";
