"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "./auth-provider";

/** Gates the /reseller section: only resellers may enter. */
export function ResellerGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  const isReseller = !!user?.roles.includes("reseller");

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (!isReseller) router.replace(user.roles.includes("super_admin") ? "/admin" : "/dashboard");
  }, [loading, user, isReseller, router]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!user || !isReseller) return null;

  return <>{children}</>;
}
