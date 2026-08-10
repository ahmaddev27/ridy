"use client";

import { useEffect, useState } from "react";
import { X, Star, Phone, Mail, Hash, Car, UserCheck, Smartphone, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/context";
import type { Driver } from "@/lib/api/drivers";
import { fetchDriverMetricsViaExtension, type DriverMetrics } from "@/lib/extension";

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function pct(v: number | string | null | undefined): string {
  const n = num(v);
  if (n == null) return "—";
  return `${(n <= 1 ? n * 100 : n).toFixed(0)}%`;
}

/**
 * Read-only detail view for a single driver, shown in a centered modal. Pure
 * presentation — the parent owns open/close state. RTL-safe via logical classes.
 */
export function DriverDetailModal({ driver, onClose }: { driver: Driver; onClose: () => void }) {
  const { t } = useI18n();
  const d = (k: string) => t(`screens.drivers.${k}`);

  const [range, setRange] = useState<7 | 30>(30);
  const [metrics, setMetrics] = useState<DriverMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Pull performance metrics for the selected window via the extension.
  useEffect(() => {
    if (!driver.uber_driver_uuid) return;
    const to = Date.now();
    const from = to - range * 86_400_000;
    setLoadingMetrics(true);
    setMetrics(null);
    fetchDriverMetricsViaExtension(driver.uber_driver_uuid, from, to)
      .then(setMetrics)
      .finally(() => setLoadingMetrics(false));
  }, [driver.uber_driver_uuid, range]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white text-start shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-slate-100 p-5">
          {driver.picture_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={driver.picture_url} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-xl font-semibold text-slate-800">
              {driver.name.slice(0, 1)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-slate-900">{driver.name}</h2>
            {driver.uber_email && (
              <p className="truncate text-sm text-slate-400">{driver.uber_email}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge status={driver.active ? "connected" : "gap"} dot>
                {driver.active ? d("active") : d("inactive")}
              </Badge>
              <Badge status={driver.uber_linked ? "connected" : "neutral"} dot>
                {driver.uber_linked ? d("linked") : d("notLinked")}
              </Badge>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label={d("close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Performance (Uber GetEarnerMetrics via the extension) */}
        {driver.uber_driver_uuid && (
          <div className="border-b border-slate-100 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">{d("performance")}</h3>
              <div className="flex items-center rounded-lg border border-slate-200 p-0.5 text-xs">
                {([7, 30] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={`rounded-md px-2 py-1 ${range === r ? "bg-indigo-600 text-white" : "text-slate-500"}`}
                  >
                    {r}{d("daysShort")}
                  </button>
                ))}
              </div>
            </div>
            {loadingMetrics ? (
              <div className="flex items-center justify-center py-6 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : metrics ? (
              <div className="grid grid-cols-3 gap-2">
                <Tile label={d("mEarnings")} value={num(metrics.earnings) != null ? `${num(metrics.earnings)!.toFixed(2)} ${metrics.earnings_label ?? "€"}` : "—"} />
                <Tile label={d("mTrips")} value={num(metrics.trips) != null ? `${num(metrics.trips)}` : "—"} />
                <Tile label={d("mHoursOnline")} value={num(metrics.hours_online) != null ? `${num(metrics.hours_online)!.toFixed(1)}h` : "—"} />
                <Tile label={d("mHoursOnTrip")} value={num(metrics.hours_on_trip) != null ? `${num(metrics.hours_on_trip)!.toFixed(1)}h` : "—"} />
                <Tile label={d("mAcceptance")} value={pct(metrics.acceptance_rate)} />
                <Tile label={d("mCancellation")} value={pct(metrics.cancellation_rate)} />
              </div>
            ) : (
              <p className="py-3 text-xs text-slate-400">{d("metricsUnavailable")}</p>
            )}
          </div>
        )}

        {/* Stats */}
        <dl className="divide-y divide-slate-100">
          <Row icon={Star} label={d("colRating")}>
            {driver.rating != null ? (
              <span className="inline-flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                {driver.rating.toFixed(2)}
              </span>
            ) : (
              "—"
            )}
          </Row>
          <Row icon={Car} label={d("colTrips")}>
            {driver.total_trips != null ? driver.total_trips.toLocaleString() : "—"}
          </Row>
          <Row icon={Phone} label={d("colPhone")}>
            {driver.phone ? <span dir="ltr">{driver.phone}</span> : "—"}
          </Row>
          <Row icon={Mail} label={d("email")}>
            {driver.uber_email ? <span dir="ltr">{driver.uber_email}</span> : "—"}
          </Row>
          <Row icon={Hash} label={d("uberUuid")}>
            {driver.uber_driver_uuid ? (
              <span dir="ltr" className="font-mono text-xs text-slate-500">
                {driver.uber_driver_uuid}
              </span>
            ) : (
              "—"
            )}
          </Row>
          <Row icon={UserCheck} label={d("linkMethod")}>
            {driver.uber_link_method ? d(`linkMethod_${driver.uber_link_method}`) : "—"}
          </Row>
          {/* The forward-looking "joined our fleet via the mobile app" status. */}
          <Row icon={Smartphone} label={d("fleetStatus")}>
            <span className="text-amber-600">{d("fleetPending")}</span>
          </Row>
        </dl>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-center">
      <div className="text-sm font-bold text-slate-800">{value}</div>
      <div className="mt-0.5 text-[10px] text-slate-400">{label}</div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <dt className="flex items-center gap-2 text-sm text-slate-500">
        <Icon className="h-4 w-4 text-slate-400" />
        {label}
      </dt>
      <dd className="min-w-0 truncate text-sm font-medium text-slate-800">{children}</dd>
    </div>
  );
}
