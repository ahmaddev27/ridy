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
  | "no_session";

export type UberLoginStatus = {
  state: UberLoginState;
  mode: "manual";
  channel: string | null;
  expires_at: string | null;
  failure?: UberLoginFailure;
  /** Set when the last code was rejected but the login is still open. */
  retry?: boolean;
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
