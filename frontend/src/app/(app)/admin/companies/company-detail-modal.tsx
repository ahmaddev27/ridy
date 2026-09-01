"use client";

import { useEffect, useMemo, useState } from "react";
import { latnLocale } from "@/lib/utils";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Save, KeyRound, RefreshCw, Trash2, UserPlus, Ticket, ShieldCheck, ChevronDown, Info, Users, Car, Radio, Plug , Gift, LogIn, Globe, Network, Copy, Files } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { PasswordInput } from "@/components/ui/password-input";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { useI18n } from "@/lib/i18n/context";
import {
  getCompany,
  updateCompany,
  setCompanyActive,
  createCompanyUser,
  resetCompanyUserPassword,
  forceRelink,
  deleteCompanySession,
  purgeCompanyData,
  startImpersonation,
  generateActivationCode,
  grantFreeSubscription,
  reactivateCompany,
  endCompanySubscription,
  listProxies,
  getCompanyDrivers,
  getCompanyOffers,
  getCompanyVehicles,
  getCompanyNetwork,
  clearCompanyNetwork,
  type CompanyNetworkRow,
  listSubscriptionInvoices,
  listPlans,
  type Company,
  type Proxy,
  type CompanyDriverRow,
  type CompanyOfferRow,
  type CompanyVehicleRow,
  type SubscriptionInvoice,
  type Plan,
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
  const [tab, setTab] = useState<"details" | "subscription" | "managers" | "drivers" | "offers" | "vehicles" | "network">("details");

  // Sub-actions.
  const [confirm, setConfirm] = useState<null | "disable" | "relink" | "deleteSession" | "purgeData">(null);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "" });

  // Subscription/activation — a code is generated against a plan, paid optional.
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState("");
  const [paid, setPaid] = useState(true);
  const [freeDays, setFreeDays] = useState("30");
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);

  // The company's subscription history + the plans to choose from, for the tab.
  useEffect(() => {
    if (tab !== "subscription") return;
    listSubscriptionInvoices(id).then((r) => setInvoices(r.data)).catch(() => setInvoices([]));
    listPlans().then(setPlans).catch(() => setPlans([]));
  }, [tab, id]);
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
      // Localize the common "email already taken" validation instead of showing
      // Laravel's raw English message.
      const msg = e instanceof Error ? e.message : "";
      const desc = /already been taken/i.test(msg) ? c("emailTaken") : msg || undefined;
      toast.error(c("userCreateFailed"), { description: desc });
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
      const res = await generateActivationCode(id, Number(planId), paid);
      setGenCode(res.code);
      toast.success(c("codeGenerated"));
      await load();
    } catch (e) {
      toast.error(c("codeFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function grantFree() {
    setBusy(true);
    try {
      await grantFreeSubscription(id, Number(freeDays) || 1);
      toast.success(c("freeGranted"));
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
      // Proper end: cancels queued periods + closes the running one, not just a
      // date bump (which would leave stacked future periods dangling).
      await endCompanySubscription(id);
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

  async function loginAsCompany() {
    setBusy(true);
    try {
      await startImpersonation(id);
      toast.success(c("impersonateStarted"));
      // Full reload: the session identity changed, so every cached query must
      // refetch as the manager. Client-side navigation would keep stale data.
      window.location.assign("/");
    } catch (e) {
      toast.error(c("impersonateFailed"), { description: e instanceof Error ? e.message : undefined });
      setBusy(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    if (confirm === "purgeData") {
      await runPurge();
      return;
    }
    setBusy(true);
    try {
      if (confirm === "disable") await setCompanyActive(id, false); // reversible, never deletes
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

  async function runPurge() {
    setBusy(true);
    try {
      const counts = await purgeCompanyData(id);
      const summary = c("purgedCounts")
        .replace("{drivers}", String(counts.drivers))
        .replace("{vehicles}", String(counts.vehicles))
        .replace("{offers}", String(counts.offers))
        .replace("{devices}", String(counts.device_tokens))
        .replace("{metrics}", String(counts.driver_metrics))
        .replace("{sessions}", String(counts.sessions));
      toast.success(c("purgedToast"), { description: summary });
      await load();
      onChanged();
    } catch (e) {
      toast.error(c("purgeFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <div className="w-full text-start">
      {/* Header with back link */}
      <div className="mb-5 flex items-center gap-3">
        <Link href="/admin/companies" className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-2 hover:text-ink">
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
        </Link>
        <h1 className="text-xl font-bold text-ink">{company?.name ?? c("company")}</h1>
        {company?.state !== undefined && company?.state !== null && (
          <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning-fg">
            {c(`sub_${company.state}`)}
          </span>
        )}
      </div>

      {/* Side tabs (start side = right in RTL, left in LTR) + content */}
      <div className="flex flex-col gap-4 md:flex-row">
        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-line/70 bg-surface-2 p-1.5 md:h-fit md:w-56 md:flex-col md:gap-1">
          {([
            { k: "details", icon: Info },
            { k: "subscription", icon: Ticket },
            { k: "managers", icon: ShieldCheck },
            { k: "drivers", icon: Users },
            { k: "offers", icon: Radio },
            { k: "network", icon: Network },
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
                    ? "bg-primary text-primary-ink shadow-sm"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink")
                }
              >
                <Icon className={"h-4 w-4 shrink-0 " + (active ? "text-primary-ink" : "text-ink-subtle group-hover:text-ink-muted")} />
                {c(`tab_${tk}`)}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 space-y-6 rounded-2xl border border-line bg-surface p-5 shadow-sm">
          {error ? (
            <div className="text-sm text-danger-fg">{error}</div>
          ) : !company ? (
            <div className="flex items-center justify-center py-10 text-ink-subtle">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : tab === "offers" ? (
            <CompanyOffersTab id={id} />
          ) : tab === "network" ? (
            <CompanyNetworkTab id={id} />
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
                    <span className="text-ink-muted">{c("daysLeft").replace("{n}", String(company.days_left))}</span>
                  )}
                  {company.subscription_ends_at && (
                    <span className="text-xs text-ink-subtle" dir="ltr">
                      → {new Date(company.subscription_ends_at).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <p className="text-xs text-ink-subtle">{c("activationHint")}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[200px] flex-1">
                    <label className="mb-1 block text-xs font-medium text-ink-muted">{c("plan")}</label>
                    <select
                      value={planId}
                      onChange={(e) => setPlanId(e.target.value)}
                      className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink"
                    >
                      <option value="">{c("selectPlan")}</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} · €{p.price.toFixed(2)} · {c("daysN").replace("{n}", String(p.duration_days))}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex h-[38px] cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm text-ink-muted">
                    <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4" />
                    {c("markPaid")}
                  </label>
                  <Button variant="secondary" onClick={genActivation} disabled={busy || !planId}>
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

                {/* Free subscription — activates the company with no code/invoice. */}
                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line bg-surface-2/40 p-3">
                  <div className="w-28">
                    <label className="mb-1 block text-xs font-medium text-ink-muted">{c("freeDays")}</label>
                    <input
                      type="number"
                      min={1}
                      value={freeDays}
                      onChange={(e) => setFreeDays(e.target.value)}
                      className="w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink"
                    />
                  </div>
                  <Button variant="secondary" onClick={grantFree} disabled={busy || !(Number(freeDays) > 0)}>
                    <Gift className="h-4 w-4" /> {c("grantFree")}
                  </Button>
                  <p className="flex-1 text-xs text-ink-subtle">{c("freeHint")}</p>
                </div>

                {genCode && (
                  <div className="rounded-lg border border-emerald-200 bg-success-bg px-3 py-2 text-sm text-emerald-800">
                    {c("codeIs")}{" "}
                    <span className="font-mono text-lg font-bold tracking-widest" dir="ltr">{genCode}</span>
                    <span className="ms-2 text-xs text-success-fg">{c("codeValid")}</span>
                  </div>
                )}

                {/* Subscription history (invoices) for this company */}
                <div className="mt-2">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">{c("subHistory")}</h4>
                  {invoices.length === 0 ? (
                    <p className="rounded-lg bg-surface-2 px-3 py-3 text-sm text-ink-subtle">{c("subHistoryEmpty")}</p>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-line">
                      <table className="w-full text-sm">
                        <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-subtle [&_th]:px-3 [&_th]:py-2 [&_th]:text-start">
                          <tr>
                            <th>{c("subHistPeriod")}</th>
                            <th>{c("days")}</th>
                            <th>{c("amount")}</th>
                            <th>{c("subHistStatus")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line [&_td]:px-3 [&_td]:py-2">
                          {invoices.map((inv) => (
                            <tr key={inv.id}>
                              <td className="text-ink-muted" dir="ltr">
                                {new Date(inv.starts_at).toLocaleDateString()} → {new Date(inv.ends_at).toLocaleDateString()}
                              </td>
                              <td className="tabular-nums text-ink-muted">{inv.days}</td>
                              <td className="font-semibold tabular-nums text-ink">{inv.amount != null ? `€${inv.amount.toFixed(2)}` : "—"}</td>
                              <td>
                                <span className={"rounded-full px-2 py-0.5 text-xs font-semibold " + (inv.paid ? "bg-success-bg text-success-fg" : "bg-warning-bg text-warning-fg")}>
                                  {inv.paid ? c("subPaid") : c("subUnpaid")}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
            </Section>
          ) : tab === "managers" ? (
            <Section title={c("managers")}>
              <div className="divide-y divide-line rounded-lg border border-line">
                {(company.users ?? []).map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">{u.name}</div>
                      <div className="truncate text-xs text-ink-subtle">{u.email}</div>
                      {u.phone && (
                        <a href={`tel:${u.phone}`} className="text-xs font-medium text-ink-muted hover:text-ink" dir="ltr">{u.phone}</a>
                      )}
                    </div>
                    <Button variant="ghost" onClick={() => { setResetFor(u.id); setResetPwd(""); }}>
                      <KeyRound className="h-4 w-4" /> {c("resetPassword")}
                    </Button>
                  </div>
                ))}
                {(company.users ?? []).length === 0 && (
                  <div className="px-3 py-3 text-sm text-ink-subtle">{c("noManagers")}</div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input placeholder={c("fieldManagerName")} value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  className="rounded-lg border border-line-strong px-2 py-2 text-sm outline-none focus:border-ink" />
                <input placeholder={c("fieldManagerEmail")} type="email" value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="rounded-lg border border-line-strong px-2 py-2 text-sm outline-none focus:border-ink" />
                <PasswordInput placeholder={c("fieldManagerPassword")} value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
              </div>
              <Button variant="secondary" onClick={addUser} disabled={busy || !newUser.email}>
                <UserPlus className="h-4 w-4" /> {c("addManager")}
              </Button>
            </Section>
          ) : (
            <>
              {/* One calm form: flat groups, two per row on desktop, no nested cards. */}
              <div className="grid gap-x-8 gap-y-7 md:grid-cols-2">
                {/* Status — active toggle + three flat stat tiles (full width) */}
                <Group title={c("colStatus")} className="md:col-span-2">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={status === "active"}
                      onClick={() => setStatus(status === "active" ? "disabled" : "active")}
                      className={
                        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors " +
                        (status === "active" ? "bg-emerald-500" : "bg-ink-subtle")
                      }
                    >
                      <span
                        className={
                          "inline-block h-5 w-5 transform rounded-full bg-surface shadow transition-transform " +
                          (status === "active" ? "translate-x-[22px] rtl:-translate-x-[22px]" : "translate-x-0.5 rtl:-translate-x-0.5")
                        }
                      />
                    </button>
                    <span className={"text-sm font-medium " + (status === "active" ? "text-success-fg" : "text-ink-muted")}>
                      {status === "active" ? c("statusActive") : c("statusDisabled")}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <StatTile icon={Plug} label={c("colSession")} value={company.session_status ? c(`session_${company.session_status}`) : c("noSession")} />
                    <StatTile icon={Radio} label={c("colOffers")} value={company.offer_count} />
                    <StatTile icon={Users} label={c("colDrivers")} value={company.driver_count} />
                  </div>
                </Group>

                {/* Details — name + country */}
                <Group title={c("info")}>
                  <Field label={c("fieldName")} value={name} onChange={setName} />
                  <Field label={c("fieldCountry")} value={country} onChange={setCountry} />
                </Group>

                {/* Residential proxy — assigned from the shared pool */}
                <Group title={c("proxy")}>
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
                  <p className="text-xs text-ink-subtle">{c("proxyPoolHint")}</p>
                </Group>

                {/* Uber session controls */}
                <Group title={c("session")}>
                  <p className="text-xs text-ink-subtle">{c("sessionHint")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setConfirm("relink")} disabled={busy || !company.session_status}>
                      <RefreshCw className="h-4 w-4" /> {c("forceRelink")}
                    </Button>
                    <Button variant="secondary" onClick={() => setConfirm("deleteSession")} disabled={busy || !company.session_status}>
                      <Trash2 className="h-4 w-4" /> {c("deleteSession")}
                    </Button>
                  </div>
                </Group>

                {/* Impersonate — swaps the SPA session to a manager. */}
                <Group title={c("impersonate")}>
                  <p className="text-xs text-ink-subtle">{c("impersonateHint")}</p>
                  <Button variant="secondary" onClick={loginAsCompany} disabled={busy}>
                    <LogIn className="h-4 w-4 rtl:rotate-180" /> {c("impersonate")}
                  </Button>
                </Group>

                {/* Danger zone — irreversible purge; flat but visually distinct. */}
                <Group title={c("dangerZone")} tone="danger">
                  <p className="text-xs text-danger-fg/80">{c("dangerZoneHint")}</p>
                  <Button variant="danger" onClick={() => setConfirm("purgeData")} disabled={busy}>
                    <Trash2 className="h-4 w-4" /> {c("purgeData")}
                  </Button>
                </Group>
              </div>

              {/* Save — enable/disable lives in the status toggle above. */}
              <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end border-t border-line bg-surface/95 px-5 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
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
          <label className="mb-1 block text-sm font-medium text-ink">{c("newPasswordLabel")}</label>
          <PasswordInput
            value={resetPwd}
            onChange={(e) => setResetPwd(e.target.value)}
            minLength={8}
            autoFocus
            placeholder={c("newPasswordHint")}
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
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

/** Flat, borderless section: a small uppercase title over its stacked controls.
 *  `danger` tone tints the title and adds a subtle inline-start rule — distinct
 *  without becoming a nested card. */
function Group({
  title,
  children,
  tone = "default",
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "default" | "danger";
  className?: string;
}) {
  const danger = tone === "danger";
  return (
    <section className={className}>
      <h3
        className={
          "mb-3 text-xs font-semibold uppercase tracking-wider " +
          (danger ? "text-danger-fg" : "text-ink-subtle")
        }
      >
        {title}
      </h3>
      <div className={"space-y-3 " + (danger ? "border-s-2 border-danger-ring/40 ps-3" : "")}>
        {children}
      </div>
    </section>
  );
}

/** Flat stat tile — a soft surface panel, no card border. */
function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-ink-subtle">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-ink">{value}</div>
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
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className={`w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-line ${mono ? "font-mono text-xs" : ""}`}
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
      <div className="flex items-center justify-center py-10 text-ink-subtle">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-subtle">{c("noData")}</p>;
  }

  if (tab === "drivers") {
    return (
      <ul className="divide-y divide-line">
        {(rows as CompanyDriverRow[]).map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${d.online ? "bg-emerald-500" : "bg-ink-subtle"}`} />
              <span className="text-sm font-medium text-ink">{d.name}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-ink-muted">
              {d.rating != null && <span>★ {d.rating}</span>}
              {d.total_trips != null && <span>{d.total_trips.toLocaleString(latnLocale(locale))} {c("trips")}</span>}
              <Badge status={d.uber_linked ? "connected" : "neutral"} dot>{d.uber_linked ? c("linked") : c("unlinked")}</Badge>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {(rows as CompanyVehicleRow[]).map((v) => (
        <li key={v.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
          <span className="font-medium text-ink">
            {[v.make, v.model, v.year].filter(Boolean).join(" ") || "—"}
          </span>
          <span className="font-mono text-xs text-ink-muted" dir="ltr">{v.license_plate ?? "—"}</span>
        </li>
      ))}
    </ul>
  );
}

/** Company offers grouped by day, paginated (mirrors the manager offers page). */
/** The raw supplier "network" feed — every captured Uber offer payload, expandable. */
function CompanyNetworkTab({ id }: { id: number }) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.companies.${k}`);
  const [rows, setRows] = useState<CompanyNetworkRow[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState(""); // YYYY-MM-DD (inclusive day)
  const [to, setTo] = useState(""); // YYYY-MM-DD (inclusive day)
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (rid: number) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(rid) ? n.delete(rid) : n.add(rid);
      return n;
    });

  // Filter chips — clicking a kind narrows the feed to that request type and
  // resets to the first page so the paginator stays consistent with the filter.
  const filters: { v: string; l: string }[] = [
    { v: "", l: c("filter_all") },
    { v: "offer", l: c("net_offer") },
    { v: "status", l: c("net_status") },
    { v: "roster", l: c("net_roster") },
    { v: "vehicle", l: c("net_vehicle") },
    { v: "earnerbreakdownsv2", l: c("net_earnings") },
    { v: "session", l: c("net_session") },
  ];
  const pick = (v: string) => {
    setKind(v);
    setPage(1);
  };

  // Copy a single payload, or every listed payload as one JSON array.
  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg);
    } catch {
      toast.error(c("copyFailed"));
    }
  };
  const copyOne = (o: CompanyNetworkRow) => copy(JSON.stringify(o.raw_payload, null, 2), c("copied"));
  const copyAll = () =>
    copy(JSON.stringify(rows.map((r) => r.raw_payload), null, 2), c("copiedAll").replace("{n}", String(rows.length)));

  const [clearing, setClearing] = useState(false);
  const clearNet = async () => {
    if (!confirm(c("clearNetConfirm"))) return;
    setClearing(true);
    try {
      const { deleted } = await clearCompanyNetwork(id);
      toast.success(c("clearNetDone").replace("{n}", deleted.toLocaleString()));
      setRows([]);
      setTotal(0);
      setLastPage(1);
      setPage(1);
    } catch {
      toast.error(c("clearNetFailed"));
    } finally {
      setClearing(false);
    }
  };

  // The day-level inputs map to inclusive datetime bounds: the whole "from" day
  // through the end of the "to" day, so a same-day range still returns its rows.
  const fromBound = from ? `${from}T00:00:00` : "";
  const toBound = to ? `${to}T23:59:59` : "";

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getCompanyNetwork(id, page, kind, fromBound, toBound)
      .then((r) => {
        if (!alive) return;
        setRows(r.items);
        setLastPage(r.lastPage);
        setTotal(r.total);
      })
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, page, kind, fromBound, toBound]);

  // Any date change resets to page 1 so the paginator stays valid.
  const onDateChange = (f: string, t2: string) => {
    setFrom(f);
    setTo(t2);
    setPage(1);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-subtle">{c("networkHint")}</p>

      {/* One filter bar: kind chips first, then the date-time range on the right. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {filters.map((f) => (
          <button
            key={f.v || "all"}
            onClick={() => pick(f.v)}
            className={
              "rounded-full px-3 py-1 text-xs font-medium transition " +
              (kind === f.v
                ? "bg-primary text-primary-ink"
                : "bg-surface-2 text-ink-muted hover:bg-surface-2 hover:text-ink")
            }
          >
            {f.l}
          </button>
        ))}

        <div className="ms-auto flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <DateRangeFilter from={from} to={to} onChange={onDateChange} />
          {rows.length > 0 && (
            <button
              onClick={copyAll}
              title={c("copyAll")}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 font-medium text-ink-muted transition hover:bg-surface-2 hover:text-ink"
            >
              <Files className="h-3.5 w-3.5" />
              {c("copyAll")}
            </button>
          )}
          {total > 0 && (
            <button
              onClick={clearNet}
              disabled={clearing}
              title={c("clearNet")}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 font-medium text-danger-fg transition hover:bg-danger-bg disabled:opacity-50"
            >
              {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {c("clearNet")}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-ink-subtle">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-subtle">{c("noData")}</p>
      ) : (
        rows.map((o) => {
        const isOpen = open.has(o.id);
        return (
          <div key={o.id} className="overflow-hidden rounded-lg border border-line">
            <button
              onClick={() => toggle(o.id)}
              className="flex w-full items-center gap-3 bg-surface-2 px-4 py-3 text-start hover:bg-surface-2"
            >
              <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                {
                  offer: "bg-primary/15 text-primary",
                  status: "bg-blue-500/15 text-blue-500",
                  roster: "bg-amber-500/15 text-amber-600",
                  vehicle: "bg-violet-500/15 text-violet-500",
                  metric: "bg-teal-500/15 text-teal-500",
                  session: "bg-rose-500/15 text-rose-500",
                  earnerbreakdownsv2: "bg-emerald-500/15 text-emerald-500",
                }[o.kind] ?? "bg-surface-2 text-ink-muted"
              }`}>{o.kind === "earnerbreakdownsv2" ? c("net_earnings") : ["offer", "status", "roster", "vehicle", "metric", "session"].includes(o.kind) ? c(`net_${o.kind}`) : o.kind}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{o.summary ?? "—"}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-subtle" dir="ltr">
                  {o.created_at && <span>{new Date(o.created_at).toLocaleString()}</span>}
                  {o.count !== null && <span>· {o.count}×</span>}
                </div>
              </div>
              <span
                role="button"
                tabIndex={0}
                title={c("copyOne")}
                onClick={(e) => { e.stopPropagation(); copyOne(o); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); copyOne(o); } }}
                className="shrink-0 rounded-md p-1.5 text-ink-subtle transition hover:bg-surface hover:text-ink"
              >
                <Copy className="h-4 w-4" />
              </span>
              <ChevronDown className={"h-4 w-4 shrink-0 text-ink-subtle transition-transform " + (isOpen ? "rotate-180" : "")} />
            </button>
            {isOpen && (
              <pre className="max-h-96 overflow-auto bg-surface px-4 py-3 text-xs leading-relaxed text-ink" dir="ltr">
                {JSON.stringify(o.raw_payload, null, 2)}
              </pre>
            )}
          </div>
        );
        })
      )}

      {lastPage > 1 && (
        <div className="flex items-center justify-center gap-1.5 border-t border-line pt-4 text-sm">
          {[
            { l: "«", go: () => setPage(1), off: page <= 1 },
            { l: "‹", go: () => setPage((p) => Math.max(1, p - 1)), off: page <= 1 },
          ].map((b) => (
            <button key={b.l} onClick={b.go} disabled={b.off}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-muted transition hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40">{b.l}</button>
          ))}
          <span className="px-3 font-medium tabular-nums text-ink-muted">{page} / {lastPage} · {total.toLocaleString()}</span>
          {[
            { l: "›", go: () => setPage((p) => Math.min(lastPage, p + 1)), off: page >= lastPage },
            { l: "»", go: () => setPage(lastPage), off: page >= lastPage },
          ].map((b) => (
            <button key={b.l} onClick={b.go} disabled={b.off}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-muted transition hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40">{b.l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

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
      <div className="flex items-center justify-center py-10 text-ink-subtle">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-subtle">{c("noData")}</p>;
  }

  return (
    <div className="space-y-4">
      {groups.map(([day, dayOffers]) => {
        const open = openDays.has(day);
        return (
          <div key={day} className="overflow-hidden rounded-lg border border-line">
            <button
              onClick={() => toggleDay(day)}
              className="flex w-full items-center gap-2 bg-surface-2 px-4 py-2.5 text-start hover:bg-surface-2"
            >
              <ChevronDown className={`h-4 w-4 text-ink-subtle transition ${open ? "" : "-rotate-90"}`} />
              <span className="font-semibold text-ink">
                {day === new Date().toDateString() ? c("today") : day === "—" ? "—" : new Date(day).toLocaleDateString(latnLocale(locale), { weekday: "long", day: "numeric", month: "long" })}
              </span>
              <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted">{dayOffers.length}</span>
            </button>
            {open && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-line">
                    {dayOffers.map((o) => (
                      <tr key={o.id}>
                        <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">
                          {o.received_at ? new Date(o.received_at).toLocaleTimeString(latnLocale(locale)) : "—"}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-ink">{o.driver_name ?? "—"}</td>
                        <td className="max-w-[220px] truncate px-4 py-2.5 text-ink-muted">{o.pickup_address ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-ink">{o.fare_formatted ?? "—"}</td>
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
            className="rounded-lg border border-line px-3 py-1.5 text-ink-muted hover:bg-surface-2 disabled:opacity-40">
            {c("prev")}
          </button>
          <span className="text-ink-muted">{page} / {lastPage}</span>
          <button onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage}
            className="rounded-lg border border-line px-3 py-1.5 text-ink-muted hover:bg-surface-2 disabled:opacity-40">
            {c("next")}
          </button>
        </div>
      )}
    </div>
  );
}
