"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Save, KeyRound, RefreshCw, Trash2, UserPlus, Ticket, ShieldCheck, ChevronDown, Info, Users, Car, Radio, Plug } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useI18n } from "@/lib/i18n/context";
import {
  getCompany,
  updateCompany,
  setCompanyActive,
  createCompanyUser,
  resetCompanyUserPassword,
  forceRelink,
  deleteCompanySession,
  generateActivationCode,
  reactivateCompany,
  listProxies,
  getCompanyDrivers,
  getCompanyOffers,
  getCompanyVehicles,
  type Company,
  type Proxy,
  type CompanyDriverRow,
  type CompanyOfferRow,
  type CompanyVehicleRow,
} from "@/lib/api/admin";

/** Super-admin company detail as a full page: edit, proxy, users, session,
 *  subscription controls, plus drivers/offers/vehicles tabs. */
export function CompanyDetail({
  id,
  onChanged = () => {},
}: {
  id: number;
  onChanged?: () => void;
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
  const [proxyId, setProxyId] = useState("");
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [tab, setTab] = useState<"details" | "subscription" | "managers" | "drivers" | "offers" | "vehicles">("details");

  // Sub-actions.
  const [confirm, setConfirm] = useState<null | "disable" | "relink" | "deleteSession">(null);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "" });

  // Subscription/activation.
  const [days, setDays] = useState("30");
  const [amount, setAmount] = useState("");
  const [paid, setPaid] = useState(true);
  const [genCode, setGenCode] = useState<string | null>(null);

  // Password reset (in-app modal, not a native prompt).
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [resetPwd, setResetPwd] = useState("");

  async function load() {
    try {
      const co = await getCompany(id);
      setCompany(co);
      setName(co.name);
      setCountry(co.country ?? "");
      setStatus(co.status);
      setOrgUuid(co.uber_org_uuid ?? "");
      setProxyId(co.proxy_id !== null ? String(co.proxy_id) : "");
      listProxies().then(setProxies).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    }
  }

  useEffect(() => {
    load();
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
        proxy_id: proxyId ? Number(proxyId) : null, // pool proxy; empty = auto/none
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

  async function submitReset() {
    if (resetFor === null || resetPwd.length < 8) return;
    setBusy(true);
    try {
      await resetCompanyUserPassword(id, resetFor, resetPwd);
      toast.success(c("resetDone"));
      setResetFor(null);
      setResetPwd("");
    } catch (e) {
      toast.error(c("resetFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function genActivation() {
    setBusy(true);
    try {
      const res = await generateActivationCode(id, Number(days) || 30, amount ? Number(amount) : undefined, paid);
      setGenCode(res.code);
      toast.success(c("codeGenerated"));
      await load();
    } catch (e) {
      toast.error(c("codeFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function endSubscription() {
    setBusy(true);
    try {
      await updateCompany(id, { subscription_ends_at: new Date().toISOString() });
      toast.success(c("subEnded"));
      await load();
      onChanged();
    } catch (e) {
      toast.error(c("actionFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function doReactivate() {
    setBusy(true);
    try {
      await reactivateCompany(id);
      toast.success(c("reactivatedToast"));
      await load();
      onChanged();
    } catch (e) {
      toast.error(c("actionFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === "disable") await setCompanyActive(id, false); // reversible — never deletes
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
    <div className="w-full text-start">
      {/* Header with back link */}
      <div className="mb-5 flex items-center gap-3">
        <Link href="/admin/companies" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
        </Link>
        <h1 className="text-xl font-bold text-slate-900">{company?.name ?? c("company")}</h1>
        {company?.state !== undefined && company?.state !== null && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
            {c(`sub_${company.state}`)}
          </span>
        )}
      </div>

      {/* Side tabs (start side = right in RTL, left in LTR) + content */}
      <div className="flex flex-col gap-4 md:flex-row">
        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200/70 bg-slate-50 p-1.5 md:h-fit md:w-56 md:flex-col md:gap-1">
          {([
            { k: "details", icon: Info },
            { k: "subscription", icon: Ticket },
            { k: "managers", icon: ShieldCheck },
            { k: "drivers", icon: Users },
            { k: "offers", icon: Radio },
            { k: "vehicles", icon: Car },
          ] as const).map(({ k: tk, icon: Icon }) => {
            const active = tab === tk;
            return (
              <button
                key={tk}
                onClick={() => setTab(tk)}
                className={
                  "group flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-start text-sm font-medium transition-all " +
                  (active
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900")
                }
              >
                <Icon className={"h-4 w-4 shrink-0 " + (active ? "text-white" : "text-slate-400 group-hover:text-slate-600")} />
                {c(`tab_${tk}`)}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {error ? (
            <div className="text-sm text-rose-600">{error}</div>
          ) : !company ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : tab === "offers" ? (
            <CompanyOffersTab id={id} />
          ) : tab === "drivers" || tab === "vehicles" ? (
            <CompanyDataTab id={id} tab={tab} />
          ) : tab === "subscription" ? (
            <Section title={c("subscription")}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {company.state === null ? (
                    <Badge status="connected" dot>{c("subActive")}</Badge>
                  ) : (
                    <Badge status={company.state === "banned" || company.state === "disabled" ? "error" : "expiring"} dot>
                      {c(`sub_${company.state}`)}
                    </Badge>
                  )}
                  {company.days_left !== null && (
                    <span className="text-slate-500">{c("daysLeft").replace("{n}", String(company.days_left))}</span>
                  )}
                  {company.subscription_ends_at && (
                    <span className="text-xs text-slate-400" dir="ltr">
                      → {new Date(company.subscription_ends_at).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-400">{c("activationHint")}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-24">
                    <label className="mb-1 block text-xs font-medium text-slate-600">{c("days")}</label>
                    <input
                      type="number"
                      min={1}
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                    />
                  </div>
                  <div className="w-28">
                    <label className="mb-1 block text-xs font-medium text-slate-600">{c("amount")}</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                    />
                  </div>
                  <label className="flex h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-600">
                    <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4" />
                    {c("markPaid")}
                  </label>
                  <Button variant="secondary" onClick={genActivation} disabled={busy}>
                    <Ticket className="h-4 w-4" /> {c("generateCode")}
                  </Button>
                  {company.banned && (
                    <Button onClick={doReactivate} disabled={busy}>
                      <ShieldCheck className="h-4 w-4" /> {c("reactivate")}
                    </Button>
                  )}
                  {company.state === null && (
                    <Button variant="secondary" onClick={endSubscription} disabled={busy}>
                      {c("endSubscription")}
                    </Button>
                  )}
                </div>
                {genCode && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    {c("codeIs")}{" "}
                    <span className="font-mono text-lg font-bold tracking-widest" dir="ltr">{genCode}</span>
                    <span className="ms-2 text-xs text-emerald-600">{c("codeValid")}</span>
                  </div>
                )}
            </Section>
          ) : tab === "managers" ? (
            <Section title={c("managers")}>
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {(company.users ?? []).map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-800">{u.name}</div>
                      <div className="truncate text-xs text-slate-400">{u.email}</div>
                      {u.phone && (
                        <a href={`tel:${u.phone}`} className="text-xs font-medium text-slate-500 hover:text-slate-800" dir="ltr">{u.phone}</a>
                      )}
                    </div>
                    <Button variant="ghost" onClick={() => { setResetFor(u.id); setResetPwd(""); }}>
                      <KeyRound className="h-4 w-4" /> {c("resetPassword")}
                    </Button>
                  </div>
                ))}
                {(company.users ?? []).length === 0 && (
                  <div className="px-3 py-3 text-sm text-slate-400">{c("noManagers")}</div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
          ) : (
            <>
              {/* Status — a toggle switch at the top */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-700">{c("colStatus")}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={status === "active"}
                  onClick={() => setStatus(status === "active" ? "disabled" : "active")}
                  className={
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors " +
                    (status === "active" ? "bg-emerald-500" : "bg-slate-300")
                  }
                >
                  <span
                    className={
                      "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform " +
                      (status === "active" ? "translate-x-[22px] rtl:-translate-x-[22px]" : "translate-x-0.5 rtl:-translate-x-0.5")
                    }
                  />
                </button>
                <span className={"text-sm font-medium " + (status === "active" ? "text-emerald-600" : "text-slate-500")}>
                  {status === "active" ? c("statusActive") : c("statusDisabled")}
                </span>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <StatCard icon={Users} label={c("colDrivers")} value={company.driver_count} />
                <StatCard icon={Radio} label={c("colOffers")} value={company.offer_count} />
                <StatCard icon={Plug} label={c("colSession")} value={company.session_status ? c(`session_${company.session_status}`) : c("noSession")} />
              </div>

              {/* Edit info */}
              <Section title={c("info")}>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={c("fieldName")} value={name} onChange={setName} />
                  <Field label={c("fieldCountry")} value={country} onChange={setCountry} />
                </div>
              </Section>

              {/* Proxy — assigned from the shared pool */}
              <Section title={c("proxy")}>
                <p className="mb-2 text-xs text-slate-400">{c("proxyPoolHint")}</p>
                <Select
                  value={proxyId}
                  onChange={setProxyId}
                  options={[
                    { value: "", label: c("proxyNone") },
                    ...proxies.map((p) => ({
                      value: String(p.id),
                      label: `${p.label} (${p.used}/${p.capacity})`,
                      disabled: p.free <= 0 && String(p.id) !== proxyId,
                    })),
                  ]}
                />
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

              {/* Enable/disable lives in the status toggle at the top of the panel,
                  so no separate disable button here. */}
              <div className="flex justify-end">
                <Button onClick={saveInfo} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {c("save")}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        open={resetFor !== null}
        onClose={() => setResetFor(null)}
        title={c("resetPassword")}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setResetFor(null)} disabled={busy}>
              {c("cancel")}
            </Button>
            <Button onClick={submitReset} disabled={busy || resetPwd.length < 8}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {c("resetPassword")}
            </Button>
          </div>
        }
      >
        <div className="text-start">
          <label className="mb-1 block text-sm font-medium text-slate-700">{c("newPasswordLabel")}</label>
          <input
            type="password"
            value={resetPwd}
            onChange={(e) => setResetPwd(e.target.value)}
            minLength={8}
            autoFocus
            placeholder={c("newPasswordHint")}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </Modal>

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

/** Lazy-loaded drill-down list for a company's drivers / offers / vehicles. */
function CompanyDataTab({ id, tab }: { id: number; tab: "drivers" | "vehicles" }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.companies.${k}`);
  const [rows, setRows] = useState<CompanyDriverRow[] | CompanyVehicleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const p = tab === "drivers" ? getCompanyDrivers(id) : getCompanyVehicles(id);
    p.then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, tab]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">{c("noData")}</p>;
  }

  if (tab === "drivers") {
    return (
      <ul className="divide-y divide-slate-100">
        {(rows as CompanyDriverRow[]).map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${d.online ? "bg-emerald-500" : "bg-slate-300"}`} />
              <span className="text-sm font-medium text-slate-800">{d.name}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              {d.rating != null && <span>★ {d.rating}</span>}
              {d.total_trips != null && <span>{d.total_trips.toLocaleString(locale)} {c("trips")}</span>}
              <Badge status={d.uber_linked ? "connected" : "neutral"} dot>{d.uber_linked ? c("linked") : c("unlinked")}</Badge>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {(rows as CompanyVehicleRow[]).map((v) => (
        <li key={v.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
          <span className="font-medium text-slate-800">
            {[v.make, v.model, v.year].filter(Boolean).join(" ") || "—"}
          </span>
          <span className="font-mono text-xs text-slate-500" dir="ltr">{v.license_plate ?? "—"}</span>
        </li>
      ))}
    </ul>
  );
}

/** Company offers grouped by day, paginated (mirrors the manager offers page). */
function CompanyOffersTab({ id }: { id: number }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.companies.${k}`);
  const [rows, setRows] = useState<CompanyOfferRow[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set([new Date().toDateString()]));
  const toggleDay = (k: string) =>
    setOpenDays((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getCompanyOffers(id, page)
      .then((r) => {
        if (!alive) return;
        setRows(r.items);
        setLastPage(r.lastPage);
      })
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, page]);

  const groups = useMemo(() => {
    const m = new Map<string, CompanyOfferRow[]>();
    for (const o of rows) {
      const key = o.received_at ? new Date(o.received_at).toDateString() : "—";
      (m.get(key) ?? m.set(key, []).get(key)!).push(o);
    }
    return [...m.entries()];
  }, [rows]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">{c("noData")}</p>;
  }

  return (
    <div className="space-y-4">
      {groups.map(([day, dayOffers]) => {
        const open = openDays.has(day);
        return (
          <div key={day} className="overflow-hidden rounded-lg border border-slate-100">
            <button
              onClick={() => toggleDay(day)}
              className="flex w-full items-center gap-2 bg-slate-50 px-4 py-2.5 text-start hover:bg-slate-100"
            >
              <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? "" : "-rotate-90"}`} />
              <span className="font-semibold text-slate-800">
                {day === new Date().toDateString() ? c("today") : day === "—" ? "—" : new Date(day).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600">{dayOffers.length}</span>
            </button>
            {open && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {dayOffers.map((o) => (
                      <tr key={o.id}>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">
                          {o.received_at ? new Date(o.received_at).toLocaleTimeString(locale) : "—"}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-700">{o.driver_name ?? "—"}</td>
                        <td className="max-w-[220px] truncate px-4 py-2.5 text-slate-500">{o.pickup_address ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-900">{o.fare_formatted ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          <Badge status={o.accepted ? "connected" : "neutral"} dot>{o.accepted ? c("accepted") : c("notAccepted")}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {lastPage > 1 && (
        <div className="flex items-center justify-end gap-2 pt-1 text-sm">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40">
            {c("prev")}
          </button>
          <span className="text-slate-600">{page} / {lastPage}</span>
          <button onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40">
            {c("next")}
          </button>
        </div>
      )}
    </div>
  );
}
