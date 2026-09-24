import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { api, ApiError, type DriverProfile, type SessionInvalidBody } from "./api";
import { revokeLocalPush, unregisterForPush } from "./push";
import { ensureFreshInstall } from "./install-guard";
import { getLocale } from "./i18n";
import { stopLive } from "./live";
import { Sentry } from "./sentry";

const TOKEN_KEY = "reidey_driver_token";
const OWNER_KEY = "reidey_is_owner";

/** Why the company is blocked, and how to reach support (403 account_suspended). */
export type SuspendedInfo = {
  reason: string | null;
  supportEmail: string | null;
  supportWhatsapp: string | null;
};

/** The suspension details carried by a 403 body, or null for any other body. */
export function suspendedFrom(body: unknown): SuspendedInfo | null {
  const b = (body && typeof body === "object" ? body : {}) as SessionInvalidBody;
  if (b.message !== "account_suspended") return null;
  return {
    reason: typeof b.reason === "string" ? b.reason : null,
    supportEmail: typeof b.support_email === "string" ? b.support_email : null,
    supportWhatsapp: typeof b.support_whatsapp === "string" ? b.support_whatsapp : null,
  };
}

type AuthState = {
  ready: boolean;
  driver: DriverProfile | null;
  /** True when the signed-in account is a company owner/manager (read-only fleet monitor). */
  isOwner: boolean;
  /** True when a stored session exists but the server is unreachable (offline). */
  offline: boolean;
  /** Set when the company is suspended — the app shows the suspension screen. */
  suspended: SuspendedInfo | null;
  /** Leave the suspension screen (back to login). */
  clearSuspended: () => void;
  /** Retry restoring the session (used by the offline screen). */
  retry: () => Promise<void>;
  /** Passwordless sign-in step 1: email a one-time code. */
  requestCode: (email: string) => Promise<void>;
  /** Passwordless sign-in step 2: verify the code and open the session. */
  verifyCode: (email: string, otp: string) => Promise<void>;
  updateProfile: (patch: { name?: string; locale?: string }) => Promise<void>;
  /** Request deletion of this account; the server revokes every session. */
  requestAccountDeletion: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/** Forget the stored session. Never throws — a keystore error must not block sign-out. */
async function clearStoredSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(OWNER_KEY).catch(() => {}),
  ]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [offline, setOffline] = useState(false);
  const [suspended, setSuspended] = useState<SuspendedInfo | null>(null);
  const loggingOut = useRef(false);

  // Derive owner-ness from the profile itself — a SEPARATE isOwner state could
  // lag one render behind `driver` right after login, and in that window an
  // owner would hit a driver-only endpoint (api.home) → 401 → instant logout.
  // Sourcing it from the same object makes the two always consistent.
  const isOwner = driver?.is_owner === true;

  const applyProfile = useCallback((d: DriverProfile, owner: boolean) => {
    // Do NOT override the language from the server profile: the user's in-app
    // choice (persisted locally and applied before first paint) is the source of
    // truth. Stamp the authoritative owner flag onto the profile so the derived
    // isOwner is correct even if the server profile ever omitted the field.
    setDriver({ ...d, is_owner: owner });
    // Tell the api client the identity so a 401 from a driver-only endpoint
    // never logs an owner out (their User session is still valid).
    api.setOwner(owner);
  }, []);

  /** The session is gone (401 / suspended): drop it everywhere, locally. */
  const endSession = useCallback(async (info: SuspendedInfo | null) => {
    await clearStoredSession();
    api.setToken(null);
    api.setOwner(false);
    setDriver(null);
    setOffline(false);
    if (info) setSuspended(info);
    stopLive();
    // The server can no longer be told (dead token) — invalidate at FCM instead.
    await revokeLocalPush();
  }, []);

  // Restore a stored session. Distinguishes the outcomes:
  //  - success                      → profile applied, into the app
  //  - 401 / 403 suspended          → session cleared (suspension screen for 403)
  //  - network / timeout / 5xx      → KEEP the token and flag offline, so we show
  //    a "check your connection" screen instead of logging the user out.
  const restore = useCallback(async () => {
    await ensureFreshInstall();

    let token: string | null;
    let owner: boolean;
    try {
      token = await SecureStore.getItemAsync(TOKEN_KEY);
      owner = (await SecureStore.getItemAsync(OWNER_KEY)) === "1";
    } catch (e) {
      // Unreadable keystore (OEM bug, restored backup): start clean on login.
      Sentry.captureException(e, { tags: { area: "session_restore" } });
      await clearStoredSession();
      api.setToken(null);
      api.setOwner(false);
      setDriver(null);
      setOffline(false);
      setReady(true);
      return;
    }

    if (!token) {
      setOffline(false);
      setReady(true);
      return;
    }
    // Assert the owner flag on the api client BEFORE the token, so the very first
    // request after a cold start / JS reload is classified correctly.
    api.setOwner(owner);
    api.setToken(token);
    try {
      const me = owner ? await api.fleetMe() : await api.me();
      if (!me?.data?.id) throw new ApiError(0, "invalid_profile", null);
      applyProfile(me.data, owner);
      setOffline(false);
      setSuspended(null);
    } catch (e) {
      const info = e instanceof ApiError && e.status === 403 ? suspendedFrom(e.body) : null;
      if (e instanceof ApiError && (e.status === 401 || info)) {
        await endSession(info);
      } else {
        // Server unreachable: keep the session and surface the offline screen.
        setOffline(true);
      }
    } finally {
      setReady(true);
    }
  }, [applyProfile, endSession]);

  // Restore a stored session on launch.
  useEffect(() => {
    // A suspended company / dead token ends the session anywhere in the app.
    api.onSessionInvalid = (body) => {
      void endSession(suspendedFrom(body));
    };
    restore().catch(() => setReady(true));
  }, [restore, endSession]);

  const retry = useCallback(async () => {
    await restore();
  }, [restore]);

  const clearSuspended = useCallback(() => setSuspended(null), []);

  async function persist(token: string, d: DriverProfile, owner: boolean) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(OWNER_KEY, owner ? "1" : "0");
    api.setToken(token);
    applyProfile(d, owner);
  }

  async function requestCode(email: string) {
    await api.loginRequest(email);
  }

  async function verifyCode(email: string, otp: string) {
    let res: Awaited<ReturnType<typeof api.loginVerify>>;
    try {
      res = await api.loginVerify(email, otp);
    } catch (e) {
      const info = e instanceof ApiError && e.status === 403 ? suspendedFrom(e.body) : null;
      if (info) setSuspended(info);
      throw e;
    }
    const owner = res.data?.is_owner === true;
    const profile = (owner ? res.data?.owner : res.data?.driver) as DriverProfile | undefined;
    if (!res.data?.token || !profile?.id) throw new ApiError(0, "invalid_response", null);
    await persist(res.data.token, profile, owner);
    setSuspended(null);

    // The language is usually picked BEFORE sign-in (onboarding), so the server
    // never heard of it — backfill it so emails/pushes use the same language.
    const locale = getLocale();
    if (profile.locale !== locale) {
      void (owner ? api.fleetUpdateProfile({ locale }) : api.updateProfile({ locale })).catch(() => {});
    }
  }

  async function updateProfile(patch: { name?: string; locale?: string }) {
    // Owners update on their User token via the fleet endpoint; the driver /me
    // PATCH (auth:driver) would 401 an owner and bounce them to login.
    const res = await (isOwner ? api.fleetUpdateProfile(patch) : api.updateProfile(patch));
    applyProfile(res.data, isOwner);
  }

  async function requestAccountDeletion() {
    await (isOwner ? api.fleetRequestAccountDeletion() : api.requestAccountDeletion());
    // The server already revoked the token and push devices — just clear locally.
    await endSession(null);
  }

  async function logout() {
    if (loggingOut.current) return;
    loggingOut.current = true;
    try {
      // Deregister this device FIRST (while the token is still valid) so it stops
      // receiving push. Both calls are time-limited, so sign-out never hangs.
      await unregisterForPush(isOwner);
      try {
        // Owners revoke on their User token via the fleet route; the driver
        // /logout (auth:driver) would 401 an owner and leave the token valid.
        await (isOwner ? api.fleetLogout() : api.logout());
      } catch {
        /* best-effort */
      }
      await clearStoredSession();
      api.setToken(null);
      api.setOwner(false);
      setDriver(null);
      stopLive();
      await revokeLocalPush();
    } finally {
      loggingOut.current = false;
    }
  }

  return (
    <AuthContext.Provider
      value={{
        ready,
        driver,
        isOwner,
        offline,
        suspended,
        clearSuspended,
        retry,
        requestCode,
        verifyCode,
        updateProfile,
        requestAccountDeletion,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
