const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      (payload as { message?: string }).message ?? response.statusText,
      (payload as { errors?: Record<string, string[]> }).errors,
      payload as Record<string, unknown>,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
