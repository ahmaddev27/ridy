import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { api, type DriverProfile } from "./api";
import { setLocale } from "./i18n";

const TOKEN_KEY = "reidey_driver_token";

type AuthState = {
  ready: boolean;
  driver: DriverProfile | null;
  login: (email: string, password: string) => Promise<void>;
  activate: (inviteToken: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [driver, setDriver] = useState<DriverProfile | null>(null);

  // Restore a stored session on launch.
  useEffect(() => {
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (token) {
        api.setToken(token);
        try {
          const me = await api.me();
          applyDriver(me.data);
        } catch {
          await SecureStore.deleteItemAsync(TOKEN_KEY);
          api.setToken(null);
        }
      }
      setReady(true);
    })();
  }, []);

  function applyDriver(d: DriverProfile) {
    if (d.locale) setLocale(d.locale);
    setDriver(d);
  }

  async function persist(token: string, d: DriverProfile) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    api.setToken(token);
    applyDriver(d);
  }

  async function login(email: string, password: string) {
    const res = await api.login(email, password);
    await persist(res.data.token, res.data.driver);
  }

  async function activate(inviteToken: string, password: string) {
    const res = await api.activate(inviteToken, password);
    await persist(res.data.token, res.data.driver);
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* best-effort */
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    api.setToken(null);
    setDriver(null);
  }

  return (
    <AuthContext.Provider value={{ ready, driver, login, activate, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
