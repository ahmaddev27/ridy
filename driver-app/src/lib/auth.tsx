import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { api, ApiError, type DriverProfile } from "./api";
import { unregisterForPush } from "./push";

const TOKEN_KEY = "reidey_driver_token";
const OWNER_KEY = "reidey_is_owner";

type AuthState = {
  ready: boolean;
  driver: DriverProfile | null;
  /** True when the signed-in account is a company owner/manager (read-only fleet monitor). */
  isOwner: boolean;
  /** True when a stored session exists but the server is unreachable (offline). */
  offline: boolean;
  /** Retry restoring the session (used by the offline screen). */
  retry: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  activate: (inviteToken: string, password: string) => Promise<void>;
  updateProfile: (patch: { name?: string; locale?: string; password?: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [offline, setOffline] = useState(false);

  // Derive owner-ness from the profile itself — a SEPARATE isOwner state could
  // lag one render behind `driver` right after login, and in that window an
  // owner would hit a driver-only endpoint (api.home) → 401 → instant logout.
  // Sourcing it from the same object makes the two always consistent.
  const isOwner = driver?.is_owner === true;

  // Restore a stored session. Distinguishes three outcomes:
  //  - success            → profile applied, into the app
  //  - 401 (dead token)    → session cleared, to the login screen
  //  - network / 5xx error → KEEP the token and flag offline, so we show a
  //    "check your connection" screen instead of logging the user out.
  const restore = useCallback(async () => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const owner = (await SecureStore.getItemAsync(OWNER_KEY)) === "1";
    if (!token) {
      setReady(true);

      return;
    }
    // Assert the owner flag on the api client BEFORE the token, so the very first
    // request after a cold start / JS reload is classified correctly. Otherwise a
    // driver-only endpoint hit before applyProfile runs (a screen restored from
    // deep state) would 401 with api.owner still false and sign the owner out.
    api.setOwner(owner);
    api.setToken(token);
    try {
      const me = owner ? await api.fleetMe() : await api.me();
      applyProfile(me.data, owner);
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        await SecureStore.deleteItemAsync(OWNER_KEY);
        api.setToken(null); api.setOwner(false);
        setOffline(false);
      } else {
        // Server unreachable (no internet / timeout / 5xx): keep the session and
        // surface the offline screen; a retry re-runs this.
        setOffline(true);
      }
    } finally {
      setReady(true);
    }
  }, []);

  // Restore a stored session on launch.
  useEffect(() => {
    // A suspended company / dead token ends the session anywhere in the app.
    api.onSessionInvalid = () => {
      SecureStore.deleteItemAsync(TOKEN_KEY);
      SecureStore.deleteItemAsync(OWNER_KEY);
      api.setToken(null); api.setOwner(false);
      setDriver(null);
      setOffline(false);
    };

    restore();
  }, [restore]);

  const retry = useCallback(async () => {
    await restore();
  }, [restore]);

  function applyProfile(d: DriverProfile, owner: boolean) {
    // Do NOT override the language from the server profile: the user's in-app
    // choice (persisted locally and applied before first paint) is the source of
    // truth. Otherwise every launch reset the language to the profile's locale,
    // reverting a manual switch (e.g. back to Arabic).
    // Stamp the authoritative owner flag (from the login response / OWNER_KEY)
    // onto the profile, so the derived isOwner is correct even if the server
    // profile ever omitted the field. driver + isOwner now update atomically.
    setDriver({ ...d, is_owner: owner });
    // Tell the api client the identity so a 401 from a driver-only endpoint
    // never logs an owner out (their User session is still valid).
    api.setOwner(owner);
  }

  async function persist(token: string, d: DriverProfile, owner: boolean) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(OWNER_KEY, owner ? "1" : "0");
    api.setToken(token);
    applyProfile(d, owner);
  }

  async function login(email: string, password: string) {
    const res = await api.login(email, password);
    const owner = res.data.is_owner === true;
    const profile = (owner ? res.data.owner : res.data.driver) as DriverProfile;
    await persist(res.data.token, profile, owner);
  }

  async function activate(inviteToken: string, password: string) {
    const res = await api.activate(inviteToken, password);
    await persist(res.data.token, res.data.driver, false);
  }

  async function updateProfile(patch: { name?: string; locale?: string; password?: string }) {
    // Owners update on their User token via the fleet endpoint; the driver /me
    // PATCH (auth:driver) would 401 an owner and bounce them to login.
    const res = await (isOwner ? api.fleetUpdateProfile(patch) : api.updateProfile(patch));
    applyProfile(res.data, isOwner);
  }

  async function logout() {
    // Deregister this device FIRST (while the token is still valid) so it stops
    // receiving push — otherwise a signed-out phone (or one that later signs in
    // as a driver) would keep getting the owner's tenant-wide offer fan-out.
    await unregisterForPush(isOwner);
    try {
      // Owners revoke on their User token via the fleet route; the driver
      // /logout (auth:driver) would 401 an owner and leave the token valid.
      await (isOwner ? api.fleetLogout() : api.logout());
    } catch {
      /* best-effort */
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(OWNER_KEY);
    api.setToken(null); api.setOwner(false);
    setDriver(null);
  }

  return (
    <AuthContext.Provider value={{ ready, driver, isOwner, offline, retry, login, activate, updateProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
