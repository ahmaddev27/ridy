"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Mail, LifeBuoy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/context";
import { getSettings, updateSettings, sendTestEmail, type PlatformSettings } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";

export default function SettingsPage() {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.settings.${k}`);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [busy, setBusy] = useState(false);

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
  const [resendKey, setResendKey] = useState("");
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");

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
    setProvider(s.mail_provider ?? "smtp");
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


  return (
    <div className="space-y-6">
      <PageHeader tkey="settings" />

      {/* Email delivery */}
      <Card className="w-full p-5">
        <div className="mb-4 flex items-center gap-2">
          <Mail className="h-4 w-4 text-slate-700" />
          <h3 className="font-semibold text-slate-800">{c("email")}</h3>
        </div>

        {/* Provider picker */}
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">{c("provider")}</label>
          <div className="flex gap-2">
            {(["smtp", "resend"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={
                  "rounded-lg border px-4 py-2 text-sm font-medium transition-colors " +
                  (provider === p ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50")
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
                <label className="mb-1 block text-sm font-medium text-slate-700">{c("encryption")}</label>
                <select
                  value={encryption}
                  onChange={(e) => setEncryption(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                >
                  <option value="tls">TLS</option>
                  <option value="ssl">SSL</option>
                  <option value="none">{c("none")}</option>
                </select>
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

      {/* Support contacts — shown to suspended companies */}
      <Card className="w-full p-5">
        <div className="mb-1 flex items-center gap-2">
          <LifeBuoy className="h-4 w-4 text-slate-700" />
          <h3 className="font-semibold text-slate-800">{c("support")}</h3>
        </div>
        <p className="mb-3 text-sm text-slate-500">{c("supportHint")}</p>
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
          <label className="mb-1 block text-sm font-medium text-slate-700">{c("testTo")}</label>
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            autoFocus
            placeholder={settings ? "you@example.com" : ""}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
          />
          <p className="mt-2 text-xs text-slate-400">{c("testHint")}</p>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  mono?: boolean;
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
        className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200 ${mono ? "font-mono text-xs" : ""}`}
      />
    </div>
  );
}
