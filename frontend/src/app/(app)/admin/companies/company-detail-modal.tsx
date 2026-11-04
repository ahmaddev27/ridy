"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate, formatDateTime, formatMoney, formatNumber, latnLocale, relTime, TOKEN_WARN_MS } from "@/lib/utils";
import { fleetDayKey, fleetYmd, formatYmd } from "@/lib/fleet-day";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Save, KeyRound, Power, Trash2, UserPlus, Ticket, ShieldCheck, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Info, Users, Car, Radio, Plug, Gift, LogIn, Network, Copy, Files, Check, Lock, Star, Ban } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge, type Status } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableCard } from "@/components/ui/table";
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
  getAutoRenewal,
  setAutoRenewal,
  type AutoRenewalState,
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
  getCompanySession,
  getCompanySessionBrowser,
  getCompanySessionOutages,
  type CompanySession,
  type SessionBrowserState,
  type SessionBrowserStatus,
  type SessionOutageSummary,
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
import { getPaymentMethods, PAYMENT_METHOD_KEYS, paymentMethodLabel } from "@/lib/api/payments";
import { apiErrorMessage } from "@/lib/api/error-message";
import { ApiError } from "@/lib/api/client";

/** Super-admin company detail as a full page: edit, proxy, users, session,
 *  subscription controls, plus drivers/offers/vehicles tabs. */
