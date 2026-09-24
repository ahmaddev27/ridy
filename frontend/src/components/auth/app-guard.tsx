"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "./auth-provider";

/** Gates the app shell: redirects to /login when there is no authenticated user. */
export function AppGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, endingSession } = useAuth();
  const router = useRouter();

  // While the provider ends the session it navigates itself (keeping ?reason=
  // for the login screen); a second replace here would win and drop it.
  useEffect(() => {
    if (!loading && !user && !endingSession) router.replace("/login");
  }, [loading, user, endingSession, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ink-subtle">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
