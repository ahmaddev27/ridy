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
import { stopImpersonation } from "@/lib/api/admin";
import { disableWebPush } from "@/lib/push/web-push";
import { disconnectRealtime } from "@/lib/realtime";

type AuthState = {
  user: AuthUser | null;
  /** True while a super-admin is acting as a company manager (impersonation). */
  impersonating: boolean;
  loading: boolean;
  /** True while the provider is ending the session and navigating to /login
   *  itself — the guard must not redirect too (it would drop `?reason=`). */
  endingSession: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// Logout must not hang on the push-token cleanup (a slow Firebase call).
const PUSH_CLEANUP_TIMEOUT_MS = 3000;
const ME_RETRY_MAX_MS = 30_000;

/** Ask the Reidey extension (if installed) to drop its pairing token, so a
 *  shared browser never keeps a working token after the manager leaves.
 *  Fire-and-forget: extensions before the unpair listener simply ignore it. */
function unpairExtension(): void {
  try {
    window.postMessage({ source: "ridy-unpair" }, window.location.origin);
  } catch {
    /* no window / cross-origin — nothing to unpair */
  }
}

/** Only a real "not signed in / not allowed" answer ends the session — a
 *  network blip or a 5xx on /me must not log the user out. */
function isAuthRejection(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 419);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [endingSessionState, setEndingSessionState] = useState(false);
  const router = useRouter();
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1000);
  const endingSession = useRef(false);
  const impersonatingRef = useRef(false);
  useEffect(() => {
    impersonatingRef.current = impersonating;
  }, [impersonating]);

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
      setEndingSessionState(false);
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
      if (detail.kind === "suspended" && impersonatingRef.current) {
        // A super-admin acting as a disabled/banned company: never log the
        // admin out — revert to their own identity and go back to the admin area.
        void stopImpersonation()
          .catch(() => {})
          .finally(() => window.location.assign("/admin/companies"));
        return;
      }
      // Set together with the user so the guard sees both in one render and
      // leaves the navigation (with its ?reason) to us.
      setEndingSessionState(true);
      setUser(null);
      setImpersonating(false);
      if (detail.kind === "suspended") {
        // The session is still valid server-side; end it (before the login page
        // probes /me) so the login screen can show the suspended/activation flow.
        void apiLogout()
          .catch(() => {})
          .finally(() => router.replace("/login?reason=suspended"));
      } else {
        router.replace("/login?reason=expired");
      }
    };
    authEvents.addEventListener(AUTH_EVENT, onAuthEvent);
    return () => authEvents.removeEventListener(AUTH_EVENT, onAuthEvent);
  }, [router]);

  const signOut = useCallback(async () => {
    endingSession.current = true;
    unpairExtension();
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
      setEndingSessionState(true);
      setUser(null);
      setImpersonating(false);
      router.push("/login");
    }
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, impersonating, loading, endingSession: endingSessionState, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
