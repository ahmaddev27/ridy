"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { AuthUser, fetchMe, logout as apiLogout } from "@/lib/api/auth";
import { ApiError, AUTH_EVENT, authEvents, type AuthEventDetail } from "@/lib/api/client";
import { disableWebPush } from "@/lib/push/web-push";
import { disconnectRealtime } from "@/lib/realtime";

type AuthState = {
  user: AuthUser | null;
  /** True while a super-admin is acting as a company manager (impersonation). */
  impersonating: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// Logout must not hang on the push-token cleanup (a slow Firebase call).
const PUSH_CLEANUP_TIMEOUT_MS = 3000;
const ME_RETRY_MAX_MS = 30_000;

/** Only a real "not signed in / not allowed" answer ends the session — a
 *  network blip or a 5xx on /me must not log the user out. */
function isAuthRejection(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 419);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1000);
  const endingSession = useRef(false);

  const refresh = useCallback(async () => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    try {
      const me = await fetchMe();
      setUser(me.user);
      setImpersonating(me.impersonating);
      retryDelay.current = 1000;
      endingSession.current = false;
      setLoading(false);
    } catch (err) {
      if (isAuthRejection(err)) {
        setUser(null);
        setImpersonating(false);
        setLoading(false);
        return;
      }
      // Transient: keep whoever is signed in (or keep the loader on first load)
      // and try again with backoff instead of bouncing to /login.
      if (userRef.current) return;
      const delay = retryDelay.current;
      retryDelay.current = Math.min(delay * 2, ME_RETRY_MAX_MS);
      retryTimer.current = setTimeout(() => void refresh(), delay);
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [refresh]);

  // A dead session (401/419) or a suspended company (403 account_suspended)
  // anywhere in the app ends the session once, instead of every poll failing
  // silently behind a frozen dashboard.
  useEffect(() => {
    const onAuthEvent = (e: Event) => {
      const detail = (e as CustomEvent<AuthEventDetail>).detail;
      if (!detail || !userRef.current || endingSession.current) return;
      endingSession.current = true;
      disconnectRealtime();
      setUser(null);
      setImpersonating(false);
      if (detail.kind === "suspended") {
        // The session is still valid server-side; end it so the login screen
        // can show the suspended/activation flow on the next sign-in.
        void apiLogout().catch(() => {});
        router.replace("/login?reason=suspended");
      } else {
        router.replace("/login?reason=expired");
      }
    };
    authEvents.addEventListener(AUTH_EVENT, onAuthEvent);
    return () => authEvents.removeEventListener(AUTH_EVENT, onAuthEvent);
  }, [router]);

  const signOut = useCallback(async () => {
    endingSession.current = true;
    try {
      // Unregister this browser's push token while the session still exists.
      await Promise.race([
        disableWebPush(),
        new Promise((resolve) => setTimeout(resolve, PUSH_CLEANUP_TIMEOUT_MS)),
      ]);
      await apiLogout();
    } catch {
      /* signed out locally regardless */
    } finally {
      disconnectRealtime();
      setUser(null);
      setImpersonating(false);
      router.push("/login");
    }
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, impersonating, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
