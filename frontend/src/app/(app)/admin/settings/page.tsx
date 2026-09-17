"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Mail, LifeBuoy, Smartphone, Landmark, Banknote } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/context";
import { getSettings, updateSettings, sendTestEmail, type PlatformSettings } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";

export default function SettingsPage() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.settings.${k}`);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"email" | "support" | "payment" | "mobile">("email");

  // SMTP form.
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [encryption, setEncryption] = useState("tls");
  const [fromAddress, setFromAddress] = useState("");
  const [fromName, setFromName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportWhatsapp, setSupportWhatsapp] = useState("");
  const [provider, setProvider] = useState<"smtp" | "resend">("smtp");

  // Subscription payment methods (bank transfer + cash), each independently on/off.
  const [bankEnabled, setBankEnabled] = useState(false);
  const [bankHolder, setBankHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankIban, setBankIban] = useState("");
  const [bankBic, setBankBic] = useState("");
  const [bankNote, setBankNote] = useState("");
  const [cashEnabled, setCashEnabled] = useState(false);
  const [cashWhatsapp, setCashWhatsapp] = useState("");
  const [cashNote, setCashNote] = useState("");
  const [resendKey, setResendKey] = useState("");
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");

  // Mobile driver-app force-update form.
  const [appMinAndroid, setAppMinAndroid] = useState("");
  const [appMinIos, setAppMinIos] = useState("");
  const [appAndroidStoreUrl, setAppAndroidStoreUrl] = useState("");
  const [appIosStoreUrl, setAppIosStoreUrl] = useState("");

  async function load() {
    const s = await getSettings();
    setSettings(s);
    setHost(s.smtp_host ?? "");
    setPort(s.smtp_port ?? "587");
    setUsername(s.smtp_username ?? "");
    setEncryption(s.smtp_encryption ?? "tls");
    setFromAddress(s.mail_from_address ?? "");
    setFromName(s.mail_from_name ?? "");
    setSupportEmail(s.support_email ?? "");
    setSupportWhatsapp(s.support_whatsapp ?? "");
    setBankEnabled(s.pay_bank_enabled);
    setBankHolder(s.pay_bank_holder ?? "");
    setBankName(s.pay_bank_name ?? "");
    setBankIban(s.pay_bank_iban ?? "");
    setBankBic(s.pay_bank_bic ?? "");
    setBankNote(s.pay_bank_note ?? "");
    setCashEnabled(s.pay_cash_enabled);
    setCashWhatsapp(s.pay_cash_whatsapp ?? "");
    setCashNote(s.pay_cash_note ?? "");
    setProvider(s.mail_provider ?? "smtp");
    setAppMinAndroid(s.app_min_android ?? "");
    setAppMinIos(s.app_min_ios ?? "");
    setAppAndroidStoreUrl(s.app_android_store_url ?? "");
    setAppIosStoreUrl(s.app_ios_store_url ?? "");
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function saveSmtp() {
    setBusy(true);
    try {
      await updateSettings({
        mail_provider: provider,
        smtp_host: host,
        smtp_port: Number(port) || 587,
        smtp_username: username,
        smtp_encryption: encryption,
        mail_from_address: fromAddress,
        mail_from_name: fromName,
        ...(password ? { smtp_password: password } : {}),
        ...(resendKey ? { resend_api_key: resendKey } : {}),
      });
      setPassword("");
      setResendKey("");
      toast.success(c("saved"));
      await load();
    } catch (e) {
      toast.error(c("saveFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function testEmail() {
    setBusy(true);
    try {
      const r = await sendTestEmail(testTo.trim() || undefined);
      toast.success(c("testSent"), { description: r.to });
      setTestOpen(false);
    } catch (e) {
      const desc =
        e instanceof ApiError && (e.data?.data as { error?: string } | undefined)?.error
          ? ((e.data!.data as { error?: string }).error as string)
          : e instanceof Error
            ? e.message
            : undefined;
      toast.error(c("testFailed"), { description: desc });
    } finally {
      setBusy(false);
    }
  }

  async function saveSupport() {
    setBusy(true);
    try {
      await updateSettings({ support_email: supportEmail, support_whatsapp: supportWhatsapp });
      toast.success(c("saved"));
      await load();
    } catch (e) {
      toast.error(c("saveFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function savePayments() {
    setBusy(true);
    try {
      await updateSettings({
        pay_bank_enabled: bankEnabled,
        pay_bank_holder: bankHolder.trim(),
        pay_bank_name: bankName.trim(),
        pay_bank_iban: bankIban.trim(),
        pay_bank_bic: bankBic.trim(),
        pay_bank_note: bankNote.trim(),
        pay_cash_enabled: cashEnabled,
        pay_cash_whatsapp: cashWhatsapp.trim(),
        pay_cash_note: cashNote.trim(),
      });
      toast.success(c("saved"));
      await load();
    } catch (e) {
      toast.error(c("saveFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }


  async function saveMobileApp() {
    setBusy(true);
    try {
      await updateSettings({
        app_min_android: appMinAndroid.trim() || null,
        app_min_ios: appMinIos.trim() || null,
        app_android_store_url: appAndroidStoreUrl.trim() || null,
        app_ios_store_url: appIosStoreUrl.trim() || null,
      });
      toast.success(c("saved"));
      await load();
    } catch (e) {
      toast.error(c("saveFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader tkey="settings" />

      <div className="flex w-full flex-col gap-4 md:flex-row">
        {/* Side tabs */}
        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-line/70 bg-surface-2 p-1.5 md:h-fit md:w-52 md:flex-col md:gap-1">
          {([
            { k: "email", icon: Mail },
            { k: "support", icon: LifeBuoy },
            { k: "payment", icon: Banknote },
            { k: "mobile", icon: Smartphone },
          ] as const).map(({ k, icon: Icon }) => {
            const active = tab === k;
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={
                  "group flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-start text-sm font-medium transition-all " +
                  (active
                    ? "bg-primary text-primary-ink shadow-sm"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink")
                }
              >
                <Icon className={"h-4 w-4 shrink-0 " + (active ? "text-primary-ink" : "text-ink-subtle group-hover:text-ink-muted")} />
                {c(`tab_${k}`)}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
      {/* Email delivery */}
      {tab === "email" && (
      <Card className="w-full p-5">
        <div className="mb-4 flex items-center gap-2">
          <Mail className="h-4 w-4 text-ink" />
          <h3 className="font-semibold text-ink">{c("email")}</h3>
        </div>

        {/* Provider picker */}
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-ink">{c("provider")}</label>
          <div className="flex gap-2">
            {(["smtp", "resend"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={
                  "rounded-lg border px-4 py-2 text-sm font-medium transition-colors " +
                  (provider === p ? "border-ink bg-primary text-primary-ink" : "border-line text-ink-muted hover:bg-surface-2")
                }
              >
                {p === "smtp" ? "SMTP" : "Resend API"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {provider === "smtp" ? (
            <>
              <Field label={c("host")} value={host} onChange={setHost} />
              <Field label={c("port")} value={port} onChange={setPort} />
              <Field label={c("username")} value={username} onChange={setUsername} />
              <Field
                label={c("password")}
                type="password"
                value={password}
                onChange={setPassword}
                placeholder={settings?.has_smtp_password ? "••••••••" : ""}
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-ink">{c("encryption")}</label>
                <Select
                  value={encryption}
                  onChange={setEncryption}
                  searchable={false}
                  options={[
                    { value: "tls", label: "TLS" },
                    { value: "ssl", label: "SSL" },
                    { value: "none", label: c("none") },
                  ]}
                />
              </div>
            </>
          ) : (
            <div className="md:col-span-2">
              <Field
                label={c("resendKey")}
                type="password"
                value={resendKey}
                onChange={setResendKey}
                mono
                placeholder={settings?.has_resend_key ? "••••••••  (leave blank to keep)" : "re_..."}
              />
            </div>
          )}
          <Field label={c("fromName")} value={fromName} onChange={setFromName} />
          <Field label={c("fromAddress")} type="email" value={fromAddress} onChange={setFromAddress} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { setTestTo(""); setTestOpen(true); }} disabled={busy}>
            {c("sendTest")}
          </Button>
          <Button onClick={saveSmtp} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {c("save")}
          </Button>
        </div>
      </Card>
      )}

      {/* Support contacts — shown to suspended companies */}
      {tab === "support" && (
      <Card className="w-full p-5">
        <div className="mb-1 flex items-center gap-2">
          <LifeBuoy className="h-4 w-4 text-ink" />
          <h3 className="font-semibold text-ink">{c("support")}</h3>
        </div>
        <p className="mb-3 text-sm text-ink-muted">{c("supportHint")}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={c("supportEmail")} type="email" value={supportEmail} onChange={setSupportEmail} />
          <Field label={c("supportWhatsapp")} value={supportWhatsapp} onChange={setSupportWhatsapp} placeholder="+491700000000" />
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={saveSupport} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {c("save")}
          </Button>
        </div>
      </Card>
      )}

      {/* Subscription payment methods — shown to companies on the subscription/suspended screens */}
      {tab === "payment" && (
      <Card className="w-full p-5">
        <div className="mb-1 flex items-center gap-2">
          <Banknote className="h-4 w-4 text-ink" />
          <h3 className="font-semibold text-ink">{c("payment")}</h3>
        </div>
        <p className="mb-4 text-sm text-ink-muted">{c("paymentHint")}</p>

        {/* Bank transfer */}
        <div className="rounded-xl border border-line p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-ink" />
              <span className="font-medium text-ink">{c("payBank")}</span>
            </div>
            <Toggle checked={bankEnabled} onChange={() => setBankEnabled((v) => !v)} label={c("payBank")} />
          </div>
          {bankEnabled && (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label={c("payBankHolder")} value={bankHolder} onChange={setBankHolder} />
              <Field label={c("payBankName")} value={bankName} onChange={setBankName} />
              <Field label={c("payBankIban")} value={bankIban} onChange={setBankIban} mono dir="ltr" />
              <Field label={c("payBankBic")} value={bankBic} onChange={setBankBic} mono dir="ltr" />
              <div className="md:col-span-2">
                <Field label={c("payBankNote")} value={bankNote} onChange={setBankNote} />
              </div>
            </div>
          )}
        </div>

        {/* Cash / phone contact */}
        <div className="mt-3 rounded-xl border border-line p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-ink" />
              <span className="font-medium text-ink">{c("payCash")}</span>
            </div>
            <Toggle checked={cashEnabled} onChange={() => setCashEnabled((v) => !v)} label={c("payCash")} />
          </div>
          {cashEnabled && (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label={c("payCashWhatsapp")} value={cashWhatsapp} onChange={setCashWhatsapp} placeholder="+491700000000" dir="ltr" />
              <Field label={c("payCashNote")} value={cashNote} onChange={setCashNote} />
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={savePayments} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {c("save")}
          </Button>
        </div>
      </Card>
      )}

      {/* Mobile driver-app force-update */}
      {tab === "mobile" && (
      <Card className="w-full p-5">
        <div className="mb-1 flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-ink" />
          <h3 className="font-semibold text-ink">{c("mobileApp")}</h3>
        </div>
        <p className="mb-3 text-sm text-ink-muted">{c("mobileAppHint")}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={c("appMinAndroid")} value={appMinAndroid} onChange={setAppMinAndroid} placeholder="1.0.0" />
          <Field label={c("appMinIos")} value={appMinIos} onChange={setAppMinIos} placeholder="1.0.0" />
          <Field label={c("appAndroidStoreUrl")} type="url" value={appAndroidStoreUrl} onChange={setAppAndroidStoreUrl} placeholder="https://play.google.com/store/apps/details?id=…" />
          <Field label={c("appIosStoreUrl")} type="url" value={appIosStoreUrl} onChange={setAppIosStoreUrl} placeholder="https://apps.apple.com/app/id…" />
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={saveMobileApp} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {c("save")}
          </Button>
        </div>
      </Card>
      )}
        </div>
      </div>

      <Modal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        title={c("sendTest")}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTestOpen(false)} disabled={busy}>{c("cancel")}</Button>
            <Button onClick={testEmail} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{c("sendTest")}
            </Button>
          </div>
        }
      >
        <div className="text-start">
          <label className="mb-1 block text-sm font-medium text-ink">{c("testTo")}</label>
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            autoFocus
            placeholder={settings ? "you@example.com" : ""}
            className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-line"
          />
          <p className="mt-2 text-xs text-ink-subtle">{c("testHint")}</p>
        </div>
      </Modal>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  mono = false,
  placeholder,
  dir,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  mono?: boolean;
  placeholder?: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
      {type === "password" ? (
        <PasswordInput
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          className={mono ? "font-mono text-xs" : ""}
        />
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          dir={dir}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          className={`w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-line ${mono ? "font-mono text-xs" : ""}`}
        />
      )}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onChange}
      className={
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-line " +
        (checked ? "bg-primary" : "bg-line-strong")
      }
    >
      <span
        className={
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ltr:ml-1 rtl:mr-1 " +
          (checked ? "ltr:translate-x-5 rtl:-translate-x-5" : "translate-x-0")
        }
      />
    </button>
  );
}