export function CompanyDetail({
  id,
  onChanged = () => {},
}: {
  id: number;
  onChanged?: () => void;
}) {
  const { t, locale } = useI18n();
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
  const [tab, setTab] = useState<"details" | "subscription" | "managers" | "drivers" | "offers" | "vehicles" | "network" | "session">("details");

  // Sub-actions.
  const [confirm, setConfirm] = useState<null | "disable" | "relink">(null);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "" });

  // Subscription/activation — a code is generated against a plan, paid optional.
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState("");
  const [paid, setPaid] = useState(true);
  const [freeDays, setFreeDays] = useState("30");
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [invoicesTotal, setInvoicesTotal] = useState(0);

  // Payment method recorded on the issued code — all known methods are selectable,
  // the ones enabled in settings are highlighted and one of them is pre-selected.
  const [payMethod, setPayMethod] = useState<string>(PAYMENT_METHOD_KEYS[0]);
  const [enabledMethods, setEnabledMethods] = useState<Set<string>>(new Set());

  // The company's subscription history + the plans to choose from, for the tab.
  useEffect(() => {
    if (tab !== "subscription") return;
    listSubscriptionInvoices({ tenantId: id, perPage: 100 })
      .then((r) => {
        setInvoices(r.data);
        setInvoicesTotal(r.meta.total);
      })
      .catch(() => setInvoices([]));
    listPlans().then(setPlans).catch(() => setPlans([]));
    getPaymentMethods()
      .then((m) => {
        const on = new Set<string>();
        if (m.bank) on.add("bank");
        if (m.cash) on.add("cash");
        setEnabledMethods(on);
        // Pre-select the first enabled method (falls back to the first known one).
        const first = PAYMENT_METHOD_KEYS.find((k) => on.has(k)) ?? PAYMENT_METHOD_KEYS[0];
        setPayMethod(first);
      })
      .catch(() => {});
  }, [tab, id]);
  const [genCode, setGenCode] = useState<string | null>(null);
  const [genRef, setGenRef] = useState<string | null>(null);
  const [genMethod, setGenMethod] = useState<string | null>(null);

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
      toast.error(c("saveFailed"), { description: apiErrorMessage(e, t, locale) });
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
      toast.error(c("resetFailed"), { description: apiErrorMessage(e, t, locale) });
    } finally {
      setBusy(false);
    }
  }

  async function genActivation() {
    setBusy(true);
    try {
      // Only record a method that is actually enabled in settings.
      const method = enabledMethods.has(payMethod) ? payMethod : null;
      const res = await generateActivationCode(id, Number(planId), paid, method);
      setGenCode(res.code);
      setGenRef(res.payment_ref);
      setGenMethod(res.payment_method);
      toast.success(c("codeGenerated"));
      await load();
    } catch (e) {
      toast.error(c("codeFailed"), { description: apiErrorMessage(e, t, locale) });
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
      toast.error(c("codeFailed"), { description: apiErrorMessage(e, t, locale) });
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
      toast.error(c("actionFailed"), { description: apiErrorMessage(e, t, locale) });
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
      toast.error(c("actionFailed"), { description: apiErrorMessage(e, t, locale) });
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
      toast.error(c("impersonateFailed"), { description: apiErrorMessage(e, t, locale) });
      setBusy(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === "disable") await setCompanyActive(id, false); // reversible, never deletes
      if (confirm === "relink") await forceRelink(id);
      toast.success(c("done"));
      await load();
      onChanged();
    } catch (e) {
      toast.error(c("actionFailed"), { description: apiErrorMessage(e, t, locale) });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const headBadgeSession: Record<string, Status> = { active: "connected", needs_relink: "expiring", expired: "error" };
  const proxyLabel = proxies.find((p) => p.id === company?.proxy_id)?.label ?? "—";

  return (
    <div className="stack w-full text-start">
      {/* Page header with back link */}
      <header className="ph">
        <div>
          <Link href="/admin/companies" className="back-link">
            <ArrowLeft />
            {c("allCompanies")}
          </Link>
          <h1>{c("company")}</h1>
          <p>{c("pageSubtitle")}</p>
        </div>
      </header>

      {/* Identity card: avatar, name, reference, status badges, key facts */}
      {company && (
        <section className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="row-wrap" style={{ gap: 14 }}>
            <span className={"av lg t" + (company.name.length % 6)} aria-hidden>
              {initials(company.name)}
            </span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row-wrap" style={{ gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{company.name}</h2>
                {company.payment_reference && (
                  <span
                    className="inline-flex items-center rounded-lg bg-surface-3 px-2 py-0.5 font-mono text-xs text-ink-muted"
                    dir="ltr"
                    title={t("screens.codes.yourReference")}
                  >
                    {company.payment_reference}
                  </span>
                )}
              </div>
              <div className="row-wrap" style={{ gap: 8, marginTop: 8 }}>
                {company.state === null ? (
                  <Badge status="connected" dot>{c("subActive")}</Badge>
                ) : (
                  <Badge status={company.state === "banned" || company.state === "disabled" ? "error" : "expiring"} dot>
                    {c(`sub_${company.state}`)}
                  </Badge>
                )}
                {company.session_status && (
                  <Badge status={headBadgeSession[company.session_status] ?? "gap"} dot>
                    {c(`session_${company.session_status}`)}
                  </Badge>
                )}
              </div>
            </div>
            <Button onClick={loginAsCompany} disabled={busy}>
              <LogIn className="h-4 w-4 rtl:rotate-180" /> {c("impersonate")}
            </Button>
          </div>
          <div
            className="grid"
            style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "14px 22px" }}
          >
            <Fact label={c("factCountry")} value={company.country ?? "—"} />
            <Fact label={c("proxy")} value={<span className="mono">{proxyLabel}</span>} />
            <Fact label={c("colDrivers")} value={<span className="num">{formatNumber(company.driver_count, locale)}</span>} />
            <Fact label={c("colOffers")} value={<span className="num">{formatNumber(company.offer_count, locale)}</span>} />
            <Fact
              label={c("factSubUntil")}
              value={<span className="num">{company.subscription_ends_at ? formatDate(company.subscription_ends_at, locale) : "—"}</span>}
            />
            <Fact
              label={c("colDispatchReject")}
              value={
                company.dispatch_reject_enabled ? (
                  <Badge status="info">{c("stateOn")}</Badge>
                ) : (
                  <Badge status="neutral">{c("stateOff")}</Badge>
                )
              }
            />
            <Fact
              label={c("colElProfessor")}
              value={
                <span className={!company.elprofessor_enabled ? "subtle" : company.elprofessor_connected ? "pos" : "warn"}>
                  {!company.elprofessor_enabled ? c("epClosed") : company.elprofessor_connected ? c("epConnected") : c("epOpenNotLinked")}
                </span>
              }
            />
          </div>
        </section>
      )}

      {/* Tabs + panel */}
      <div className="stack-sm">
        <div className="tabs" role="tablist">
          {([
            { k: "details", icon: Info },
            { k: "subscription", icon: Ticket },
            { k: "managers", icon: ShieldCheck },
            { k: "drivers", icon: Users },
            { k: "offers", icon: Radio },
            { k: "network", icon: Network },
            { k: "session", icon: Plug },
            { k: "vehicles", icon: Car },
          ] as const).map(({ k: tk, icon: Icon }) => (
            <button
              key={tk}
              type="button"
              role="tab"
              aria-selected={tab === tk}
              onClick={() => setTab(tk)}
              className={tab === tk ? "on" : ""}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              <Icon className="h-4 w-4" />
              <span>{c(`tab_${tk}`)}</span>
            </button>
          ))}
        </div>

        <div className="stack" role="tabpanel" style={{ paddingTop: 8 }}>
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
          ) : tab === "session" ? (
            <SessionTab
              id={id}
              company={company}
              busy={busy}
              onRelink={() => setConfirm("relink")}
            />
          ) : tab === "drivers" || tab === "vehicles" ? (
            <CompanyDataTab id={id} tab={tab} />
          ) : tab === "subscription" ? (
            <div className="stack">
              <div className="row-wrap" style={{ gap: 12 }}>
                {company.state === null ? (
                  <Badge status="connected" dot>{c("subActive")}</Badge>
                ) : (
                  <Badge status={company.state === "banned" || company.state === "disabled" ? "error" : "expiring"} dot>
                    {c(`sub_${company.state}`)}
                  </Badge>
                )}
                {company.days_left !== null && (
                  <b className="num">{c("daysLeft").replace("{n}", String(company.days_left))}</b>
                )}
                {company.subscription_ends_at && (
                  <span className="muted num" dir="ltr">
                    → {formatDate(company.subscription_ends_at, locale)}
                  </span>
                )}
              </div>

              <p className="muted text-sm">{c("activationHint")}</p>
              <div className="row-wrap" style={{ alignItems: "flex-end", gap: 14 }}>
                <div className="field" style={{ minWidth: 260, flex: 1 }}>
                  <label htmlFor="co-plan">{c("plan")}</label>
                  <select id="co-plan" value={planId} onChange={(e) => setPlanId(e.target.value)} className="select">
                    <option value="">{c("selectPlan")}</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.price, locale)} · {c("daysN").replace("{n}", String(p.duration_days))}</option>
                    ))}
                  </select>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ paddingBottom: 10 }}>
                  <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4" />
                  <span>{c("markPaid")}</span>
                </label>
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

              {/* How the company paid — only methods enabled in settings are
                  selectable; a disabled one is shown locked so the admin knows it
                  exists but must be turned on in settings first. */}
              <div className="row-wrap" style={{ gap: 12 }}>
                <span className="muted text-sm">{t("screens.codes.method")}</span>
                <div className="seg" role="group" aria-label={t("screens.codes.method")}>
                  {PAYMENT_METHOD_KEYS.map((m) => {
                    const on = enabledMethods.has(m);
                    const selected = on && payMethod === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={!on}
                        onClick={() => on && setPayMethod(m)}
                        title={on ? undefined : t("screens.codes.methodOff")}
                        className={selected ? "on" : ""}
                      >
                        {selected && <Check className="h-3.5 w-3.5" />}
                        {!on && <Lock className="h-3 w-3" />}
                        {paymentMethodLabel(m, t)}
                      </button>
                    );
                  })}
                </div>
                <Button variant="secondary" onClick={genActivation} disabled={busy || !planId}>
                  <Ticket className="h-4 w-4" /> {c("generateCode")}
                </Button>
              </div>
              {enabledMethods.size === 0 && (
                <p className="subtle text-xs">{t("screens.codes.methodNoneHint")}</p>
              )}

              {genCode && (
                <div
                  role="status"
                  className="flex flex-col gap-1 rounded-[var(--r-lg)] bg-success-bg px-4 py-3.5 text-success-fg"
                >
                  <span className="text-sm">{c("codeIs")}</span>
                  <span className="font-mono text-3xl font-semibold tracking-[0.22em] text-ink" dir="ltr">{genCode}</span>
                  <span className="text-sm">{c("codeValid")}</span>
                  {genRef && (
                    <span className="text-sm">
                      {c("codeRef")} <span className="font-mono font-semibold" dir="ltr">{genRef}</span>
                    </span>
                  )}
                  {genMethod && (
                    <span className="text-sm">
                      {t("screens.codes.method")}: <span className="font-semibold">{paymentMethodLabel(genMethod, t)}</span>
                    </span>
                  )}
                </div>
              )}

              {/* Free subscription — activates the company with no code/invoice. */}
              <div className="flex flex-col gap-2.5 rounded-[var(--r-lg)] border border-dashed border-line-strong px-4 py-3.5">
                <b>{c("freeTitle")}</b>
                <div className="row-wrap" style={{ alignItems: "flex-end", gap: 12 }}>
                  <div className="field" style={{ width: 140 }}>
                    <label htmlFor="co-free-days">{c("freeDays")}</label>
                    <input
                      id="co-free-days"
                      type="number"
                      min={1}
                      value={freeDays}
                      onChange={(e) => setFreeDays(e.target.value)}
                      className="input"
                    />
                  </div>
                  <Button variant="secondary" onClick={grantFree} disabled={busy || !(Number(freeDays) > 0)}>
                    <Gift className="h-4 w-4" /> {c("grantFree")}
                  </Button>
                </div>
                <span className="subtle text-sm">{c("freeHint")}</span>
              </div>

              {/* Subscription history (invoices) for this company */}
              <h3 className="section-title" style={{ marginTop: 6 }}>{c("subHistory")}</h3>
              {invoices.length === 0 ? (
                <p className="muted text-sm">{c("subHistoryEmpty")}</p>
              ) : (
                <TableCard>
                  <Table>
                    <thead>
                      <tr>
                        <th>{c("subHistPeriod")}</th>
                        <th className="r">{c("days")}</th>
                        <th className="r">{c("amount")}</th>
                        <th>{t("screens.codes.colRef")}</th>
                        <th>{t("screens.codes.method")}</th>
                        <th>{c("subHistStatus")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="num nowrap" dir="ltr">
                            {formatDate(inv.starts_at, locale)} → {formatDate(inv.ends_at, locale)}
                          </td>
                          <td className="r num">{inv.days}</td>
                          <td className="r num">{formatMoney(inv.amount, locale)}</td>
                          <td className="mono" dir="ltr">{inv.code?.payment_ref ?? "—"}</td>
                          <td>{paymentMethodLabel(inv.code?.payment_method, t)}</td>
                          <td>
                            <Badge status={inv.paid ? "connected" : "expiring"}>{inv.paid ? c("subPaid") : c("subUnpaid")}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {invoicesTotal > invoices.length && (
                    <div className="tbl-foot">
                      <span>
                        {t("common.showingOf").replace("{shown}", String(invoices.length)).replace("{total}", String(invoicesTotal))}
                      </span>
                      <Link href="/admin/reports" className="font-medium text-primary hover:underline">
                        {t("pages.subscriptions.title")}
                      </Link>
                    </div>
                  )}
                </TableCard>
              )}
            </div>
          ) : tab === "managers" ? (
            <div className="stack">
              <h3 className="section-title">{c("managers")}</h3>
              <div className="card">
                <div className="list-rows">
                  {(company.users ?? []).map((u) => (
                    <div key={u.id} className="list-row" style={{ flexWrap: "wrap" }}>
                      <div className="grow" style={{ minWidth: 200 }}>
                        <b>{u.name}</b>
                        <div className="row-wrap text-sm" style={{ gap: 12 }}>
                          <span className="subtle">{u.email}</span>
                          {u.phone && (
                            <a href={`tel:${u.phone}`} className="muted num hover:text-ink" dir="ltr">{u.phone}</a>
                          )}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => { setResetFor(u.id); setResetPwd(""); }}>
                        <KeyRound className="h-4 w-4" /> {c("resetPassword")}
                      </Button>
                    </div>
                  ))}
                  {(company.users ?? []).length === 0 && (
                    <p className="muted" style={{ padding: "16px 18px" }}>{c("noManagers")}</p>
                  )}
                </div>
              </div>
              <div className="g-3" style={{ alignItems: "end" }}>
                <div className="field">
                  <label htmlFor="mg-n">{c("fieldManagerName")}</label>
                  <input id="mg-n" placeholder={c("fieldManagerName")} value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} className="input" />
                </div>
                <div className="field">
                  <label htmlFor="mg-e">{c("fieldManagerEmail")}</label>
                  <input id="mg-e" placeholder={c("fieldManagerEmail")} type="email" value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="input" />
                </div>
                <div className="field">
                  <label htmlFor="mg-p">{c("fieldManagerPassword")}</label>
                  <PasswordInput id="mg-p" placeholder={c("fieldManagerPassword")} value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
                </div>
              </div>
              <div>
                <Button variant="secondary" onClick={addUser} disabled={busy || !newUser.email}>
                  <UserPlus className="h-4 w-4" /> {c("addManager")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Flat bordered groups, two per row on desktop. */}
              <div className="g-2">
                {/* Status — active toggle + three tiles + dispatch-reject callout (full width) */}
                <Group title={c("colStatus")} className="col-span-full">
                  <div className="row-wrap" style={{ gap: 10 }}>
                    <Switch
                      checked={status === "active"}
                      onChange={() => setStatus(status === "active" ? "disabled" : "active")}
                      label={c("statusActive")}
                    />
                    <b className={status === "active" ? "pos" : "muted"}>
                      {status === "active" ? c("statusActive") : c("statusDisabled")}
                    </b>
                  </div>

                  <div className="g-3">
                    <Tile label={c("colSession")} value={company.session_status ? c(`session_${company.session_status}`) : c("noSession")} />
                    <Tile label={c("colOffers")} value={formatNumber(company.offer_count, locale)} />
                    <Tile label={c("colDrivers")} value={formatNumber(company.driver_count, locale)} />
                  </div>

                  <div className="callout info">
                    <Ban className="h-4 w-4 shrink-0" />
                    <div>
                      <b>{c("drStateLine").replace("{state}", company.dispatch_reject_enabled ? c("stateOn") : c("stateOff"))}</b>{" "}
                      {c("drInfoBody")}{" "}
                      <Link href="/admin/companies" className="font-medium underline">{c("drInfoLink")}</Link>
                    </div>
                  </div>
                </Group>

                {/* Details — name + country */}
                <Group title={c("info")}>
                  <Field id="co-name" label={c("fieldName")} value={name} onChange={setName} />
                  <Field id="co-country" label={c("fieldCountry")} value={country} onChange={setCountry} />
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
                  <p className="subtle text-xs">{c("proxyPoolHint")}</p>
                </Group>

                {/* Impersonate — swaps the SPA session to a manager. */}
                <Group title={c("impersonate")}>
                  <p className="muted text-sm">{c("impersonateHint")}</p>
                  <div>
                    <Button variant="secondary" onClick={loginAsCompany} disabled={busy}>
                      <LogIn className="h-4 w-4 rtl:rotate-180" /> {c("impersonate")}
                    </Button>
                  </div>
                </Group>
              </div>

              {/* Save — enable/disable lives in the status toggle above. */}
              <div className="sticky bottom-0 flex justify-end pt-3" style={{ background: "linear-gradient(to top, var(--surface-solid) 70%, transparent)" }}>
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
        <div className="field text-start">
          <label>{c("newPasswordLabel")}</label>
          <PasswordInput
            value={resetPwd}
            onChange={(e) => setResetPwd(e.target.value)}
            minLength={8}
            autoFocus
            placeholder={c("newPasswordHint")}
          />
          <span className="hint">{c("newPasswordHint")}</span>
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

