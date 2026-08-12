"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Car, RefreshCw, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listVehicles } from "@/lib/api/vehicles";
import { fetchVehiclesViaExtension } from "@/lib/extension";

export default function VehiclesPage() {
  const { t } = useI18n();
  const v = (k: string) => t(`screens.vehicles.${k}`);
  const { data, loading, refetch } = useAsync(listVehicles, { refetchInterval: 30000 });
  const vehicles = data ?? [];
  const [syncing, setSyncing] = useState(false);
  const didAutoSync = useRef(false);

  // Stale-while-revalidate: silently pull fresh vehicles from Uber on open,
  // throttled to at most once every few minutes.
  useEffect(() => {
    if (didAutoSync.current) return;
    didAutoSync.current = true;
    const KEY = "vehicles-autosync-at";
    const last = Number(localStorage.getItem(KEY) || 0);
    if (Date.now() - last > 5 * 60 * 1000) {
      localStorage.setItem(KEY, String(Date.now()));
      fetchVehiclesViaExtension()
        .then((res) => {
          if (res?.ok) refetch();
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sync() {
    setSyncing(true);
    try {
      const res = await fetchVehiclesViaExtension();
      if (!res) {
        toast.error(v("syncNoExtension"));
      } else if (res.ok) {
        toast.success(v("syncOk"), { description: `${res.synced ?? 0}` });
        await refetch();
      } else {
        toast.error(v("syncFailed"), { description: res.reason });
      }
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        tkey="vehicles"
        action={
          <Button onClick={sync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {v("sync")}
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
        ) : vehicles.length === 0 ? (
          <EmptyState icon={Car} title={v("empty")} description={v("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-subtle [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3 font-semibold">{v("colVehicle")}</th>
                  <th className="px-4 py-3 font-semibold">{v("colYear")}</th>
                  <th className="px-4 py-3 font-semibold">{v("colPlate")}</th>
                  <th className="px-4 py-3 font-semibold">{v("colVin")}</th>
                  <th className="px-4 py-3 font-semibold">{v("colColor")}</th>
                  <th className="px-4 py-3 font-semibold">{v("colStatus")}</th>
                  <th className="px-4 py-3 font-semibold">{v("colAssignment")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {vehicles.map((car) => (
                  <tr key={car.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {car.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={car.image_url} alt="" className="h-9 w-12 rounded object-cover" />
                        ) : (
                          <div className="flex h-9 w-12 items-center justify-center rounded bg-surface-2">
                            <Car className="h-4 w-4 text-ink-subtle" />
                          </div>
                        )}
                        <span className="font-medium text-ink">
                          {[car.make, car.model].filter(Boolean).join(" ") || "—"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{car.year || "—"}</td>
                    <td className="px-4 py-3">
                      <span dir="ltr" className="font-mono text-ink">{car.license_plate ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span dir="ltr" className="font-mono text-xs text-ink-subtle">{car.vin ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-ink-muted">
                        {car.color_hex && (
                          <span className="h-3 w-3 rounded-full border border-line" style={{ background: car.color_hex }} />
                        )}
                        {car.color ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={car.compliance_status === "ACTIVE" ? "connected" : "gap"} dot>
                        {car.compliance_status === "ACTIVE" ? v("statusActive") : car.compliance_status ?? "—"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {car.assigned_driver ? (
                        <span className="text-ink">{car.assigned_driver}</span>
                      ) : (
                        <span className="text-ink-subtle">{v("unassigned")}</span>
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
