"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { login } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n/context";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState("manager@fleet.de");
  const [password, setPassword] = useState("password");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const u = await login(email, password);
      // Super-admins land on the platform panel; managers on their dashboard.
      router.push(u.roles.includes("super_admin") ? "/admin" : "/dashboard");
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 422
          ? t("login.invalid")
          : "API offline (:8090)?";
      toast.error(t("login.failed"), { description: message });
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Logo size={44} className="text-slate-900" />
          <div className="leading-tight">
            <div className="text-lg font-bold text-slate-900">Reidey</div>
            <div className="text-xs text-slate-400">Fleet Management</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">{t("login.title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("login.subtitle")}</p>

          <form className="mt-5 space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("login.email")}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">{t("login.password")}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? t("login.signingIn") : t("login.signIn")}
            </Button>
          </form>
        </div>

      </div>
    </div>
  );
}
