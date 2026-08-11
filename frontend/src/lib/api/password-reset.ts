import { apiFetch } from "./client";

/** Step 1 — request a reset code (always succeeds, even for unknown emails). */
export async function forgotPassword(email: string): Promise<void> {
  await apiFetch("/api/v1/password/forgot", {
    method: "POST",
    body: { email },
    withCsrf: true,
  });
}

/** Step 2 — verify the code alone (no password change yet). */
export async function verifyResetCode(email: string, otp: string): Promise<void> {
  await apiFetch("/api/v1/password/verify", {
    method: "POST",
    body: { email, otp },
    withCsrf: true,
  });
}

/** Step 3 — re-check the code and set the new password. */
export async function resetPassword(
  email: string,
  otp: string,
  password: string,
  passwordConfirmation: string,
): Promise<void> {
  await apiFetch("/api/v1/password/reset", {
    method: "POST",
    body: { email, otp, password, password_confirmation: passwordConfirmation },
    withCsrf: true,
  });
}