/** Two-letter initials for the identity avatar. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Label over value, used by the identity card's facts row. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="subtle text-xs">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

/** Bordered group: small uppercase title over its stacked controls.
 *  `danger` adds the inline-start rule from the prototype. */
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
    <section
      className={
        "flex flex-col gap-3 rounded-[var(--r-xl)] border border-line bg-surface px-[18px] py-4 " +
        (danger ? "border-s-[3px] border-s-[var(--danger-dot)] " : "") +
        className
      }
    >
      <h3 className="m-0 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-subtle">{title}</h3>
      {children}
    </section>
  );
}

/** Soft tile used for the status / session summaries. */
function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[var(--r-lg)] border border-line bg-surface-2 px-3 py-2.5">
      <div className="subtle text-xs">{label}</div>
      <div className="strong num mt-0.5 truncate">{value}</div>
    </div>
  );
}

/** Label left, value right, hairline between rows. */
function KvRow({ label, value, warn = false }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2.5 last:border-b-0">
      <span className="muted">{label}</span>
      <span className={"strong " + (warn ? "warn" : "")}>{value}</span>
    </div>
  );
}

/** Hours + minutes, Latin digits in every locale. */
function formatDowntime(seconds: number, c: (k: string) => string): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? c("outageHours").replace("{h}", String(h)).replace("{m}", String(m)) : c("outageMinutes").replace("{m}", String(m));
}

