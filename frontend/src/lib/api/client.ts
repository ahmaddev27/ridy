import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** A human, localized message for transport-level failures (5xx / network) so
 *  users never see a bare "Server Error". Domain messages (< 500 with a real
 *  message) are left untouched — callers map those, often via field errors. */
function transportMessage(kind: "server" | "network"): string {
  const saved = typeof localStorage !== "undefined" ? localStorage.getItem("locale") : null;
  const locale: Locale = saved === "de" || saved === "ar" || saved === "en" ? saved : "de";
  return dictionaries[locale].errors[kind];
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

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[2]) : null;
}

/** Prime the Sanctum CSRF cookie before any state-changing request. */
async function ensureCsrfCookie(): Promise<void> {
  await fetch(`${API_URL}/sanctum/csrf-cookie`, { credentials: "include" });
}

/** fetch that turns a network failure into a localized ApiError, so every caller
 *  sees the same typed error shape (and a readable message) instead of a raw
 *  TypeError it would otherwise have to special-case. */
async function safeFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new ApiError(0, transportMessage("network"));
  }
}

/** Build a typed ApiError from a non-OK response, substituting a friendly
 *  message for opaque 5xx / "Server Error" bodies while keeping field errors. */
async function errorFromResponse(response: Response): Promise<ApiError> {
  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  const serverMsg = (payload as { message?: string }).message;
  const message =
    response.status >= 500 || !serverMsg || serverMsg === "Server Error"
      ? transportMessage("server")
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
};

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, withCsrf = false } = options;

  if (withCsrf) await ensureCsrfCookie();

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (withCsrf) {
    const token = readCookie("XSRF-TOKEN");
    if (token) headers["X-XSRF-TOKEN"] = token;
  }

  const response = await safeFetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) throw await errorFromResponse(response);

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** POST multipart form data (e.g. a file upload) with the CSRF token attached. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  await ensureCsrfCookie();
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = readCookie("XSRF-TOKEN");
  if (token) headers["X-XSRF-TOKEN"] = token;

  // No Content-Type header: the browser sets the multipart boundary itself.
  const response = await safeFetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers,
    body: form,
  });

  if (!response.ok) throw await errorFromResponse(response);
  return (await response.json()) as T;
}

/** Fetch a file (e.g. a CSV export) as a Blob, carrying the session cookie. */
export async function apiDownload(path: string): Promise<Blob> {
  const response = await safeFetch(`${API_URL}${path}`, { credentials: "include" });
  if (!response.ok) throw await errorFromResponse(response);
  return response.blob();
}
