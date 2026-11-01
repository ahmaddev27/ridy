import { ApiError, apiFetch } from "./client";

/** What the backend reports for the company's current passwordless Uber login (docs/27). */
export type UberLoginState = "idle" | "starting" | "awaiting_code" | "submitting" | "connected" | "failed";

export type UberLoginFailure =
  | "passkey_unsupported"
  | "blocked"
  | "channel_unavailable"
  | "password_required"
  | "code_timeout"
  | "wrong_code"
  | "unavailable"
  | "session_active"
  | "no_session"
  | "no_proxy"
  | "capture_failed";

export type UberLoginStatus = {
  state: UberLoginState;
  mode: "manual" | "auto";
  channel: string | null;
  expires_at: string | null;
  failure?: UberLoginFailure;
  /** Set when the last code was rejected but the login is still open. */
  retry?: boolean;
  /** Uber or the sign-in service is still working (timeout): wait, do not start again. */
  pending?: boolean;
};

type Envelope = { data: UberLoginStatus };

/**
 * 409 (a healthy session is running) and 503 (service down) still carry the status
 * body — return it, so the page shows the specific failure instead of a toast.
 */
async function call(path: string, method: "GET" | "POST", body?: unknown): Promise<UberLoginStatus> {
  try {
    const res = await apiFetch<Envelope>(`/api/v1/uber-login/${path}`, { method, body, withCsrf: method !== "GET" });
    return res.data;
  } catch (e) {
    const carried = e instanceof ApiError ? (e.data as Partial<Envelope> | undefined)?.data : undefined;
    if (carried?.state) return carried;
    throw e;
  }
}

export const getUberLoginStatus = () => call("status", "GET");
export const startUberLogin = (email: string) => call("start", "POST", { email });
export const submitUberLoginCode = (code: string) => call("code", "POST", { code });
export const cancelUberLogin = () => call("cancel", "POST");

/** Variant B options (docs/27): automatic code from a forwarded email, automatic re-login. */
export type UberLoginSettings = {
  email: string | null;
  auto_code: boolean;
  auto_relogin: boolean;
  inbound_configured: boolean;
};

export async function getUberLoginSettings(): Promise<UberLoginSettings> {
  return (await apiFetch<{ data: UberLoginSettings }>("/api/v1/uber-login/settings")).data;
}

export async function updateUberLoginSettings(
  input: Partial<Pick<UberLoginSettings, "email" | "auto_code" | "auto_relogin">>,
): Promise<UberLoginSettings> {
  return (await apiFetch<{ data: UberLoginSettings }>("/api/v1/uber-login/settings", { method: "PUT", body: input, withCsrf: true })).data;
}

/** The secret forwarding address. Returned ONCE: only its hash is stored. */
export async function rotateUberInboundAddress(): Promise<string> {
  const res = await apiFetch<{ data: { inbound_address: string } }>("/api/v1/uber-login/inbound-address/rotate", {
    method: "POST",
    withCsrf: true,
  });
  return res.data.inbound_address;
}