/** The Uber session: state, token lifetimes, actions and the 30-day outage history. */
function SessionTab({
  id,
  company,
  busy,
  onRelink,
}: {
  id: number;
  company: Company;
  busy: boolean;
  onRelink: () => void;
}) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.companies.${k}`);
  const [session, setSession] = useState<CompanySession>(null);
  const [loaded, setLoaded] = useState(false);

  // `company` is replaced by every load() after a relink/delete, so it doubles as the refetch trigger.
  useEffect(() => {
    let alive = true;
    getCompanySession(id)
      .then((s) => alive && setSession(s))
      .catch(() => alive && setSession(null))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [id, company]);

  const when = (iso: string | null) =>
    iso ? formatDateTime(iso, locale, { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" }) : "—";
  const statusLabel = (status: string) => {
    const label = c(`session_${status}`);
    return label.startsWith("screens.") ? status : label;
  };

  return (
    <div className="stack">
      <Group title={c("sessionState")}>
        {!loaded ? (
          <Loader2 className="h-4 w-4 animate-spin text-ink-subtle" />
        ) : !session ? (
          <p className="muted">{c("noSession")}</p>
        ) : (
          <div className="g-4">
            <Tile label={c("sessionStatus")} value={statusLabel(session.status)} />
            <Tile
              label={c("sessionOrg")}
              value={<span dir="ltr" className="mono break-all text-xs">{session.uber_org_uuid ?? "—"}</span>}
            />
            <Tile label={c("sessionExpires")} value={when(session.expires_at)} />
            <Tile label={c("sessionLastSeen")} value={relTime(session.last_event_at, locale, c("neverSeen"))} />
          </div>
        )}
      </Group>

      {session && (
        <Group title={c("tokens")}>
          <TokenRow label={c("tokenJwt")} iso={session.session_token_expires_at} when={when} neverAlarm hint={c("tokenJwtHint")} />
          <TokenRow label={c("tokenSupplier")} iso={session.supplier_token_expires_at} when={when} />
        </Group>
      )}

      <Group title={c("session")}>
        <p className="muted text-sm">{c("sessionHint")}</p>
        <div className="row-wrap">
          <Button variant="danger" onClick={onRelink} disabled={busy || !company.session_status}>
            <Power className="h-4 w-4" /> {c("stopSession")}
          </Button>
        </div>
      </Group>

      <Group title={c("pbTitle")}>
        <SessionBrowserCard id={id} company={company} />
      </Group>

      <Group title={c("arTitle")}>
        <AutoRenewalCard id={id} />
      </Group>

      <Group title={c("outagesTitle")}>
        <SessionOutages id={id} />
      </Group>
    </div>
  );
}

/** Variant B: super-admin switch for automatic Uber re-auth. The secret forwarding address is returned once on enable. */
function AutoRenewalCard({ id }: { id: number }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.companies.${k}`);
  const [state, setState] = useState<AutoRenewalState | null>(null);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    let alive = true;
    getAutoRenewal(id)
      .then((s) => {
        if (!alive) return;
        setState(s);
        setEmail(s.email ?? "");
      })
      .catch(() => alive && setState(null));
    return () => {
      alive = false;
    };
  }, [id]);

  const reasonText = (r: string | null) => (r ? c(`arReason_${r}`) : null);
  const refresh = async () => setState(await getAutoRenewal(id));

  async function enable() {
    setBusy(true);
    setReason(null);
    try {
      setAddress(await setAutoRenewal(id, { enabled: true, email: email.trim() }));
      toast.success(c("arEnabledToast"));
      await refresh();
    } catch (e) {
      const r = e instanceof ApiError && typeof e.data?.reason === "string" ? e.data.reason : null;
      if (r) setReason(r);
      else toast.error(c("arFailed"), { description: apiErrorMessage(e, t, locale) });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await setAutoRenewal(id, { enabled: false });
      toast.success(c("arDisabledToast"));
      setConfirmOff(false);
      await refresh();
    } catch (e) {
      toast.error(c("arFailed"), { description: apiErrorMessage(e, t, locale) });
    } finally {
      setBusy(false);
    }
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address ?? "");
      toast.success(c("arCopied"));
    } catch {
      toast.error(c("copyFailed"));
    }
  }

  if (!state) return <Loader2 className="h-4 w-4 animate-spin text-ink-subtle" />;
  const blocked = reasonText(state.blocker) ?? reasonText(reason);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge status={state.enabled ? "connected" : "neutral"} dot>{state.enabled ? c("arEnabled") : c("arDisabled")}</Badge>
      </div>
      <p className="text-xs text-ink-subtle">{c("arHint")}</p>
      <Field label={c("arEmail")} value={email} onChange={setEmail} placeholder="name@example.com" />
      <p className="text-xs text-ink-subtle">{c("arEmailHint")}</p>
      {blocked && <p className="text-xs text-warning-fg">{blocked}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={enable} disabled={busy || !state.eligible || email.trim() === ""}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {c("arEnable")}
        </Button>
        {state.enabled && (
          <Button variant="secondary" onClick={() => setConfirmOff(true)} disabled={busy}>
            {c("arDisable")}
          </Button>
        )}
      </div>

      <Modal
        open={address !== null}
        onClose={() => setAddress(null)}
        title={c("arAddressTitle")}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={copyAddress}>
              <Copy className="h-4 w-4" /> {c("arCopy")}
            </Button>
            <Button onClick={() => setAddress(null)}>{c("arDone")}</Button>
          </div>
        }
      >
        <div className="space-y-3 text-start">
          <p dir="ltr" className="break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-ink">{address}</p>
          <p className="text-sm font-medium text-warning-fg">{c("arAddressOnce")}</p>
          <p className="text-xs text-ink-subtle">{c("arAddressForward")}</p>
        </div>
      </Modal>

      <ConfirmModal
        open={confirmOff}
        danger
        title={c("arDisableTitle")}
        message={c("arDisableBody")}
        confirmLabel={c("confirm")}
        cancelLabel={c("cancel")}
        busy={busy}
        onConfirm={disable}
        onCancel={() => setConfirmOff(false)}
      />
    </div>
  );
}

