"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Mail, LifeBuoy, Smartphone, Landmark, Banknote, RotateCcw, Send, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
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
  const [bankAmount, setBankAmount] = useState("");
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
    setBankAmount(s.pay_bank_amount ?? "");
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

  const [loadFailed, setLoadFailed] = useState(false);
  function retryLoad() {
    setLoadFailed(false);
    load().catch((e) => {
      setLoadFailed(true);
      toast.error(t("common.loadFailed"), { description: e instanceof Error ? e.message : undefined });
    });
  }

  useEffect(() => {
    retryLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveSmtp() {
    if (!settings) return;
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
    if (!settings) return;
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
    if (!settings) return;
    setBusy(true);
    try {
      await updateSettings({
        pay_bank_enabled: bankEnabled,
        pay_bank_holder: bankHolder.trim(),
        pay_bank_name: bankName.trim(),
        pay_bank_iban: bankIban.trim(),
        pay_bank_bic: bankBic.trim(),
        pay_bank_amount: bankAmount.trim(),
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
    if (!settings) return;
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
    <div className="stack-lg">
      <header className="ph">
        <div>
          <h1>{t("pages.settings.title")}</h1>
          <p>{t("pages.settings.subtitle")}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[210px_minmax(0,1fr)]">
        {/* Side tabs */}
        <nav role="tablist" className="flex gap-0.5 overflow-x-auto md:sticky md:top-[76px] md:flex-col">
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
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(k)}
                className={
                  "flex h-[38px] items-center gap-2.5 whitespace-nowrap rounded-[10px] px-3 text-start text-[13.5px] font-medium transition-colors " +
                  (active
                    ? "bg-surface text-ink shadow-[var(--shadow-xs)] outline outline-1 outline-line"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink")
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {c(`tab_${k}`)}
              </button>
            );
          })}
        </nav>

        <div className="stack-lg min-w-0">
      {/* Email delivery */}
      {/* Never show (or let anyone save) the empty default form: a failed
          load would otherwise overwrite SMTP / payment / support settings. */}
      {!settings && (
        <section className="card">
          {loadFailed ? (
            <div className="empty">
              <div className="empty-ico"><RotateCcw className="h-5 w-5" /></div>
              <h3>{t("common.loadFailed")}</h3>
              <button type="button" className="btn btn-secondary" onClick={retryLoad}>
                <RotateCcw className="h-4 w-4" />
                {t("common.retry")}
              </button>
            </div>
          ) : (
            <div className="card-body stack">
              <span className="skel" style={{ height: 14, width: "40%" }} />
              <span className="skel" style={{ height: 40 }} />
              <span className="skel" style={{ height: 40 }} />
            </div>
          )}
        </section>
      )}
      {settings && tab === "email" && (
      <SettingsCard icon={Mail} title={c("email")}>
        {/* Provider picker */}
        <div className="field">
          <span className="strong text-sm">{c("provider")}</span>
          <div className="seg" role="group" style={{ alignSelf: "flex-start" }}>
            {(["smtp", "resend"] as const).map((p) => (
              <button key={p} type="button" className={provider === p ? "on" : ""} onClick={() => setProvider(p)}>
                {p === "smtp" ? "SMTP" : "Resend API"}
              </button>
            ))}
          </div>
        </div>

        <div className="form-grid">
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
              <div className="field">
                <label>{c("encryption")}</label>
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
            <div className="full">
              <Field
                label={c("resendKey")}
                type="password"
                value={resendKey}
                onChange={setResendKey}
                mono
                placeholder={settings?.has_resend_key ? c("keepBlankPlaceholder") : "re_..."}
              />
            </div>
          )}
          <Field label={c("fromName")} value={fromName} onChange={setFromName} />
          <Field label={c("fromAddress")} type="email" value={fromAddress} onChange={setFromAddress} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { setTestTo(""); setTestOpen(true); }} disabled={busy || !settings}>
            <Send className="h-4 w-4" />
            {c("sendTest")}
          </Button>
          <Button onClick={saveSmtp} disabled={busy || !settings}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {c("save")}
          </Button>
        </div>
      </SettingsCard>
      )}

      {/* Support contacts — shown to suspended companies */}
      {settings && tab === "support" && (
      <SettingsCard icon={LifeBuoy} title={c("support")} sub={c("supportHint")}>
        <div className="form-grid">
          <Field label={c("supportEmail")} type="email" value={supportEmail} onChange={setSupportEmail} />
          <Field label={c("supportWhatsapp")} value={supportWhatsapp} onChange={setSupportWhatsapp} placeholder="+491700000000" />
        </div>
        <div className="flex justify-end">
          <Button onClick={saveSupport} disabled={busy || !settings}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {c("save")}
          </Button>
        </div>
      </SettingsCard>
      )}

      {/* Subscription payment methods — shown to companies on the subscription/suspended screens */}
      {settings && tab === "payment" && (
      <SettingsCard icon={Banknote} title={c("payment")} sub={c("paymentHint")}>
        {/* Bank transfer */}
        <div className="flex flex-col gap-3.5 rounded-[var(--r-lg)] border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="row" style={{ gap: 10 }}>
              <span className="stat-ico"><Landmark className="h-4 w-4" /></span>
              <span className="strong">{c("payBank")}</span>
            </div>
            <Toggle checked={bankEnabled} onChange={() => setBankEnabled((v) => !v)} label={c("payBank")} />
          </div>
          {bankEnabled && (
            <div className="form-grid">
              <Field label={c("payBankHolder")} value={bankHolder} onChange={setBankHolder} />
              <Field label={c("payBankName")} value={bankName} onChange={setBankName} />
              <Field label={c("payBankIban")} value={bankIban} onChange={setBankIban} mono dir="ltr" />
              <Field label={c("payBankBic")} value={bankBic} onChange={setBankBic} mono dir="ltr" />
              <Field label={c("payBankAmount")} value={bankAmount} onChange={setBankAmount} placeholder="300" dir="ltr" />
              <div className="full">
                <Field label={c("payBankNote")} value={bankNote} onChange={setBankNote} />
              </div>
            </div>
          )}
        </div>

        {/* Cash / phone contact */}
        <div className="flex flex-col gap-3.5 rounded-[var(--r-lg)] border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="row" style={{ gap: 10 }}>
              <span className="stat-ico"><Banknote className="h-4 w-4" /></span>
              <span className="strong">{c("payCash")}</span>
            </div>
            <Toggle checked={cashEnabled} onChange={() => setCashEnabled((v) => !v)} label={c("payCash")} />
          </div>
          {cashEnabled && (
            <div className="form-grid">
              <Field label={c("payCashWhatsapp")} value={cashWhatsapp} onChange={setCashWhatsapp} placeholder="+491700000000" dir="ltr" />
              <Field label={c("payCashNote")} value={cashNote} onChange={setCashNote} />
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={savePayments} disabled={busy || !settings}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {c("save")}
          </Button>
        </div>
      </SettingsCard>
      )}

      {/* Mobile driver-app force-update */}
      {settings && tab === "mobile" && (
      <SettingsCard icon={Smartphone} title={c("mobileApp")} sub={c("mobileAppHint")}>
        <div className="form-grid">
          <Field label={c("appMinAndroid")} value={appMinAndroid} onChange={setAppMinAndroid} placeholder="1.0.0" />
          <Field label={c("appMinIos")} value={appMinIos} onChange={setAppMinIos} placeholder="1.0.0" />
          <Field label={c("appAndroidStoreUrl")} type="url" value={appAndroidStoreUrl} onChange={setAppAndroidStoreUrl} placeholder="https://play.google.com/store/apps/details?id=…" />
          <Field label={c("appIosStoreUrl")} type="url" value={appIosStoreUrl} onChange={setAppIosStoreUrl} placeholder="https://apps.apple.com/app/id…" />
        </div>
        <div className="flex justify-end">
          <Button onClick={saveMobileApp} disabled={busy || !settings}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {c("save")}
          </Button>
        </div>
      </SettingsCard>
      )}
        </div>
      </div>

      <Modal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        title={c("sendTest")}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTestOpen(false)} disabled={busy || !settings}>{c("cancel")}</Button>
            <Button onClick={testEmail} disabled={busy || !settings}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{c("sendTest")}
            </Button>
          </div>
        }
      >
        <div className="field text-start">
          <label>{c("testTo")}</label>
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            autoFocus
            placeholder={settings ? "you@example.com" : ""}
            className="input"
          />
          <p className="hint">{c("testHint")}</p>
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
    <div className="field">
      <label>{label}</label>
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
          className={`input ${mono ? "mono" : ""}`}
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
    <label className="switch" title={label}>
      <input type="checkbox" role="switch" checked={checked} onChange={onChange} aria-label={label} />
      <span />
    </label>
  );
}

function SettingsCard({
  icon: Icon,
  title,
  sub,
  children,
}: {
  icon: LucideIcon;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="row" style={{ gap: 8 }}>
            <Icon className="subtle h-4 w-4" />
            {title}
          </h2>
          {sub && <div className="sub">{sub}</div>}
        </div>
      </div>
      <div className="card-body stack">{children}</div>
    </section>
  );
}
