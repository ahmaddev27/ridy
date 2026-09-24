import { ApiError } from "./client";

/**
 * Turn an API error into a user-facing, localized string. OTP/validation errors
 * arrive as stable codes (e.g. `otp_incorrect`) which map to `errors.*` i18n
 * keys; anything unmapped falls back to a generic localized message.
 *
 * @param t the i18n translate function from useI18n()
 */
export function apiErrorMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError && err.errors) {
    const first = Object.values(err.errors).flat()[0];
    if (first) return localizeCode(first, t);
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
  return err instanceof Error ? localizeCode(err.message, t) : t("errors.generic");
}

/** Map a known error code to its localized text; pass through real sentences. */
function localizeCode(codeOrMessage: string, t: (key: string) => string): string {
  const known = [
    "otp_incorrect", "otp_expired", "otp_too_many", "otp_none",
    "activation_expired", "activation_no_company",
  ];
  if (known.includes(codeOrMessage)) return t(`errors.${codeOrMessage}`);
  return codeOrMessage;
}
