import { apiFetch } from "./client";

/** Step 1 — request a reset code (always succeeds, even for unknown emails). */
export async function forgotPassword(email: string): Promise<void> {
  await apiFetch("/api/v1/password/forgot", {
    method: "POST",
    body: { email },
    withCsrf: true,
  });
}

/** Step 2 — verify the code and set a new password. */
export async function resetPassword(email: string, otp: string, password: string): Promise<void> {
  await apiFetch("/api/v1/password/reset", {
    method: "POST",
    body: { email, otp, password },
    withCsrf: true,
  });
}