const BROWSER_BADGE: Record<SessionBrowserState, string> = {
  active: "badge success",
  needs_otp: "badge warning",
  logging_in: "badge info",
  down: "badge danger",
  not_set_up: "badge",
};

/** Persistent session browser: state badge + last login/capture/seen, re-auth and error counters. */
function SessionBrowserCard({ id, company }: { id: number; company: Company }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.companies.${k}`);
  const [status, setStatus] = useState<SessionBrowserStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    getCompanySessionBrowser(id)
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus(null))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [id, company]);

  if (!loaded) return <Loader2 className="h-4 w-4 animate-spin text-ink-subtle" />;
  if (!status) return <p className="muted text-sm">{c("pbUnavailable")}</p>;

  const state: SessionBrowserState = status.state in BROWSER_BADGE ? status.state : "not_set_up";
  const stamp = (iso?: string | null) => relTime(iso ?? null, locale, c("pbNever"));
  const num = (n?: number | null) => (typeof n === "number" ? formatNumber(n, locale) : "—");
  const stale = state === "active" && status.is_live === false;
  const rows: [string, string, boolean][] = [
    [c("pbLastLogin"), stamp(status.last_login_at), false],
    [c("pbLastCapture"), stamp(status.last_capture_at), false],
    [c("pbLastSeen"), stamp(status.last_seen_at), false],
    [c("pbHardReauth"), num(status.hard_reauth_count), false],
    [c("pbErrors"), num(status.consecutive_errors), (status.consecutive_errors ?? 0) > 0],
  ];

  return (
    <div className="stack-sm">
      <div className="row-wrap" style={{ gap: 10 }}>
        <span className={BROWSER_BADGE[state]}>
          <span className="dot" />
          {c(`pb_${state}`)}
        </span>
        <span className="muted text-sm">{c("pbHint")}</span>
        {stale && <span className="warn text-xs">{c("pbStale")}</span>}
      </div>
      {state !== "not_set_up" && (
        <div>
          {rows.map(([label, value, warn]) => (
            <KvRow key={label} label={label} value={<span className="num">{value}</span>} warn={warn} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One Uber token's remaining life. An expired token is NOT a failure (it can run for days), so it stays muted; only an unexpired one under 12 h goes amber. */
function TokenRow({ label, iso, when, neverAlarm = false, hint }: { label: string; iso: string | null; when: (iso: string | null) => string; neverAlarm?: boolean; hint?: string }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.companies.${k}`);
  const ms = iso ? new Date(iso).getTime() : NaN;
  const known = Number.isFinite(ms);
  const left = ms - Date.now();
  const warn = !neverAlarm && known && left > 0 && left < TOKEN_WARN_MS;
  const key = left > 0 ? "tokenExpires" : "tokenExpired";
  const text = known ? c(key).replace("{t}", relTime(iso, locale, "")) : "—";
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2.5">
        <span className="muted">{label}</span>
        <span className={"strong " + (warn ? "warn" : "")} title={when(iso)}>
          {text}
        </span>
      </div>
      {hint && <p className="subtle mt-1 text-sm">{hint}</p>}
    </div>
  );
}

