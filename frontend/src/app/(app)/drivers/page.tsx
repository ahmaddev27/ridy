"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users, Star, RefreshCw, Send, Smartphone, Loader2, Bell, Mail, Check } from "lucide-react";
import { PageHead, SkelRows, ModalShell, Av, Who } from "@/components/ui/rd";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/utils";
import { useAsync } from "@/hooks/use-async";
import { listDrivers, syncDrivers, inviteDriver, testDriverPush, updateDriverEmail, setDriverManager, type Driver } from "@/lib/api/drivers";
import { Switch } from "@/components/ui/switch";
import { apiErrorMessage } from "@/lib/api/error-message";
import { syncRosterViaExtension, fetchDriverStatusesViaExtension } from "@/lib/extension";
import { useAuth } from "@/components/auth/auth-provider";
import { AdBanner } from "@/components/ads/ad-banner";

export default function DriversPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { user } = useAuth();
  const extensionRetired = user?.tenant?.extension_retired === true;
  // Poll the (cheap, DB-backed) roster list so linked/status changes surface
  // without a manual refresh. The heavier Uber pull still runs only on mount.
  const { data, loading, error, refetch } = useAsync(listDrivers, { refetchInterval: 15000 });
  const drivers = data ?? [];
  const [syncing, setSyncing] = useState(false);
  const [invitingId, setInvitingId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [emailDriver, setEmailDriver] = useState<Driver | null>(null);
  const [emailValue, setEmailValue] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [inviteTarget, setInviteTarget] = useState<Driver | null>(null);
  const [managerBusyId, setManagerBusyId] = useState<number | null>(null);
  const didAutoSync = useRef(false);
  // Owner only (users.manage): a fleet manager must not promote drivers.
  const canPromote = user?.permissions?.includes("users.manage") ?? false;

  async function toggleManager(d: Driver) {
    setManagerBusyId(d.id);
    try {
      await setDriverManager(d.id, !d.is_manager);
      toast.success(t("screens.drivers.managerSaved"));
      await refetch();
    } catch (e) {
      toast.error(apiErrorMessage(e, t));
    } finally {
      setManagerBusyId(null);
    }
  }

  function openEmailModal(d: Driver) {
    setEmailDriver(d);
    setEmailValue(d.email ?? "");
  }

  async function saveEmail() {
    if (!emailDriver) return;
    setSavingEmail(true);
    try {
      await updateDriverEmail(emailDriver.id, emailValue.trim() || null);
      toast.success(t("screens.drivers.editEmailSaved"));
      await refetch();
      setEmailDriver(null);
    } catch (e) {
      toast.error(apiErrorMessage(e, t));
    } finally {
      setSavingEmail(false);
    }
  }

  async function testPush(d: Driver) {
    setTestingId(d.id);
    try {
      const r = await testDriverPush(d.id);
      toast.success(t("screens.drivers.appTestSent"));
      if (r.devices === 0) toast.info(t("screens.drivers.appNoDevices"));
    } catch (e) {
      const msg = e instanceof Error && e.message === "no_devices"
        ? t("screens.drivers.appNoDevices")
        : t("screens.drivers.appTestError");
      toast.error(msg);
    } finally {
      setTestingId(null);
    }
  }

  async function invite(d: Driver) {
    // The backend falls back to the Uber email when there's no login email yet,
    // so only block when neither exists.
    if (!d.email && !d.uber_email) {
      toast.error(t("screens.drivers.appNoEmail"));
      return;
    }
    setInvitingId(d.id);
    try {
      await inviteDriver(d.id);
      toast.success(t("screens.drivers.appInviteSent"));
      await refetch();
    } catch {
      toast.error(t("screens.drivers.appInviteError"));
    } finally {
      setInvitingId(null);
    }
  }

  // Migrated companies: roster and presence are synced server-side; this just
  // asks the backend for a fresh pull (best-effort) and re-reads the list.
  async function runServerSync() {
    const res = await syncDrivers().catch(() => null);
    if (res?.reason === "not_connected") {
      toast.error(t("screens.drivers.connectFirst"));
      return;
    }
    if (res?.reason === "org_mismatch") {
      toast.error(t("screens.drivers.orgMismatch"));
      return;
    }
    await refetch();
  }

  // Extension companies: the browser extension pulls the roster from
  // supplier.uber.com using the manager's real IP (Uber blocks our server).
  async function runExtensionSync() {
    try {
      const viaExt = await syncRosterViaExtension();

      // The backend refuses a roster pull unless the company has connected its
      // own Uber account (and only its own fleet) — surface a clear localized
      // message instead of failing silently or showing a raw error code.
      if (viaExt && !viaExt.ok && viaExt.reason === "not_connected") {
        toast.error(t("screens.drivers.connectFirst"));
        return;
      }
      if (viaExt && !viaExt.ok && viaExt.reason === "org_mismatch") {
        toast.error(t("screens.drivers.orgMismatch"));
        return;
      }

      // Fall back to the server-side pull only when no extension answered.
      if (viaExt === null) {
        await syncDrivers();
      }

      const fresh = await refetch();
      await refreshStatuses(fresh ?? []);
    } catch {
      /* best-effort — the cached roster stays visible */
    }
  }

  // Refresh live online/offline presence for the given drivers (extension path).
  async function refreshStatuses(list: Driver[]) {
    const uuids = list.map((d) => d.uber_driver_uuid).filter((u): u is string => Boolean(u));
    if (uuids.length === 0) return;
    const res = await fetchDriverStatusesViaExtension(uuids);
    if (res?.ok) await refetch();
  }

  async function runSync() {
    setSyncing(true);
    try {
      if (extensionRetired) await runServerSync();
      else await runExtensionSync();
    } finally {
      setSyncing(false);
    }
  }

  // Stale-while-revalidate: show the cached roster instantly, then silently
  // ask for a fresh one on open — at most once every few minutes.
  useEffect(() => {
    if (didAutoSync.current || !data) return;
    didAutoSync.current = true;
    const KEY = "drivers-autosync-at";
    const last = Number(localStorage.getItem(KEY) || 0);
    if (Date.now() - last > 3 * 60 * 1000) {
      localStorage.setItem(KEY, String(Date.now()));
      runSync();
    } else if (!extensionRetired) {
      refreshStatuses(data); // cheap presence refresh even when the roster is fresh
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const d_ = (k: string) => t(`screens.drivers.${k}`);
  const r_ = (k: string) => t(`screens.remake.${k}`);

  return (
    <>
      <PageHead
        title={t("pages.drivers.title")}
        sub={t("pages.drivers.subtitle")}
        actions={
          <button type="button" className="btn btn-secondary" onClick={runSync} disabled={syncing}>
            <RefreshCw style={syncing ? { animation: "ofr-spin 1s linear infinite" } : undefined} />
            {syncing ? d_("refreshing") : d_("refreshFromUber")}
          </button>
        }
      />

      {/* Sponsored banner — full width, renders nothing when none live. */}
      <AdBanner />

      <section className="card table-card">
        {loading ? (
          <SkelRows rows={6} cols={5} />
        ) : error ? (
          <div className="callout danger" style={{ margin: 16 }}>
            <div>
              {d_("loadError")} — {error}
            </div>
          </div>
        ) : drivers.length === 0 ? (
          <EmptyState icon={Users} title={d_("emptyTitle")} description={d_("emptyDesc")} />
        ) : (
          <div className="ofr-tbl">
            <div className="table-wrap">
              <table className="tbl" style={{ minWidth: 1040 }}>
                <thead>
                  <tr>
                    <th>{d_("colName")}</th>
                    <th>{d_("colPhone")}</th>
                    <th>{d_("colRating")}</th>
                    <th>{d_("colTrips")}</th>
                    <th>{d_("colStatus")}</th>
                    <th>Uber</th>
                    {canPromote && <th>{d_("colManager")}</th>}
                    <th className="r">{d_("colApp")}</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d) => (
                    <tr key={d.id} className="clickable" onClick={() => router.push(`/drivers/${d.id}`)}>
                      <td>
                        <div className="who">
                          <DriverAvatar d={d} title={d.online ? d_("online") : d_("offline")} />
                          <div className="truncate">
                            {/* A real link so keyboard users can open the profile. */}
                            <Link href={`/drivers/${d.id}`} onClick={(e) => e.stopPropagation()} className="n truncate strong" style={{ display: "block" }}>
                              {d.name}
                              {d.is_manager && <span className="badge outline square" style={{ marginInlineStart: 8 }}>{d_("colManager")}</span>}
                            </Link>
                            {(d.email || d.uber_email) && <div className="s truncate">{d.email || d.uber_email}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="num nowrap" dir="ltr">{d.phone ?? "—"}</span>
                      </td>
                      <td>
                        {d.rating != null ? (
                          <span className="row" style={{ gap: 5 }}>
                            <span style={{ color: "var(--warning-dot)" }}>
                              <Star className="ico-sm" />
                            </span>
                            <span className="num">{d.rating.toFixed(2)}</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <span className="num">{d.total_trips != null ? formatNumber(d.total_trips, locale) : "—"}</span>
                      </td>
                      <td>
                        <span className={`badge ${d.active ? "success" : ""}`}>
                          <span className="dot" />
                          {d.active ? d_("active") : d_("inactive")}
                        </span>
                      </td>
                      <td>
                        {d.uber_linked ? (
                          <span className="badge square" style={{ background: "var(--primary)", color: "var(--primary-ink)" }}>{d_("linked")}</span>
                        ) : (
                          <span className="badge outline square">{d_("notLinked")}</span>
                        )}
                      </td>
                      {canPromote && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={d.is_manager === true}
                            onChange={() => void toggleManager(d)}
                            // The server refuses your own record too; this just avoids a dead control.
                            disabled={managerBusyId === d.id || (!!d.email && d.email.toLowerCase() === user?.email?.toLowerCase())}
                            label={d_("managerHint")}
                          />
                        </td>
                      )}
                      <td className="r" onClick={(e) => e.stopPropagation()}>
                        <AppCell
                          d={d}
                          t={t}
                          invitingId={invitingId}
                          testingId={testingId}
                          onEmail={() => openEmailModal(d)}
                          onInvite={() => setInviteTarget(d)}
                          onTest={() => testPush(d)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {emailDriver && (
        <ModalShell
          size="sm"
          icon={Mail}
          tone="info"
          title={d_("editEmailTitle")}
          sub={emailDriver.name}
          onClose={() => setEmailDriver(null)}
          body={
            <form
              id="drv-email-form"
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void saveEmail();
              }}
            >
              <div className="field">
                <label htmlFor="drv-email">{r_("email")}</label>
                <input
                  id="drv-email"
                  type="email"
                  autoFocus
                  className="input"
                  value={emailValue}
                  onChange={(e) => setEmailValue(e.target.value)}
                  placeholder={d_("editEmailPlaceholder")}
                />
                <span className="hint">{d_("editEmailHint")}</span>
              </div>
            </form>
          }
          foot={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setEmailDriver(null)} disabled={savingEmail}>
                {d_("cancel")}
              </button>
              <button type="submit" form="drv-email-form" className="btn btn-primary" disabled={savingEmail}>
                {savingEmail ? <Loader2 style={{ animation: "ofr-spin 1s linear infinite" }} /> : <Check />}
                <span>{d_("save")}</span>
              </button>
            </>
          }
        />
      )}

      {inviteTarget && (
        <ModalShell
          size="sm"
          icon={Send}
          tone="success"
          title={
            ["active", "invited", "invite_expired"].includes(inviteTarget.app_status ?? "")
              ? r_("inviteAgainTitle")
              : r_("inviteTitle")
          }
          onClose={() => setInviteTarget(null)}
          body={
            <>
              <p className="muted">
                {r_("inviteBody").replace("{email}", inviteTarget.email || inviteTarget.uber_email || "—")}
              </p>
              <Who name={inviteTarget.name} sub={<span dir="ltr">{inviteTarget.phone ?? ""}</span>} size="sm" />
            </>
          }
          foot={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setInviteTarget(null)}>
                {d_("cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const target = inviteTarget;
                  setInviteTarget(null);
                  void invite(target);
                }}
              >
                <Send />
                {["active", "invited", "invite_expired"].includes(inviteTarget.app_status ?? "") ? r_("inviteAgain") : r_("inviteSend")}
              </button>
            </>
          }
        />
      )}
    </>
  );
}

function DriverAvatar({ d, title }: { d: Driver; title: string }) {
  if (!d.picture_url) return <span title={title}><Av name={d.name} presence={d.online ? "online" : "offline"} /></span>;
  return (
    <span className="av-wrap" title={title}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={d.picture_url} alt="" className="av" style={{ objectFit: "cover" }} />
      <i className="st" style={{ background: d.online ? "var(--success-dot)" : "var(--neutral-dot)" }} />
    </span>
  );
}

/** The "App" column: login-email edit, invite state and (once active) resend + test push. */
function AppCell({
  d,
  t,
  invitingId,
  testingId,
  onEmail,
  onInvite,
  onTest,
}: {
  d: Driver;
  t: (k: string) => string;
  invitingId: number | null;
  testingId: number | null;
  onEmail: () => void;
  onInvite: () => void;
  onTest: () => void;
}) {
  const k = (key: string) => t(`screens.drivers.${key}`);
  const spin = { animation: "ofr-spin 1s linear infinite" };
  const mail = (
    <button type="button" className="icon-btn" onClick={onEmail} title={k("editEmail")} aria-label={k("editEmail")}>
      <Mail />
    </button>
  );
  const resend = (
    <button type="button" className="icon-btn" onClick={onInvite} disabled={invitingId === d.id} title={k("appResend")} aria-label={k("appResend")}>
      {invitingId === d.id ? <Loader2 style={spin} /> : <Send />}
    </button>
  );

  if (d.app_status === "active") {
    return (
      <>
        <div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {mail}
          <span className="badge success">
            <Smartphone />
            {k("appActive")}
          </span>
          {resend}
          <button type="button" className="icon-btn" onClick={onTest} disabled={testingId === d.id} title={k("appTest")} aria-label={k("appTest")}>
            {testingId === d.id ? <Loader2 style={spin} /> : <Bell />}
          </button>
        </div>
        {d.device_label && (
          <div className="subtle text-xs" style={{ textAlign: "end", marginTop: 4 }} title={k("appDevice")}>
            {d.device_label}
          </div>
        )}
      </>
    );
  }
  if (d.app_status === "invited" || d.app_status === "invite_expired") {
    const expired = d.app_status === "invite_expired";
    return (
      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
        {mail}
        <span className={`badge ${expired ? "" : "warning"}`}>
          <span className="dot" />
          {expired ? k("appInviteExpired") : k("appInvited")}
        </span>
        {resend}
      </div>
    );
  }
  return (
    <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
      {mail}
      <button type="button" className="btn btn-secondary btn-sm" onClick={onInvite} disabled={invitingId === d.id}>
        {invitingId === d.id ? <Loader2 style={spin} /> : <Send />}
        {k("appInvite")}
      </button>
    </div>
  );
}
