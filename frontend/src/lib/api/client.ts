import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// A hung request would block a poller's in-flight guard forever; reads give up
// after this long (writes/uploads/downloads are left unbounded on purpose).
const READ_TIMEOUT_MS = 30_000;

/** The browser's saved UI locale (German by default) for messages built outside React. */
function savedLocale(): Locale {
  let saved: string | null = null;
  try {
    saved = typeof localStorage !== "undefined" ? localStorage.getItem("locale") : null;
  } catch {
    /* storage blocked */
  }
  return saved === "de" || saved === "ar" || saved === "en" ? saved : "de";
}

/** A human, localized message for transport-level failures (5xx / network) so
 *  users never see a bare "Server Error". Domain messages (< 500 with a real
 *  message) are left untouched — callers map those, often via field errors. */
export function localizedErrorMessage(kind: "server" | "network" | "generic"): string {
  return dictionaries[savedLocale()].errors[kind];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: Record<string, string[]>,
    /** The full parsed error body — for endpoints that return extra fields. */
    public data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------------------------------------------------------------------------
// Auth events: a dead session (401/419) or a suspended company (403
// account_suspended) is broadcast once from here, so the AuthProvider can send
// the user to /login or the suspended screen instead of every poll failing
// silently behind a frozen dashboard.
// ---------------------------------------------------------------------------

export type AuthEventDetail =
  | { kind: "expired"; status: number }
  | { kind: "suspended"; data: Record<string, unknown> };

export const AUTH_EVENT = "reidey:auth";
export const authEvents: EventTarget =
  typeof EventTarget !== "undefined" ? new EventTarget() : ({} as EventTarget);

/** Classify a failed response for the auth listeners; null = not an auth failure. */
export function authEventFor(err: ApiError): AuthEventDetail | null {
  if (err.status === 401 || err.status === 419) return { kind: "expired", status: err.status };
  if (err.status === 403 && err.data?.message === "account_suspended") {
    return { kind: "suspended", data: err.data };
  }
  return null;
}

function emitAuthFailure(err: ApiError): void {
  const detail = authEventFor(err);
  if (!detail || typeof CustomEvent === "undefined" || typeof authEvents.dispatchEvent !== "function") return;
  authEvents.dispatchEvent(new CustomEvent<AuthEventDetail>(AUTH_EVENT, { detail }));
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[2]) : null;
}

let csrfPriming: Promise<void> | null = null;

/**
 * Prime the Sanctum CSRF cookie — only when it's missing (or `force`d after a
 * 419), and never twice concurrently. Laravel refreshes the XSRF-TOKEN cookie on
 * every stateful response, so a round-trip before each write is unnecessary.
 */
async function ensureCsrfCookie(force = false): Promise<void> {
  if (!force && readCookie("XSRF-TOKEN")) return;
  csrfPriming ??= fetch(`${API_URL}/sanctum/csrf-cookie`, { credentials: "include" })
    .then(() => undefined, () => undefined)
    .finally(() => {
      csrfPriming = null;
    });
  await csrfPriming;
}

function csrfHeaders(): Record<string, string> {
  const token = readCookie("XSRF-TOKEN");
  return token ? { "X-XSRF-TOKEN": token } : {};
}

/** fetch that turns a network failure into a localized ApiError, so every caller
 *  sees the same typed error shape (and a readable message) instead of a raw
 *  TypeError it would otherwise have to special-case. */
async function safeFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new ApiError(0, localizedErrorMessage("network"));
  }
}

/** Build a typed ApiError from a non-OK response, substituting a friendly
 *  message for opaque 5xx / "Server Error" bodies while keeping field errors. */
async function errorFromResponse(response: Response): Promise<ApiError> {
  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  const serverMsg = (payload as { message?: string }).message;
  const message =
    response.status >= 500 || !serverMsg || serverMsg === "Server Error"
      ? localizedErrorMessage("server")
      : serverMsg;

  return new ApiError(
    response.status,
    message,
    (payload as { errors?: Record<string, string[]> }).errors,
    payload as Record<string, unknown>,
  );
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Set for state-changing requests so the XSRF token is attached. */
  withCsrf?: boolean;
  /** Don't broadcast 401/419/403-suspended (login, logout and the /me probe
   *  handle those themselves). */
  skipAuthEvents?: boolean;
  /** Cancel the request (e.g. superseded by a newer filter). */
  signal?: AbortSignal;
};

function readSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") return signal;
  const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
  if (!signal) return timeout;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal;
}

/** Send a request, re-priming CSRF and retrying once on a 419 (rotated token). */
async function send(
  path: string,
  build: () => RequestInit,
  { withCsrf, skipAuthEvents }: { withCsrf: boolean; skipAuthEvents: boolean },
): Promise<Response> {
  if (withCsrf) await ensureCsrfCookie();
  let response = await safeFetch(`${API_URL}${path}`, build());
  if (response.status === 419 && withCsrf) {
    await ensureCsrfCookie(true);
    response = await safeFetch(`${API_URL}${path}`, build());
  }
  if (!response.ok) {
    const err = await errorFromResponse(response);
    if (!skipAuthEvents) emitAuthFailure(err);
    throw err;
  }
  return response;
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, withCsrf = false, skipAuthEvents = false, signal } = options;

  const response = await send(
    path,
    () => {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (withCsrf) Object.assign(headers, csrfHeaders());
      return {
        method,
        credentials: "include",
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: method === "GET" ? readSignal(signal) : signal,
      };
    },
    { withCsrf, skipAuthEvents },
  );

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** POST multipart form data (e.g. a file upload) with the CSRF token attached. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  // No Content-Type header: the browser sets the multipart boundary itself.
  const response = await send(
    path,
    () => ({
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", ...csrfHeaders() },
      body: form,
    }),
    { withCsrf: true, skipAuthEvents: false },
  );
  return (await response.json()) as T;
}

/** Fetch a response body as text (e.g. a server-rendered HTML preview). */
export async function apiText(path: string): Promise<string> {
  const response = await send(
    path,
    () => ({ credentials: "include", headers: { Accept: "text/html" } }),
    { withCsrf: false, skipAuthEvents: false },
  );
  return response.text();
}

/** Fetch a file (e.g. a CSV export) as a Blob, carrying the session cookie. */
export async function apiDownload(path: string): Promise<Blob> {
  const response = await send(path, () => ({ credentials: "include" }), {
    withCsrf: false,
    skipAuthEvents: false,
  });
  return response.blob();
}
