import Constants from "expo-constants";

const BASE = (Constants.expoConfig?.extra?.apiUrl as string) ?? "https://r.fleeteye.de";

export type Offer = {
  id: number;
  offer_uuid: string;
  status: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_formatted: string | null;
  fare_amount: number | null;
  distance_m: number | null;
  accept_window_seconds: number | null;
  received_at: string | null;
};

export type DriverProfile = {
  id: number;
  name: string;
  email: string | null;
  locale: string | null;
  company_name: string | null;
  uber_linked: boolean;
};

/** Aggregate counters returned by the home + stats endpoints. */
export type DriverStats = {
  total: number;
  accepted: number;
  declined: number;
  completed: number;
  acceptance_rate: number;
  earnings: number;
  km: number;
};

export type HomeData = {
  driver: { name: string; online: boolean; engagement: 0 | 1 | 2 };
  today: DriverStats;
  active_offer: Offer | null;
  recent: Offer[];
};

/** Filters accepted by the paginated offers list. */
export type OffersQuery = {
  status?: string;
  from?: string;
  to?: string;
  search?: string;
  per_page?: number;
  page?: number;
};

export type PaginationMeta = {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
};

/** Thin fetch wrapper: JSON in/out, bearer token, unwraps the `{data}` envelope. */
export class ApiClient {
  constructor(private token: string | null = null) {}

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(BASE + path, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(init.headers ?? {}),
      },
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, body?.message ?? "request_failed", body);
    }
    return body as T;
  }

  invitePreview(token: string) {
    return this.request<{ data: { driver_name: string; company_name: string | null } }>(
      `/api/v1/driver/invite/${encodeURIComponent(token)}`,
    );
  }

  activate(token: string, password: string) {
    return this.request<{ data: { token: string; driver: DriverProfile } }>("/api/v1/driver/activate", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
  }

  login(email: string, password: string) {
    return this.request<{ data: { token: string; driver: DriverProfile } }>("/api/v1/driver/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  me() {
    return this.request<{ data: DriverProfile }>("/api/v1/driver/me");
  }

  updateProfile(patch: { name?: string; locale?: string; password?: string }) {
    return this.request<{ data: DriverProfile }>("/api/v1/driver/me", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  logout() {
    return this.request<{ message: string }>("/api/v1/driver/logout", { method: "POST" });
  }

  registerDevice(token: string, platform: "android" | "ios") {
    return this.request<{ data: { id: number } }>("/api/v1/driver/devices", {
      method: "POST",
      body: JSON.stringify({ token, platform }),
    });
  }

  home() {
    return this.request<{ data: HomeData }>("/api/v1/driver/home");
  }

  stats(from?: string, to?: string) {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.request<{ data: DriverStats }>(`/api/v1/driver/stats${suffix}`);
  }

  offers(params: OffersQuery = {}) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.request<{ data: Offer[]; meta: PaginationMeta }>(`/api/v1/driver/offers${suffix}`);
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
  }
}

export const api = new ApiClient();
