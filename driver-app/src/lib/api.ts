import Constants from "expo-constants";
import { Sentry } from "@/lib/sentry";

const BASE = (Constants.expoConfig?.extra?.apiUrl as string) ?? "https://reidey.de";

/** Human phone model + OS version, captured via expo-device on push registration. */
export type DeviceInfo = { name?: string | null; osVersion?: string | null };

/** Snake-case body fields for the device-register endpoints, omitting empty values. */
function devicePayload(device?: DeviceInfo): Record<string, string> {
  const payload: Record<string, string> = {};
  if (device?.name) payload.device_name = device.name;
  if (device?.osVersion) payload.os_version = device.osVersion;
  return payload;
}

/**
 * One thing a driver sent their own company to review in El-Professor: a
 * receipt with its photo, or a note. Fetched FROM here by El-Professor — see
 * the backend's `RingElProfessor` for why it is a fetch and not a push.
 */
export type DriverSubmission = {
  id: string;
  subject: "receipt" | "note";
  /** pending → taken → accepted | rejected. */
  status: string;
  /** The company's own words when it rejected. Null otherwise. */
  reason: string | null;
  created_at: string | null;
};

/** Everything a receipt carries. The photo is separate: it is a file. */
export type ReceiptDraft = {
  receipt_date: string;
  /** A plain decimal with a dot, at most two places, and nothing else. The
   *  other side reads `1.234` as 1.23 and answers 0 for what it cannot read,
   *  and this figure reaches the driver's own balance. */
  amount: string;
  category: string | null;
  description: string | null;
  payment_method: "bar" | "uberweisung";
  postal_code: string | null;
};

export type NoteDraft = {
  note_type: string;
  note_text: string;
  start_date?: string | null;
  end_date?: string | null;
  is_full_day?: boolean;
  start_time?: string | null;
  end_time?: string | null;
};

/** A photo picked or taken, as React Native's fetch wants it in a FormData. */
export type PickedPhoto = { uri: string; name: string; type: string };

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
  /** Resolved station name (e.g. "Solingen Hbf") when the endpoint is a street-less
   *  station/area — Uber sends only "PLZ City" for these. Shown above the raw address. */
  pickup_station_name?: string | null;
  dropoff_address: string | null;
  dropoff_station_name?: string | null;
  fare_formatted: string | null;
  fare_amount: number | null;
  distance_m: number | null;
  /** Resolved coordinates — used to open the maps route BY COORDINATE (exact pin)
   *  instead of re-geocoding an imprecise address text. */
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  /** 'uber' = coordinates are Uber's exact live-map waypoints (post-accept). */
  geo_source?: string | null;
  /** Number of drop-offs once resolved from Uber's map (>= 2 = multi-stop). */
  stops_count?: number | null;
  /** Ordered stops (pickup first, then each drop-off) with per-leg road distance. */
  stops?: { address: string | null; lat?: number | null; lng?: number | null; leg_m: number | null; cumulative_m?: number | null }[] | null;
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
  /** Who is online (busiest first). Absent on backends older than 2026-09-27. */
  online_drivers_list?: FleetOnlineDriver[];
  today: DriverStats;
  active_offers: Offer[];
  recent: Offer[];
};

/** An online driver on the owner home: 0 = available, 1 = en route, 2 = on trip. */
export type FleetOnlineDriver = { id: number; name: string; engagement: 0 | 1 | 2 };

/** One fleet-day's income (SUM of completed fares), keyed by its 04:00 date. */
export type DailyIncome = { date: string; income: number };

/** Aggregate counters returned by the home + stats endpoints. */
export type DriverStats = {
  total: number;
  accepted: number;
  declined: number;
  completed: number;
  acceptance_rate: number;
  earnings: number;
  km: number;
  /** Per-fleet-day income for the requested window; present on the stats endpoints. */
  daily?: DailyIncome[];
};

