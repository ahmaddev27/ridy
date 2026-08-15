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

  logout() {
    return this.request<{ message: string }>("/api/v1/driver/logout", { method: "POST" });
  }

  registerDevice(token: string, platform: "android" | "ios") {
    return this.request<{ data: { id: number } }>("/api/v1/driver/devices", {
      method: "POST",
      body: JSON.stringify({ token, platform }),
    });
  }

  offers() {
    return this.request<{ data: Offer[] }>("/api/v1/driver/offers");
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
  }
}

export const api = new ApiClient();
