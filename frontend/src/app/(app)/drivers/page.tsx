"use client";

import { useEffect, useRef, useState } from "react";
import { Users, Star, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listDrivers, syncDrivers } from "@/lib/api/drivers";
import { syncRosterViaExtension } from "@/lib/extension";

export default function DriversPage() {
  const { t } = useI18n();
  const { data, loading, error, refetch } = useAsync(listDrivers);
  const drivers = data ?? [];
  const [syncing, setSyncing] = useState(false);
  const didAutoSync = useRef(false);

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
    } catch {
      /* best-effort — the cached roster stays visible */
    } finally {
      setSyncing(false);
    }
  }

  // Pull a fresh roster from Uber once when the page opens.
  useEffect(() => {
    if (didAutoSync.current) return;
    didAutoSync.current = true;
    runSync();
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
              <div key={i} className="h-14 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-600">{t("screens.drivers.loadError")} — {error}</div>
        ) : drivers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("screens.drivers.emptyTitle")}
            description={t("screens.drivers.emptyDesc")}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-start text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("screens.drivers.colName")}</th>
                  <th className="px-4 py-3 font-semibold">{t("screens.drivers.colPhone")}</th>
                  <th className="px-4 py-3 font-semibold">{t("screens.drivers.colRating")}</th>
                  <th className="px-4 py-3 font-semibold">{t("screens.drivers.colTrips")}</th>
                  <th className="px-4 py-3 font-semibold">{t("screens.drivers.colStatus")}</th>
                  <th className="px-4 py-3 font-semibold">Uber</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drivers.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {d.picture_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={d.picture_url}
                            alt=""
                            className="h-9 w-9 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-500">
                            {d.name.slice(0, 1)}
                          </div>
                        )}
                        <div>
                          <div className="font-medium text-slate-800">{d.name}</div>
                          {d.uber_email && (
                            <div className="text-xs text-slate-400">{d.uber_email}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{d.phone ?? "—"}</td>
                    <td className="px-4 py-3">
                      {d.rating != null ? (
                        <span className="inline-flex items-center gap-1 text-slate-700">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          {d.rating.toFixed(2)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
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
                          d.uber_linked ? "bg-black text-white" : "bg-slate-200 text-slate-400"
                        }`}
                      >
                        {d.uber_linked ? t("screens.drivers.linked") : t("screens.drivers.notLinked")}
                      </span>
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