export type HomeData = {
  driver: { name: string; online: boolean; engagement: 0 | 1 | 2 };
  today: DriverStats;
  active_offer: Offer | null;
  /** Newest still-open offer inside its accept window (newer backends only;
   *  older ones omit it and the app falls back to `recent`). */
  pending_offer?: Offer | null;
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

/** Default request budget. A stalled request (flaky mobile network) must fail
 *  fast enough that session restore falls through to the offline screen and a
 *  poller can try again, instead of hanging forever. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Request options: plain fetch init plus an optional per-call timeout. */
export type RequestOptions = RequestInit & { timeoutMs?: number };

/** Body the backend sends when the company is blocked (403 account_suspended). */
export type SessionInvalidBody = {
  message?: string;
  reason?: string | null;
  support_email?: string | null;
  support_whatsapp?: string | null;
};

/** A path must never climb out of the API tree (a crafted deep-link id like
 *  "..%2F.." would otherwise reach an arbitrary authenticated endpoint). */
function isSafePath(path: string): boolean {
  const pathname = path.split("?")[0];
  return !/(^|\/)\.\.?(\/|$)/.test(pathname) && !/%2e|%2f|%5c/i.test(pathname);
}

/** Numeric route ids only — anything else is treated as "not found". */
function offerPath(prefix: string, id: string | number): string {
  const raw = String(id);
  if (!/^\d+$/.test(raw)) throw new ApiError(404, "not_found", null);
  return `${prefix}/${encodeURIComponent(raw)}`;
}

/** Thin fetch wrapper: JSON in/out, bearer token, unwraps the `{data}` envelope. */
export class ApiClient {
  /** Called when the company's subscription lapsed (403) or the token is dead (401).
   *  Receives the response body so a suspension can show its reason + support. */
  onSessionInvalid: ((body: SessionInvalidBody) => void) | null = null;

  /** Whether the signed-in identity is a fleet owner (User token) vs a driver.
   *  Used so a 401 from a driver-only endpoint — which an owner hits by design
   *  if a screen mis-routes for a frame — never ends the owner's valid session. */
  private owner = false;

  constructor(private token: string | null = null) {}

  /** The current bearer token (for the WebSocket auth handshake). */
  getToken(): string | null {
    return this.token;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  setOwner(owner: boolean) {
    this.owner = owner;
  }

  /**
   * A multipart POST, for the one endpoint that carries a file.
   *
   * It cannot go through `request()`: that sets `Content-Type:
   * application/json` on every call, and a multipart body needs the runtime to
   * set the header WITH its boundary. Overriding the key with `undefined`
   * does not remove it — React Native sends the string "undefined" and the
   * server reads an empty request. So the header is simply never set here.
   *
   * Everything else `request()` does that matters — the bearer, the timeout,
   * the 401 handling — is reused by delegating to it with a FormData body and
   * a marker that suppresses the JSON header.
   */
  private form<T>(path: string, body: FormData, timeoutMs?: number): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: body as unknown as BodyInit,
      // Read by `request()`: an empty value deletes the inherited header.
      headers: { "Content-Type": "" },
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!isSafePath(path)) throw new ApiError(400, "invalid_path", null);

    // Capture the token AT SEND TIME. Re-reading this.token when the 401 response
    // arrives is a race: a request sent with NO token (a tab that loaded a frame
    // before restore() set it) would be judged "authenticated" if restore set the
    // token in the meantime, and would then tear down the freshly-restored
    // session — the recurring logout on app reopen.
    const sentToken = this.token;
    const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const callerSignal = init.signal ?? null;
    const onCallerAbort = () => controller.abort();
    callerSignal?.addEventListener("abort", onCallerAbort);

    let res: Response;
    let text: string;
    try {
      res = await fetch(BASE + path, {
        ...init,
        signal: controller.signal,
        // An EMPTY Content-Type from the caller means "do not send one": a
        // multipart body needs the runtime to set the header with its own
        // boundary, and a header set to the string "undefined" produces an
        // empty request on the server with no message anywhere.
        headers: Object.fromEntries(
          Object.entries({
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(sentToken ? { Authorization: `Bearer ${sentToken}` } : {}),
            ...(init.headers ?? {}),
          }).filter(([, v]) => v !== ""),
        ),
      });
      // The body read can stall too, so it stays inside the timed section.
      text = await res.text();
    } catch {
      // No HTTP answer at all (offline, DNS, timeout, aborted): a network error,
      // never a 401 — so it can't end the session, and restore() shows offline.
      throw new ApiError(0, controller.signal.aborted ? "timeout" : "network", null);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }

    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    const body = (parsed && typeof parsed === "object" ? parsed : {}) as SessionInvalidBody;

    if (!res.ok) {
      // A driver-only endpoint (/driver/* but not /driver/fleet/*) always 401s for
      // an owner's User token. That's a mis-routed call, NOT a dead session, so it
      // must never log the owner out — otherwise tapping a notification (which can
      // briefly hit a driver screen before the identity settles) signs them out.
      const driverOnly = path.startsWith("/api/v1/driver/") && !path.startsWith("/api/v1/driver/fleet/");
      // Only a request that carried the CURRENT token can invalidate the session:
      // a 401 with no token raced ahead of session restore, and a late 401 for a
      // token that was already replaced (re-login) is stale.
      const authenticated = sentToken !== null && sentToken === this.token;
      const sessionDead =
        authenticated &&
        ((res.status === 403 && body.message === "account_suspended") ||
          (res.status === 401 && !(this.owner && driverOnly)));
      if (sessionDead) {
        // Diagnostic: which request forced the sign-out. The path is logged
        // WITHOUT its query string — that can carry a free-text search term.
        Sentry.captureMessage("session_invalidated", {
          level: "warning",
          tags: { status: String(res.status), owner: String(this.owner) },
          extra: { path: path.split("?")[0], message: body.message ?? null },
        });
        this.onSessionInvalid?.(body);
      }
      throw new ApiError(res.status, typeof body.message === "string" ? body.message : "request_failed", parsed);
    }

    // A 2xx whose body isn't a JSON object (captive portal, proxy error page)
    // must never be handed to callers as if it were data.
    if (!parsed || typeof parsed !== "object") throw new ApiError(res.status, "invalid_response", null);
    return parsed as T;
  }

  /** Launch-time force-update gate. Resolves null when the check failed, so the
   *  caller can keep an already-shown gate instead of silently dropping it. */
  async appVersion(platform: "android" | "ios", version: string): Promise<AppVersionInfo | null> {
    try {
      const r = await this.request<{ data: AppVersionInfo }>(
        `/api/v1/app/version?platform=${platform}&version=${encodeURIComponent(version)}`,
        { timeoutMs: 10_000 },
      );
      return r.data ?? null;
    } catch {
      return null;
    }
  }

  /** Passwordless sign-in step 1: email a one-time code (always 200, no enumeration). */
  loginRequest(email: string) {
    return this.request<{ data: { sent: boolean } }>("/api/v1/driver/login/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  /**
   * Passwordless sign-in step 2: exchange the code for a token. The response
   * branches on `is_owner`: a driver carries `driver`, a fleet owner/manager
   * carries `owner` (same profile shape).
   */
  loginVerify(email: string, otp: string) {
    return this.request<{
      data: { token: string; is_owner: boolean; driver?: DriverProfile; owner?: DriverProfile };
    }>("/api/v1/driver/login/verify", {
      method: "POST",
      body: JSON.stringify({ email, otp }),
    });
  }

  me() {
    return this.request<{ data: DriverProfile }>("/api/v1/driver/me");
  }

  /** What this driver has sent their company, newest first, with the decision. */
  submissions() {
    return this.request<{ data: DriverSubmission[] }>("/api/v1/driver/submissions");
  }

  /**
   * Send a receipt with its photo.
   *
   * The photo is mandatory and the company cannot accept the receipt without
   * it, so this refuses the same thing the other side would — the driver finds
   * out now rather than from a rejection days later.
   *
   * A longer timeout than the default: this is the one request that carries a
   * file over a phone's connection.
   */
  submitReceipt(draft: ReceiptDraft, photo: PickedPhoto) {
    const body = new FormData();
    body.append("subject", "receipt");
    body.append("receipt_date", draft.receipt_date);
    body.append("amount", draft.amount);
    body.append("payment_method", draft.payment_method);
    if (draft.category) body.append("category", draft.category);
    if (draft.description) body.append("description", draft.description);
    if (draft.postal_code) body.append("postal_code", draft.postal_code);
    body.append("document", photo as unknown as Blob);
    return this.form<{ data: DriverSubmission }>("/api/v1/driver/submissions", body, 60_000);
  }

  /** Send a note. No photo, so it goes as plain JSON like everything else. */
  submitNote(draft: NoteDraft) {
    return this.request<{ data: DriverSubmission }>("/api/v1/driver/submissions", {
      method: "POST",
      body: JSON.stringify({ subject: "note", ...draft }),
    });
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
  fleetRegisterDevice(token: string, platform: "android" | "ios", device?: DeviceInfo) {
    return this.request<{ data: { id: number } }>("/api/v1/driver/fleet/devices", {
      method: "POST",
      body: JSON.stringify({ token, platform, ...devicePayload(device) }),
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

  /** One fleet offer by id (owner mode) — resolves offers off list page 1. */
  fleetOffer(id: string | number) {
    return this.request<{ data: Offer }>(offerPath("/api/v1/driver/fleet/offers", id));
  }

  updateProfile(patch: { name?: string; locale?: string }) {
    return this.request<{ data: DriverProfile }>("/api/v1/driver/me", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  /** Owner profile update on the User token — the driver /me PATCH would 401. */
  fleetUpdateProfile(patch: { name?: string; locale?: string }) {
    return this.request<{ data: DriverProfile }>("/api/v1/driver/fleet/me", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  logout() {
    return this.request<{ message: string }>("/api/v1/driver/logout", { method: "POST", timeoutMs: 8_000 });
  }

  /** Owner logout on the User token — the driver /logout route is auth:driver
   *  and would 401 an owner, leaving their token valid server-side. */
  fleetLogout() {
    return this.request<{ message: string }>("/api/v1/driver/fleet/logout", { method: "POST", timeoutMs: 8_000 });
  }

  /** Ask for this driver account to be deleted (App Store / Play / DSGVO Art. 17).
   *  The server revokes every session and push device and notifies the fleet. */
  requestAccountDeletion() {
    return this.request<{ data: { requested: boolean } }>("/api/v1/driver/account/deletion-request", { method: "POST" });
  }

  /** Owner-mode account deletion request (User token). */
  fleetRequestAccountDeletion() {
    return this.request<{ data: { requested: boolean } }>("/api/v1/driver/fleet/account/deletion-request", {
      method: "POST",
    });
  }

  registerDevice(token: string, platform: "android" | "ios", device?: DeviceInfo) {
    return this.request<{ data: { id: number } }>("/api/v1/driver/devices", {
      method: "POST",
      body: JSON.stringify({ token, platform, ...devicePayload(device) }),
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

  /** One offer by id — the detail screen resolves an offer directly instead of
   *  scanning list page 1 (which falsely reads as "expired" off that page). */
  offer(id: string | number) {
    return this.request<{ data: Offer }>(offerPath("/api/v1/driver/offers", id));
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
  }

  /** True when no HTTP answer arrived (offline, DNS failure, timeout). */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export const api = new ApiClient();
