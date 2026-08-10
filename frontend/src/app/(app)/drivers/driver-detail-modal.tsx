"use client";

import { useEffect } from "react";
import { X, Star, Phone, Mail, Hash, Car, UserCheck, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/context";
import type { Driver } from "@/lib/api/drivers";

/**
 * Read-only detail view for a single driver, shown in a centered modal. Pure
 * presentation — the parent owns open/close state. RTL-safe via logical classes.
 */
export function DriverDetailModal({ driver, onClose }: { driver: Driver; onClose: () => void }) {
  const { t } = useI18n();
  const d = (k: string) => t(`screens.drivers.${k}`);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white text-start shadow-xl"
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
