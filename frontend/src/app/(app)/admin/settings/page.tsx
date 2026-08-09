"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Mail, Globe } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useI18n } from "@/lib/i18n/context";
import { getSettings, updateSettings, type PlatformSettings } from "@/lib/api/admin";

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
  const [proxy, setProxy] = useState("");

  async function load() {
    const s = await getSettings();
    setSettings(s);
    setHost(s.smtp_host ?? "");
    setPort(s.smtp_port ?? "587");
    setUsername(s.smtp_username ?? "");
    setEncryption(s.smtp_encryption ?? "tls");
    setFromAddress(s.mail_from_address ?? "");
    setFromName(s.mail_from_name ?? "");
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function saveSmtp() {
    setBusy(true);
    try {
      await updateSettings({
        smtp_host: host,
        smtp_port: Number(port) || 587,
        smtp_username: username,
        smtp_encryption: encryption,
        mail_from_address: fromAddress,
        mail_from_name: fromName,
        ...(password ? { smtp_password: password } : {}),
      });
      setPassword("");
      toast.success(c("saved"));
      await load();
    } catch (e) {
      toast.error(c("saveFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function saveProxy() {
    setBusy(true);
    try {
      await updateSettings({ global_proxy_url: proxy });
      setProxy("");
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

      {/* SMTP */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <Mail className="h-4 w-4 text-slate-700" />
          <h3 className="font-semibold text-slate-800">{c("smtp")}</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            >
              <option value="tls">TLS</option>
              <option value="ssl">SSL</option>
              <option value="none">{c("none")}</option>
            </select>
          </div>
          <Field label={c("fromName")} value={fromName} onChange={setFromName} />
          <Field label={c("fromAddress")} type="email" value={fromAddress} onChange={setFromAddress} />
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={saveSmtp} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {c("save")}
          </Button>
        </div>
      </Card>

      {/* Global proxy */}
      <Card className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <Globe className="h-4 w-4 text-slate-700" />
          <h3 className="font-semibold text-slate-800">{c("globalProxy")}</h3>
        </div>
        <p className="mb-3 text-sm text-slate-500">
          {c("globalProxyHint")}
          {settings?.has_global_proxy && (
            <span className="ms-2 font-mono text-xs text-slate-400" dir="ltr">
              ({settings.global_proxy_masked})
            </span>
          )}
        </p>
        <Field
          label={c("proxyUrl")}
          value={proxy}
          onChange={setProxy}
          mono
          placeholder="http://user:pass@host:port"
        />
        <div className="mt-4 flex justify-end">
          <Button onClick={saveProxy} disabled={busy}>
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
        className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 ${mono ? "font-mono text-xs" : ""}`}
      />
    </div>
  );
}
