"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, User, KeyRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/components/auth/auth-provider";
import { updateProfile } from "@/lib/api/auth";

export default function ProfilePage() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.profile.${k}`);
  const { user, refresh } = useAuth();

  const [tab, setTab] = useState<"info" | "password">("info");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  async function saveInfo() {
    setBusy(true);
    try {
      await updateProfile({ name, email });
      toast.success(c("saved"));
      await refresh();
    } catch (e) {
      toast.error(c("saveFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    if (password !== confirm) {
      toast.error(c("saveFailed"), { description: c("mismatch") });
      return;
    }
    setBusy(true);
    try {
      await updateProfile({ password, password_confirmation: confirm });
      setPassword("");
      setConfirm("");
      toast.success(c("passwordChanged"));
    } catch (e) {
      toast.error(c("saveFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader tkey="profile" />

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 md:flex-row">
        {/* Side tabs */}
        <nav className="flex gap-1 overflow-x-auto md:w-48 md:flex-col md:gap-0.5">
          {([
            { k: "info", icon: User },
            { k: "password", icon: KeyRound },
          ] as const).map(({ k, icon: Icon }) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={
                "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-start text-sm font-medium transition-colors " +
                (tab === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")
              }
            >
              <Icon className="h-4 w-4" /> {c(`tab_${k}`)}
            </button>
          ))}
        </nav>

        <Card className="min-w-0 flex-1 p-5">
          {user?.tenant && (
            <p className="mb-4 text-sm text-slate-400">
              {c("company")}: <span className="font-medium text-slate-600">{user.tenant.name}</span>
            </p>
          )}

          {tab === "info" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={c("name")} value={name} onChange={setName} />
                <Field label={c("email")} type="email" value={email} onChange={setEmail} />
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={saveInfo} disabled={busy || !name || !email}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {c("save")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={c("newPassword")} type="password" value={password} onChange={setPassword} placeholder={c("leaveEmpty")} />
                <Field label={c("confirmPassword")} type="password" value={confirm} onChange={setConfirm} />
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={savePassword} disabled={busy || password.length < 8}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  {c("changePassword")}
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
      />
    </div>
  );
}
