import { ApiError } from "./client";
import { formatMoney } from "@/lib/utils";

/**
 * Turn an API error into a user-facing, localized string. Backend errors arrive
 * as stable snake_case codes (e.g. `otp_incorrect`, `company_has_billing_records`)
 * which map to `errors.*` i18n keys; anything unmapped falls back to a generic
 * localized message or passes a real sentence through.
 *
 * @param t the i18n translate function from useI18n()
 * @param locale the UI locale, for amounts carried by the error (e.g. `remaining`)
 */
export function apiErrorMessage(err: unknown, t: (key: string) => string, locale = "de"): string {
  if (err instanceof ApiError && err.errors) {
    const first = Object.values(err.errors).flat()[0];
    if (first) return localizeCode(first, t, err.data, locale);
  }
  if (err instanceof ApiError && err.status === 0) {
    return t("errors.generic");
  }
  // Throttled (login/OTP/register limiters) and server failures get a localized
  // sentence — never a raw English server message.
  if (err instanceof ApiError && err.status === 429) {
    return t("errors.tooManyAttempts");
  }
  if (err instanceof ApiError && err.status >= 500) {
    return t("errors.server");
  }
  if (err instanceof ApiError) return localizeCode(err.message, t, err.data, locale);
  return err instanceof Error ? localizeCode(err.message, t) : t("errors.generic");
}

const ERROR_CODE = /^[a-z]+(_[a-z]+)+$/;

/** Map a known error code to its localized text (filling `{remaining}` from the
 *  error body); pass real sentences and unknown codes through unchanged. */
function localizeCode(
  codeOrMessage: string,
  t: (key: string) => string,
  data?: Record<string, unknown>,
  locale = "de",
): string {
  if (!ERROR_CODE.test(codeOrMessage)) return codeOrMessage;
  const key = `errors.${codeOrMessage}`;
  const text = t(key);
  if (text === key) return codeOrMessage; // no translation for this code
  const remaining = data?.remaining;
  return typeof remaining === "number" || typeof remaining === "string"
    ? text.replace("{remaining}", formatMoney(remaining, locale))
    : text;
}
