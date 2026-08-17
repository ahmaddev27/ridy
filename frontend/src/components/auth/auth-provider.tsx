"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { AuthUser, fetchMe, logout as apiLogout } from "@/lib/api/auth";

type AuthState = {
  user: AuthUser | null;
  /** True while a super-admin is acting as a company manager (impersonation). */
  impersonating: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      setUser(me.user);
      setImpersonating(me.impersonating);
    } catch {
      setUser(null);
      setImpersonating(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
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
