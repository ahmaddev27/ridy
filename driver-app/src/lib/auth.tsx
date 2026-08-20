import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { api, ApiError, type DriverProfile } from "./api";
import { setLocale } from "./i18n";

const TOKEN_KEY = "reidey_driver_token";
const OWNER_KEY = "reidey_is_owner";

type AuthState = {
  ready: boolean;
  driver: DriverProfile | null;
  /** True when the signed-in account is a company owner/manager (read-only fleet monitor). */
  isOwner: boolean;
  login: (email: string, password: string) => Promise<void>;
  activate: (inviteToken: string, password: string) => Promise<void>;
  updateProfile: (patch: { name?: string; locale?: string; password?: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  // Restore a stored session on launch.
  useEffect(() => {
    // A suspended company / dead token ends the session anywhere in the app.
    api.onSessionInvalid = () => {
      SecureStore.deleteItemAsync(TOKEN_KEY);
      SecureStore.deleteItemAsync(OWNER_KEY);
      api.setToken(null);
      setDriver(null);
      setIsOwner(false);
    };

    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const owner = (await SecureStore.getItemAsync(OWNER_KEY)) === "1";
      if (token) {
        api.setToken(token);
        try {
          // Owners resolve on the User token via the fleet endpoint.
          const me = owner ? await api.fleetMe() : await api.me();
          applyProfile(me.data, owner);
        } catch (e) {
          // Only a genuine auth failure (401) ends the session. A transient
          // network / 5xx error must KEEP the stored token so a later launch can
          // restore the session — otherwise a flaky connection at boot silently
          // logs the user (notably a fleet owner) out. A 401 is already handled by
          // onSessionInvalid; clear here too so this boot doesn't restore a dead one.
          if (e instanceof ApiError && e.status === 401) {
            await SecureStore.deleteItemAsync(TOKEN_KEY);
            await SecureStore.deleteItemAsync(OWNER_KEY);
            api.setToken(null);
          }
        }
      }
      setReady(true);
    })();
  }, []);

  function applyProfile(d: DriverProfile, owner: boolean) {
    if (d.locale) setLocale(d.locale);
    setDriver(d);
    setIsOwner(owner);
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
    const res = await api.updateProfile(patch);
    applyProfile(res.data, isOwner);
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* best-effort */
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(OWNER_KEY);
    api.setToken(null);
    setDriver(null);
    setIsOwner(false);
  }

  return (
    <AuthContext.Provider value={{ ready, driver, isOwner, login, activate, updateProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
