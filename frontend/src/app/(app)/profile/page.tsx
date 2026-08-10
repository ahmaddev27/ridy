"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
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

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  async function save() {
    setBusy(true);
    try {
      await updateProfile({
        name,
        email,
        ...(password ? { password } : {}),
      });
      setPassword("");
      toast.success(c("saved"));
      await refresh();
    } catch (e) {
      toast.error(c("saveFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader tkey="profile" />

      <Card className="mx-auto max-w-lg p-5">
        {user?.tenant && (
          <p className="mb-4 text-sm text-slate-400">
            {c("company")}: <span className="font-medium text-slate-600">{user.tenant.name}</span>
          </p>
        )}
        <div className="space-y-3">
          <Field label={c("name")} value={name} onChange={setName} />
          <Field label={c("email")} type="email" value={email} onChange={setEmail} />
          <Field
            label={c("newPassword")}
            type="password"
            value={password}
            onChange={setPassword}
            placeholder={c("leaveEmpty")}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={save} disabled={busy || !name || !email}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {c("save")}
          </Button>
        </div>
      </Card>
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
