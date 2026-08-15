"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users, Star, RefreshCw, Send, Smartphone, Loader2, Bell } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listDrivers, syncDrivers, inviteDriver, testDriverPush, type Driver } from "@/lib/api/drivers";
import { syncRosterViaExtension, fetchDriverStatusesViaExtension } from "@/lib/extension";

export default function DriversPage() {
  const { t } = useI18n();
  const router = useRouter();
  // Poll the (cheap, DB-backed) roster list so linked/status changes surface
  // without a manual refresh. The heavier Uber pull still runs only on mount.
  const { data, loading, error, refetch } = useAsync(listDrivers, { refetchInterval: 15000 });
  const drivers = data ?? [];
  const [syncing, setSyncing] = useState(false);
  const [invitingId, setInvitingId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const didAutoSync = useRef(false);

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
    if (!d.email) {
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

  async function runSync() {
    setSyncing(true);
    try {
      // Preferred path: the browser extension pulls the roster from
      // supplier.uber.com using the manager's real IP (Uber blocks our server).
      const viaExt = await syncRosterViaExtension();

      // Fall back to the server-side pull only when no extension answered.
      if (viaExt === null) {
        await syncDrivers();
      }

      await refetch();
      await refreshStatuses();
    } catch {
      /* best-effort — the cached roster stays visible */
    } finally {
      setSyncing(false);
    }
  }

  // Refresh live online/offline presence for the current drivers.
  async function refreshStatuses() {
    const list = await listDrivers().catch(() => []);
    const uuids = list.map((d) => d.uber_driver_uuid).filter((u): u is string => Boolean(u));
    const res = await fetchDriverStatusesViaExtension(uuids);
    if (res?.ok) await refetch();
  }

  // Stale-while-revalidate: show the cached roster instantly, then silently
  // pull a fresh one from Uber on open — but at most once every few minutes.
  useEffect(() => {
    if (didAutoSync.current) return;
    didAutoSync.current = true;
    const KEY = "drivers-autosync-at";
    const last = Number(localStorage.getItem(KEY) || 0);
    if (Date.now() - last > 3 * 60 * 1000) {
      localStorage.setItem(KEY, String(Date.now()));
      runSync();
    } else {
      refreshStatuses(); // cheap presence refresh even when the roster is fresh
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        tkey="drivers"
        action={
          <Button variant="secondary" onClick={runSync} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? t("screens.drivers.refreshing") : t("screens.drivers.refreshFromUber")}
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-danger-fg">{t("screens.drivers.loadError")} — {error}</div>
        ) : drivers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("screens.drivers.emptyTitle")}
            description={t("screens.drivers.emptyDesc")}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-subtle [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("screens.drivers.colName")}</th>
                  <th className="px-4 py-3 font-semibold">{t("screens.drivers.colPhone")}</th>
                  <th className="px-4 py-3 font-semibold">{t("screens.drivers.colRating")}</th>
                  <th className="px-4 py-3 font-semibold">{t("screens.drivers.colTrips")}</th>
                  <th className="px-4 py-3 font-semibold">{t("screens.drivers.colStatus")}</th>
                  <th className="px-4 py-3 font-semibold">Uber</th>
                  <th className="px-4 py-3 font-semibold">{t("screens.drivers.colApp")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {drivers.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => router.push(`/drivers/${d.id}`)}
                    className="cursor-pointer hover:bg-surface-2"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          {d.picture_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={d.picture_url}
                              alt=""
                              className="h-9 w-9 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-muted">
                              {d.name.slice(0, 1)}
                            </div>
                          )}
                          {/* Live online/offline dot */}
                          <span
                            className={`absolute -end-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-white ${
                              d.online ? "bg-emerald-500" : "bg-ink-subtle"
                            }`}
                            title={d.online ? t("screens.drivers.online") : t("screens.drivers.offline")}
                          />
                        </div>
                        <div>
                          <div className="font-medium text-ink">{d.name}</div>
                          {d.uber_email && (
                            <div className="text-xs text-ink-subtle">{d.uber_email}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{d.phone ?? "—"}</td>
                    <td className="px-4 py-3">
                      {d.rating != null ? (
                        <span className="inline-flex items-center gap-1 text-ink">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          {d.rating.toFixed(2)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                      {d.total_trips != null ? d.total_trips.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={d.active ? "connected" : "gap"} dot>
                        {d.active ? t("screens.drivers.active") : t("screens.drivers.inactive")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                          d.uber_linked ? "bg-primary text-primary-ink" : "bg-surface-2 text-ink-subtle"
                        }`}
                      >
                        {d.uber_linked ? t("screens.drivers.linked") : t("screens.drivers.notLinked")}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {d.app_status === "active" ? (
                        <div className="flex items-center gap-2">
                          <Badge status="connected" dot>
                            <Smartphone className="me-1 inline h-3 w-3" />
                            {t("screens.drivers.appActive")}
                          </Badge>
                          <button
                            onClick={() => testPush(d)}
                            disabled={testingId === d.id}
                            title={t("screens.drivers.appTest")}
                            className="rounded-lg border border-line p-1.5 text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                          >
                            {testingId === d.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Bell className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => invite(d)}
                          disabled={invitingId === d.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                        >
                          {invitingId === d.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                          {d.app_status === "invited"
                            ? t("screens.drivers.appResend")
                            : t("screens.drivers.appInvite")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
