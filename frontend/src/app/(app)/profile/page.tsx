"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, User, KeyRound, Fingerprint, Bell } from "lucide-react";
import { PageHead } from "@/components/ui/rd";
import { PasswordInput } from "@/components/ui/password-input";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/components/auth/auth-provider";
import { updateProfile } from "@/lib/api/auth";
import { NotificationSettings } from "./notification-settings";
import { PasskeySettings } from "./passkey-settings";

export default function ProfilePage() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.profile.${k}`);
  const { user, refresh } = useAuth();

  const [tab, setTab] = useState<"info" | "password" | "passkeys" | "notifications">("info");
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

  const spin = { animation: "ofr-spin 1s linear infinite" };

  return (
    <div className="stack" style={{ maxWidth: 880, marginInline: "auto", width: "100%" }}>
      <PageHead title={t("pages.profile.title")} sub={t("pages.profile.subtitle")} />

      <section className="card acc-tabs">
        <div className="tabs" role="tablist">
          {([
            { k: "info", icon: User },
            { k: "password", icon: KeyRound },
            { k: "passkeys", icon: Fingerprint },
            { k: "notifications", icon: Bell },
          ] as const).map(({ k, icon: Icon }) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              <Icon className="ico-sm" style={{ marginInlineEnd: 6, verticalAlign: "-3px" }} />
              {c(`tab_${k}`)}
            </button>
          ))}
        </div>

        <div className="tab-panel">
          {tab === "notifications" ? (
            <NotificationSettings />
          ) : tab === "passkeys" ? (
            <PasskeySettings />
          ) : tab === "info" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (name && email) void saveInfo();
              }}
            >
              <div className="form-section">
                <div>
                  <h3>{c("tab_info")}</h3>
                  {user?.tenant && (
                    <p>
                      {c("company")}: <b>{user.tenant.name}</b>
                    </p>
                  )}
                </div>
                <div className="stack">
                  <div className="form-grid">
                    <Field label={c("name")} value={name} onChange={setName} id="pf-name" />
                    <Field label={c("email")} type="email" value={email} onChange={setEmail} id="pf-mail" />
                  </div>
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <button type="submit" className="btn btn-primary" disabled={busy || !name || !email}>
                      {busy ? <Loader2 style={spin} /> : <Save />}
                      {c("save")}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (password.length >= 8) void savePassword();
              }}
            >
              <div className="form-section">
                <div>
                  <h3>{c("tab_password")}</h3>
                  <p>{c("leaveEmpty")}</p>
                </div>
                <div className="stack">
                  <div className="form-grid">
                    <Field label={c("newPassword")} type="password" value={password} onChange={setPassword} placeholder={c("leaveEmpty")} id="pf-pw1" />
                    <Field label={c("confirmPassword")} type="password" value={confirm} onChange={setConfirm} id="pf-pw2" />
                  </div>
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <button type="submit" className="btn btn-primary" disabled={busy || password.length < 8}>
                      {busy ? <Loader2 style={spin} /> : <KeyRound />}
                      {c("changePassword")}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  id: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {type === "password" ? (
        <PasswordInput id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      ) : (
        <input id={id} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="off" className="input" />
      )}
    </div>
  );
}
