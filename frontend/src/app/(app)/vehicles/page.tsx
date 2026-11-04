"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Car, RefreshCw, Loader2 } from "lucide-react";
import { PageHead, SkelRows } from "@/components/ui/rd";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listVehicles } from "@/lib/api/vehicles";
import { fetchVehiclesViaExtension } from "@/lib/extension";
import { useAuth } from "@/components/auth/auth-provider";

export default function VehiclesPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const extensionRetired = user?.tenant?.extension_retired === true;
  const v = (k: string) => t(`screens.vehicles.${k}`);
  const { data, loading, refetch } = useAsync(listVehicles, { refetchInterval: 30000 });
  const vehicles = data ?? [];
  const [syncing, setSyncing] = useState(false);
  const didAutoSync = useRef(false);

  // Extension companies: stale-while-revalidate — silently pull fresh vehicles
  // from Uber on open, throttled to at most once every few minutes.
  useEffect(() => {
    if (extensionRetired || didAutoSync.current) return;
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
  }, [extensionRetired]);

  // Migrated companies: vehicles are synced server-side, so the button just
  // re-reads the backend. Extension companies pull through the extension.
  async function sync() {
    setSyncing(true);
    try {
      if (extensionRetired) {
        await refetch();
        return;
      }
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
    <>
      <PageHead
        title={t("pages.vehicles.title")}
        sub={t("pages.vehicles.subtitle")}
        actions={
          <button type="button" className="btn btn-primary" onClick={sync} disabled={syncing}>
            {syncing ? <Loader2 style={{ animation: "ofr-spin 1s linear infinite" }} /> : <RefreshCw />}
            {v("sync")}
          </button>
        }
      />

      <section className="card table-card">
        {loading ? (
          <SkelRows rows={5} cols={5} />
        ) : vehicles.length === 0 ? (
          <EmptyState icon={Car} title={v("empty")} description={v("emptyDesc")} />
        ) : (
          <div className="ofr-tbl">
            <div className="table-wrap">
              <table className="tbl" style={{ minWidth: 980 }}>
                <thead>
                  <tr>
                    <th>{v("colVehicle")}</th>
                    <th>{v("colYear")}</th>
                    <th>{v("colPlate")}</th>
                    <th>{v("colVin")}</th>
                    <th>{v("colColor")}</th>
                    <th>{v("colStatus")}</th>
                    <th>{v("colAssignment")}</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map((car) => (
                    <tr key={car.id}>
                      <td>
                        <div className="row" style={{ gap: 12 }}>
                          {car.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={car.image_url} alt="" style={{ width: 48, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                          ) : (
                            <span style={{ width: 48, height: 36, borderRadius: 8, background: "var(--surface-3)", color: "var(--ink-subtle)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                              <Car className="ico-sm" />
                            </span>
                          )}
                          <span className="strong">{[car.make, car.model].filter(Boolean).join(" ") || "—"}</span>
                        </div>
                      </td>
                      <td>
                        <span className="num">{car.year || "—"}</span>
                      </td>
                      <td>
                        <span className="mono strong" dir="ltr">{car.license_plate ?? "—"}</span>
                      </td>
                      <td>
                        <span className="mono subtle" style={{ fontSize: 11.5 }} dir="ltr">{car.vin ?? "—"}</span>
                      </td>
                      <td>
                        <span className="row" style={{ gap: 8 }}>
                          {car.color_hex && (
                            <i style={{ width: 12, height: 12, borderRadius: 99, background: car.color_hex, border: "1px solid var(--line-strong)" }} />
                          )}
                          {car.color ?? "—"}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${car.compliance_status === "ACTIVE" ? "success" : ""}`}>
                          <span className="dot" />
                          {car.compliance_status === "ACTIVE" ? v("statusActive") : car.compliance_status ?? "—"}
                        </span>
                      </td>
                      <td>{car.assigned_driver ? car.assigned_driver : <span className="subtle">{v("unassigned")}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
