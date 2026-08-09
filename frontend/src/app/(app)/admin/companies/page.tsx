"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, type Status } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listCompanies, createCompany, type Company } from "@/lib/api/admin";
import { CompanyDetailModal } from "./company-detail-modal";

const sessionTone: Record<string, Status> = {
  active: "connected",
  needs_relink: "expiring",
  expired: "error",
};

export default function CompaniesPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.companies.${k}`);
  const { data, loading, error, refetch } = useAsync(listCompanies, { refetchInterval: 15000 });
  const companies = data ?? [];

  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        tkey="companies"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {c("newCompany")}
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-600">{c("loadError")} — {error}</div>
        ) : companies.length === 0 ? (
          <EmptyState icon={Building2} title={c("emptyTitle")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400 [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3 font-semibold">{c("colName")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colStatus")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colSession")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colDrivers")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colOffers")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colProxy")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {companies.map((co) => (
                  <tr
                    key={co.id}
                    onClick={() => setSelected(co.id)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{co.name}</div>
                      <div className="text-xs text-slate-400">{co.country ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={co.status === "active" ? "connected" : "neutral"} dot>
                        {co.status === "active" ? c("statusActive") : c("statusDisabled")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {co.session_status ? (
                        <Badge status={sessionTone[co.session_status] ?? "gap"} dot>
                          {c(`session_${co.session_status}`)}
                        </Badge>
                      ) : (
                        <span className="text-slate-400">{c("noSession")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{co.driver_count.toLocaleString(locale)}</td>
                    <td className="px-4 py-3 text-slate-600">{co.offer_count.toLocaleString(locale)}</td>
                    <td className="px-4 py-3">
                      {co.has_proxy ? (
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          {c("proxyDedicated")}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">{c("proxyGlobal")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected !== null && (
        <CompanyDetailModal
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={refetch}
        />
      )}

      <CreateCompanyModal open={creating} onClose={() => setCreating(false)} onCreated={refetch} />
    </div>
  );
}

function CreateCompanyModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.companies.${k}`);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("DE");
  const [mgrName, setMgrName] = useState("");
  const [mgrEmail, setMgrEmail] = useState("");
  const [mgrPassword, setMgrPassword] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setCountry("DE");
    setMgrName("");
    setMgrEmail("");
    setMgrPassword("");
  }

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createCompany({
        name: name.trim(),
        country: country.trim() || undefined,
        manager_name: mgrName.trim() || undefined,
        manager_email: mgrEmail.trim() || undefined,
        manager_password: mgrPassword || undefined,
      });
      toast.success(c("createdToast"));
      reset();
      onCreated();
      onClose();
    } catch (e) {
      toast.error(c("createFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={c("newCompany")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {c("cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {c("create")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-start">
        <Field label={c("fieldName")} value={name} onChange={setName} />
        <Field label={c("fieldCountry")} value={country} onChange={setCountry} />
        <p className="pt-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          {c("firstManager")}
        </p>
        <Field label={c("fieldManagerName")} value={mgrName} onChange={setMgrName} />
        <Field label={c("fieldManagerEmail")} type="email" value={mgrEmail} onChange={setMgrEmail} />
        <Field label={c("fieldManagerPassword")} type="password" value={mgrPassword} onChange={setMgrPassword} />
      </div>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
      />
    </div>
  );
}