/** Uber session outages (last 30 days): how long offers were missing and how each was fixed. */
function SessionOutages({ id }: { id: number }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.companies.${k}`);
  const [summary, setSummary] = useState<SessionOutageSummary | null>(null);

  useEffect(() => {
    let alive = true;
    getCompanySessionOutages(id)
      .then((s) => alive && setSummary(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);

  if (!summary) return null;

  const stamp = (iso: string) => formatDateTime(iso, locale, { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
  const cause = (v: string) => {
    const label = c(`outageCause_${v}`);
    return label.startsWith("screens.") ? v : label;
  };

  return (
    <div className="stack-sm">
      <p className="muted text-sm">
        {summary.count === 0
          ? c("outagesNone")
          : c("outagesSummary").replace("{count}", String(summary.count)).replace("{total}", formatDowntime(summary.total_seconds, c))}
      </p>
      {summary.outages.length > 0 && (
        <div className="max-h-80 overflow-auto rounded-[var(--r-lg)] border border-line">
          <Table>
            <thead>
              <tr>
                {["outageStart", "outageEnd", "outageDuration", "outageCause", "outageRecovery"].map((k) => (
                  <th key={k} className={k === "outageDuration" ? "r" : ""}>{c(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.outages.map((o) => (
                <tr key={o.started_at}>
                  <td className="num nowrap">{stamp(o.started_at)}</td>
                  <td className={"num nowrap " + (o.ended_at ? "" : "neg strong")}>
                    {o.ended_at ? stamp(o.ended_at) : c("outageOngoing")}
                  </td>
                  <td className="r num nowrap">{formatDowntime(o.duration_seconds, c)}</td>
                  <td>{cause(o.cause)}</td>
                  <td className="text-sm">
                    {o.recovered_via ? c(`outageVia_${o.recovered_via}`) : "—"}
                    {o.relink_attempts > 1 ? ` · ${c("outageAttempts").replace("{n}", String(o.relink_attempts))}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  mono = false,
  placeholder,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className={"input" + (mono ? " mono" : "")}
      />
    </div>
  );
}

