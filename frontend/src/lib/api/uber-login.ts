import { apiFetch } from "./client";

export type UberLoginResult = {
  status: "success" | "mfa_required" | "passkey_unsupported" | "bad_credentials" | "error";
  login_id?: string | null;
  org_uuid?: string;
  retry?: boolean;
  message?: string | null;
};

export async function startUberLogin(email: string, password: string): Promise<UberLoginResult> {
  return apiFetch<UberLoginResult>("/api/v1/uber-login/start", {
    method: "POST",
    body: { email, password },
    withCsrf: true,
  });
}

export async function submitUberMfa(loginId: string, code: string): Promise<UberLoginResult> {
  return apiFetch<UberLoginResult>("/api/v1/uber-login/mfa", {
    method: "POST",
    body: { login_id: loginId, code },
    withCsrf: true,
  });
}
