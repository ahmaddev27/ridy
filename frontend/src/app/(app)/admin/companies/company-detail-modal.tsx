"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Loader2, Save, KeyRound, RefreshCw, Trash2, UserPlus, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import {
  getCompany,
  updateCompany,
  disableCompany,
  createCompanyUser,
  resetCompanyUserPassword,
  forceRelink,
  deleteCompanySession,
  type Company,
} from "@/lib/api/admin";

/** Super-admin company detail: edit, proxy, users, session controls. */
export function CompanyDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.companies.${k}`);
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Editable fields.
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState("active");
  const [orgUuid, setOrgUuid] = useState("");
  const [proxy, setProxy] = useState("");

  // Sub-actions.
  const [confirm, setConfirm] = useState<null | "disable" | "relink" | "deleteSession">(null);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "" });

  async function load() {
    try {
      const co = await getCompany(id);
      setCompany(co);
      setName(co.name);
      setCountry(co.country ?? "");
      setStatus(co.status);
      setOrgUuid(co.uber_org_uuid ?? "");
      setProxy(co.proxy_url ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    load();
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveInfo() {
    setBusy(true);
    try {
      await updateCompany(id, {
        name: name.trim(),
        country: country.trim(),
        status,
        uber_org_uuid: orgUuid.trim() || undefined,
        proxy_url: proxy, // empty string clears → global proxy
      });
      toast.success(c("savedToast"));
      await load();
      onChanged();
    } catch (e) {
      toast.error(c("saveFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function addUser() {
    if (!newUser.name || !newUser.email || !newUser.password) return;
    setBusy(true);
    try {
      await createCompanyUser(id, newUser);
      toast.success(c("userCreatedToast"));
      setNewUser({ name: "", email: "", password: "" });
      await load();
    } catch (e) {
      toast.error(c("userCreateFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function resetPw(userId: number) {
    const pw = window.prompt(c("resetPrompt"));
    if (!pw) return;
    try {
      await resetCompanyUserPassword(id, userId, pw);
      toast.success(c("resetDone"));
    } catch (e) {
      toast.error(c("resetFailed"), { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === "disable") await disableCompany(id);
      if (confirm === "relink") await forceRelink(id);
      if (confirm === "deleteSession") await deleteCompanySession(id);
      toast.success(c("done"));
      await load();
      onChanged();
    } catch (e) {
      toast.error(c("actionFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white text-start shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <h2 className="text-lg font-semibold text-slate-900">{company?.name ?? c("company")}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
          {error ? (
            <div className="text-sm text-rose-600">{error}</div>
          ) : !company ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <StatCard label={c("colDrivers")} value={company.driver_count} />
                <StatCard label={c("colOffers")} value={company.offer_count} />
                <StatCard label={c("colSession")} value={company.session_status ? c(`session_${company.session_status}`) : c("noSession")} />
              </div>

              {/* Edit info */}
              <Section title={c("info")}>
                <Field label={c("fieldName")} value={name} onChange={setName} />
                <Field label={c("fieldCountry")} value={country} onChange={setCountry} />
                <Field label={c("fieldOrgUuid")} value={orgUuid} onChange={setOrgUuid} mono />
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">{c("colStatus")}</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                  >
                    <option value="active">{c("statusActive")}</option>
                    <option value="disabled">{c("statusDisabled")}</option>
                  </select>
                </div>
              </Section>

              {/* Proxy — super-admin only */}
              <Section title={c("proxy")}>
                <p className="text-xs text-slate-400">{c("proxyHint")}</p>
                <Field
                  label={c("proxyUrl")}
                  value={proxy}
                  onChange={setProxy}
                  mono
                  placeholder="http://user:pass@host:port"
                />
              </Section>

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setConfirm("disable")} disabled={busy || status === "disabled"}>
                  <Ban className="h-4 w-4" /> {c("disable")}
                </Button>
                <Button onClick={saveInfo} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {c("save")}
                </Button>
              </div>

              {/* Users */}
              <Section title={c("managers")}>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {(company.users ?? []).map((u) => (
                    <div key={u.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-800">{u.name}</div>
                        <div className="truncate text-xs text-slate-400">{u.email}</div>
                      </div>
                      <Button variant="ghost" onClick={() => resetPw(u.id)}>
                        <KeyRound className="h-4 w-4" /> {c("resetPassword")}
                      </Button>
                    </div>
                  ))}
                  {(company.users ?? []).length === 0 && (
                    <div className="px-3 py-3 text-sm text-slate-400">{c("noManagers")}</div>
                  )}
                </div>
                {/* Add manager */}
                <div className="grid grid-cols-3 gap-2">
                  <input placeholder={c("fieldManagerName")} value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    className="rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-slate-900" />
                  <input placeholder={c("fieldManagerEmail")} type="email" value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    className="rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-slate-900" />
                  <input placeholder={c("fieldManagerPassword")} type="password" value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-slate-900" />
                </div>
                <Button variant="secondary" onClick={addUser} disabled={busy || !newUser.email}>
                  <UserPlus className="h-4 w-4" /> {c("addManager")}
                </Button>
              </Section>

              {/* Session controls */}
              <Section title={c("session")}>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setConfirm("relink")} disabled={busy || !company.session_status}>
                    <RefreshCw className="h-4 w-4" /> {c("forceRelink")}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirm("deleteSession")} disabled={busy || !company.session_status}>
                    <Trash2 className="h-4 w-4" /> {c("deleteSession")}
                  </Button>
                </div>
              </Section>
            </>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirm !== null}
        danger
        title={c(`confirm_${confirm}_title`)}
        message={c(`confirm_${confirm}_body`)}
        confirmLabel={c("confirm")}
        cancelLabel={c("cancel")}
        busy={busy}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  mono = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200 ${mono ? "font-mono text-xs" : ""}`}
      />
    </div>
  );
}