/** Lazy-loaded drill-down list for a company's drivers / vehicles. */
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
    return <p className="muted">{c("noData")}</p>;
  }

  if (tab === "drivers") {
    return (
      <div className="card">
        <div className="list-rows">
          {(rows as CompanyDriverRow[]).map((d) => (
            <div key={d.id} className="list-row" style={{ flexWrap: "wrap" }}>
              <span className="av-wrap">
                <span className={"av sm t" + (d.name.length % 6)} aria-hidden>{initials(d.name)}</span>
                <i className="st" style={{ background: d.online ? "var(--success-dot)" : "var(--neutral-dot)" }} />
              </span>
              <b className="grow">{d.name}</b>
              {d.rating != null && (
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 text-warning-ring" />
                  <span className="num">{formatNumber(d.rating, locale)}</span>
                </span>
              )}
              {d.total_trips != null && (
                <span className="muted num">{d.total_trips.toLocaleString(latnLocale(locale))} {c("trips")}</span>
              )}
              <Badge status={d.uber_linked ? "connected" : "neutral"} dot>{d.uber_linked ? c("linked") : c("unlinked")}</Badge>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="list-rows">
        {(rows as CompanyVehicleRow[]).map((v) => (
          <div key={v.id} className="list-row">
            <span className="av sm t4" aria-hidden><Car className="h-3.5 w-3.5" /></span>
            <b className="grow">{[v.make, v.model, v.year].filter(Boolean).join(" ") || "—"}</b>
            <span className="mono" dir="ltr">{v.license_plate ?? "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Per-kind tint for the network feed's type tag. */
const NET_KIND_CLASS: Record<string, string> = {
  offer: "bg-primary/15 text-primary",
  status: "bg-info-bg text-info-fg",
  roster: "bg-warning-bg text-warning-fg",
  vehicle: "bg-accent-bg text-accent-fg",
  metric: "bg-surface-3 text-ink-muted",
  session: "bg-danger-bg text-danger-fg",
  earnerbreakdownsv2: "bg-success-bg text-success-fg",
};

/** Shared first/prev/next/last pager used by the long, server-paged feeds. */
function EdgePager({ page, lastPage, total, onPage }: { page: number; lastPage: number; total?: number; onPage: (p: number) => void }) {
  const { t, locale } = useI18n();
  const flip = "rtl:rotate-180";
  return (
    <div className="flex items-center justify-center gap-1">
      <button type="button" className="icon-btn" aria-label={t("common.previousPage")} onClick={() => onPage(1)} disabled={page <= 1}>
        <ChevronsLeft className={flip} />
      </button>
      <button type="button" className="icon-btn" aria-label={t("common.previousPage")} onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>
        <ChevronLeft className={flip} />
      </button>
      <span className="num muted px-2 text-sm">
        {formatNumber(page, locale)} / {formatNumber(lastPage, locale)}
        {total != null ? ` · ${formatNumber(total, locale)}` : ""}
      </span>
      <button type="button" className="icon-btn" aria-label={t("common.nextPage")} onClick={() => onPage(Math.min(lastPage, page + 1))} disabled={page >= lastPage}>
        <ChevronRight className={flip} />
      </button>
      <button type="button" className="icon-btn" aria-label={t("common.nextPage")} onClick={() => onPage(lastPage)} disabled={page >= lastPage}>
        <ChevronsRight className={flip} />
      </button>
    </div>
  );
}

/** The raw supplier "network" feed — every captured Uber offer payload, expandable. */
function CompanyNetworkTab({ id }: { id: number }) {
  const { t, locale } = useI18n();
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
      toast.success(c("clearNetDone").replace("{n}", formatNumber(deleted, locale)));
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
    <div className="stack">
      <p className="muted text-sm">{c("networkHint")}</p>

      {/* One toolbar: kind chips first, then the date range and bulk actions. */}
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div className="row-wrap" role="group" aria-label={c("net_offer")}>
          {filters.map((f) => (
            <button
              key={f.v || "all"}
              type="button"
              onClick={() => pick(f.v)}
              aria-pressed={kind === f.v}
              className={"chip" + (kind === f.v ? " on" : "")}
            >
              {f.l}
            </button>
          ))}
        </div>

        <div className="row-wrap">
          <DateRangeFilter from={from} to={to} onChange={onDateChange} />
          {rows.length > 0 && (
            <Button variant="secondary" size="sm" onClick={copyAll} title={c("copyAll")}>
              <Files className="h-4 w-4" />
              {c("copyAll")}
            </Button>
          )}
          {total > 0 && (
            <Button variant="danger" size="sm" onClick={clearNet} disabled={clearing} title={c("clearNet")}>
              {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {c("clearNet")}
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-ink-subtle">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="muted">{c("noData")}</p>
      ) : (
        <div className="card overflow-hidden">
          <div className="list-rows">
            {rows.map((o) => {
              const isOpen = open.has(o.id);
              return (
                <div key={o.id}>
                  <button
                    type="button"
                    onClick={() => toggle(o.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-[18px] py-3 text-start hover:bg-surface-2"
                  >
                    <ChevronRight className={"h-4 w-4 shrink-0 text-ink-subtle transition-transform rtl:rotate-180 " + (isOpen ? "rotate-90 rtl:rotate-90" : "")} />
                    <span className={"shrink-0 rounded-md px-[7px] py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] " + (NET_KIND_CLASS[o.kind] ?? "bg-surface-3 text-ink-muted")}>
                      {o.kind === "earnerbreakdownsv2" ? c("net_earnings") : ["offer", "status", "roster", "vehicle", "metric", "session"].includes(o.kind) ? c(`net_${o.kind}`) : o.kind}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{o.summary ?? "—"}</div>
                      <div className="subtle mt-0.5 flex flex-wrap gap-x-3 text-xs" dir="ltr">
                        {o.created_at && <span>{formatDateTime(o.created_at, locale)}</span>}
                        {o.count !== null && <span>· {o.count}×</span>}
                      </div>
                    </div>
                    <span
                      role="button"
                      tabIndex={0}
                      title={c("copyOne")}
                      aria-label={c("copyOne")}
                      onClick={(e) => { e.stopPropagation(); copyOne(o); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); copyOne(o); } }}
                      className="icon-btn"
                      style={{ display: "inline-grid" }}
                    >
                      <Copy />
                    </span>
                  </button>
                  {isOpen && (
                    <pre className="max-h-96 overflow-auto border-t border-line bg-surface-2 px-[18px] py-3 text-xs leading-relaxed text-ink" dir="ltr">
                      {JSON.stringify(o.raw_payload, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lastPage > 1 && <EdgePager page={page} lastPage={lastPage} total={total} onPage={setPage} />}
    </div>
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
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set([fleetYmd()]));
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
      const key = o.received_at ? fleetDayKey(o.received_at) : "—";
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
    return <p className="muted">{c("noData")}</p>;
  }

  return (
    <div className="stack">
      <div className="stack-sm">
        {groups.map(([day, dayOffers]) => {
          const open = openDays.has(day);
          return (
            <div key={day} className="card overflow-hidden">
              <button
                type="button"
                onClick={() => toggleDay(day)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-[18px] py-3 text-start hover:bg-surface-2"
              >
                <ChevronRight className={"h-4 w-4 text-ink-subtle transition-transform rtl:rotate-180 " + (open ? "rotate-90 rtl:rotate-90" : "")} />
                <span className="grow font-semibold">
                  {day === fleetYmd() ? c("today") : day === "—" ? "—" : formatYmd(day, latnLocale(locale), { weekday: "long", day: "numeric", month: "long" })}
                </span>
                <span className="badge">{formatNumber(dayOffers.length, locale)}</span>
              </button>
              {open && (
                <div className="overflow-x-auto border-t border-line">
                  <Table>
                    <thead>
                      <tr>
                        <th>{c("colTime")}</th>
                        <th>{c("colDriver")}</th>
                        <th>{c("colPickup")}</th>
                        <th className="r">{c("colPrice")}</th>
                        <th>{c("colStatus")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayOffers.map((o) => (
                        <tr key={o.id}>
                          <td className="num nowrap">
                            {o.received_at ? new Date(o.received_at).toLocaleTimeString(latnLocale(locale)) : "—"}
                          </td>
                          <td>{o.driver_name ?? "—"}</td>
                          <td><div className="truncate" style={{ maxWidth: 260 }}>{o.pickup_address ?? "—"}</div></td>
                          <td className="r num strong">{o.fare_formatted ?? "—"}</td>
                          <td>
                            <Badge status={o.accepted ? "connected" : "neutral"} dot>{o.accepted ? c("accepted") : c("notAccepted")}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {lastPage > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            {c("prev")}
          </Button>
          <span className="num muted text-sm">{formatNumber(page, locale)} / {formatNumber(lastPage, locale)}</span>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage}>
            {c("next")}
          </Button>
        </div>
      )}
    </div>
  );
}
