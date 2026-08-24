import Constants from "expo-constants";

const BASE = (Constants.expoConfig?.extra?.apiUrl as string) ?? "https://reidey.de";

/** Result of the launch-time force-update check. */
export type AppVersionInfo = {
  update_required: boolean;
  min_supported: string | null;
  store_url: string | null;
};

export type Offer = {
  id: number;
  offer_uuid: string;
  status: string | null;
  /** Present in fleet-owner mode so a row can be attributed to its driver. */
  driver_name?: string | null;
  /** Rider's (first) name when the captured payload carried it. */
  rider_name?: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_formatted: string | null;
  fare_amount: number | null;
  distance_m: number | null;
  accept_window_seconds: number | null;
  trip_duration_seconds?: number | null;
  received_at: string | null;
  /** When Uber requested the trip, if distinct from when we received the offer. */
  requested_at?: string | null;
};

export type DriverProfile = {
  id: number;
  name: string;
  email: string | null;
  locale: string | null;
  company_name: string | null;
  uber_linked: boolean;
  /** True when the signed-in account is a company owner/manager (read-only monitor). */
  is_owner?: boolean;
};

/** Tenant-wide home for a fleet owner: every driver's offers, no personal trip. */
export type FleetHomeData = {
  owner: { name: string; company_name: string | null };
  online_drivers: number;
  today: DriverStats;
  active_offers: Offer[];
  recent: Offer[];
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
  /** Fleet-owner mode only: restrict the feed to a single driver. */
  driver_id?: number;
};

/** A tenant driver, for the fleet-owner offers picker. */
export type FleetDriver = { id: number; name: string };

export type PaginationMeta = {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
};

/** Thin fetch wrapper: JSON in/out, bearer token, unwraps the `{data}` envelope. */
export class ApiClient {
  /** Called when the company's subscription lapsed (403) or the token is dead (401). */
  onSessionInvalid: ((reason: string | null) => void) | null = null;

  /** Whether the signed-in identity is a fleet owner (User token) vs a driver.
   *  Used so a 401 from a driver-only endpoint — which an owner hits by design
   *  if a screen mis-routes for a frame — never ends the owner's valid session. */
  private owner = false;

  constructor(private token: string | null = null) {}

  setToken(token: string | null) {
    this.token = token;
  }

  setOwner(owner: boolean) {
    this.owner = owner;
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
      // A driver-only endpoint (/driver/* but not /driver/fleet/*) always 401s for
      // an owner's User token. That's a mis-routed call, NOT a dead session, so it
      // must never log the owner out — otherwise tapping a notification (which can
      // briefly hit a driver screen before the identity settles) signs them out.
      const driverOnly = path.startsWith("/api/v1/driver/") && !path.startsWith("/api/v1/driver/fleet/");
      // Only a request that actually carried a token can invalidate a session. A
      // 401 with no token set is a call that raced ahead of session restore (e.g.
      // a screen opened from a notification on cold start) — treating it as a dead
      // session would wipe the still-valid stored token before restore reads it.
      const authenticated = this.token !== null;
      const sessionDead =
        authenticated &&
        ((res.status === 403 && body?.message === "account_suspended") ||
          (res.status === 401 && !(this.owner && driverOnly)));
      if (sessionDead) {
        this.onSessionInvalid?.(body?.reason ?? null);
      }
      throw new ApiError(res.status, body?.message ?? "request_failed", body);
    }
    return body as T;
  }

  /** Launch-time force-update gate. Fails open (never blocks the app on error). */
  async appVersion(platform: "android" | "ios", version: string): Promise<AppVersionInfo> {
    try {
      const r = await this.request<{ data: AppVersionInfo }>(
        `/api/v1/app/version?platform=${platform}&version=${encodeURIComponent(version)}`,
      );
      return r.data;
    } catch {
      return { update_required: false, min_supported: null, store_url: null };
    }
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
    // The response branches on `is_owner`: a driver carries `driver`, a fleet
    // owner/manager carries `owner` (same profile shape).
    return this.request<{
      data: { token: string; is_owner: boolean; driver?: DriverProfile; owner?: DriverProfile };
    }>("/api/v1/driver/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  me() {
    return this.request<{ data: DriverProfile }>("/api/v1/driver/me");
  }

  fleetMe() {
    return this.request<{ data: DriverProfile }>("/api/v1/driver/fleet/me");
  }

  fleetHome() {
    return this.request<{ data: FleetHomeData }>("/api/v1/driver/fleet/home");
  }

  fleetDrivers() {
    return this.request<{ data: FleetDriver[] }>("/api/v1/driver/fleet/drivers");
  }

  /** Owner-mode push registration (User token) — mirrors registerDevice for drivers. */
  fleetRegisterDevice(token: string, platform: "android" | "ios") {
    return this.request<{ data: { id: number } }>("/api/v1/driver/fleet/devices", {
      method: "POST",
      body: JSON.stringify({ token, platform }),
    });
  }

  /** Deregister this device's push token (driver / owner) so it stops receiving offers. */
  deleteDevice(token: string) {
    return this.request<{ message: string }>("/api/v1/driver/devices", {
      method: "DELETE",
      body: JSON.stringify({ token }),
    });
  }

  fleetDeleteDevice(token: string) {
    return this.request<{ message: string }>("/api/v1/driver/fleet/devices", {
      method: "DELETE",
      body: JSON.stringify({ token }),
    });
  }

  fleetStats(from?: string, to?: string) {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.request<{ data: DriverStats }>(`/api/v1/driver/fleet/stats${suffix}`);
  }

  fleetOffers(params: OffersQuery = {}) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.request<{ data: Offer[]; meta: PaginationMeta }>(`/api/v1/driver/fleet/offers${suffix}`);
  }

  updateProfile(patch: { name?: string; locale?: string; password?: string }) {
    return this.request<{ data: DriverProfile }>("/api/v1/driver/me", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  /** Owner profile update on the User token — the driver /me PATCH would 401. */
  fleetUpdateProfile(patch: { name?: string; locale?: string; password?: string }) {
    return this.request<{ data: DriverProfile }>("/api/v1/driver/fleet/me", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  logout() {
    return this.request<{ message: string }>("/api/v1/driver/logout", { method: "POST" });
  }

  /** Owner logout on the User token — the driver /logout route is auth:driver
   *  and would 401 an owner, leaving their token valid server-side. */
  fleetLogout() {
    return this.request<{ message: string }>("/api/v1/driver/fleet/logout", { method: "POST" });
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
