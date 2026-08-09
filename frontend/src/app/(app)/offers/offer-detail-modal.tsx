"use client";

import { useEffect, useState } from "react";
import { X, MapPin, Flag, User, CircleDollarSign, Clock, Hash, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { getOffer, type DispatchOfferDetail } from "@/lib/api/offers";

/**
 * Full detail for one dispatch offer. Renders the known fields, every stop found
 * in the raw payload (multi-stop trips), and a collapsible raw-JSON view so no
 * captured detail is hidden. RTL-safe via logical classes.
 */
export function OfferDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.offers.${k}`);
  const [offer, setOffer] = useState<DispatchOfferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    getOffer(id)
      .then(setOffer)
      .catch((e) => setError(e instanceof Error ? e.message : "error"));
    return () => document.removeEventListener("keydown", onKey);
  }, [id, onClose]);

  const stops = extractStops(offer?.raw);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white text-start shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">
              {offer?.rider_first_name || c("colRider") || "—"}
            </h2>
            <p className="mt-0.5 text-sm text-slate-400">{offer?.driver_name ?? "—"}</p>
          </div>
          <div className="flex items-center gap-2">
            {offer?.fare_formatted && (
              <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-sm font-semibold text-emerald-700">
                {offer.fare_formatted}
              </span>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label={c("close") || "Close"}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="p-6 text-sm text-rose-600">{error}</div>
          ) : !offer ? (
            <div className="flex items-center justify-center p-10 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              {/* Route with every stop */}
              <div className="border-b border-slate-100 p-5">
                <ol className="space-y-3">
                  {stops.map((s, i) => {
                    const isLast = i === stops.length - 1;
                    return (
                      <li key={i} className="flex items-start gap-3">
                        {isLast ? (
                          <Flag className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                        ) : (
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        )}
                        <span className="text-sm text-slate-700">{s}</span>
                      </li>
                    );
                  })}
                </ol>
                {stops.length > 2 && (
                  <p className="mt-3 text-xs font-medium text-indigo-600">
                    {stops.length} {c("stops") || "stops"}
                  </p>
                )}
              </div>

              {/* Known fields */}
              <dl className="divide-y divide-slate-100">
                <Row icon={User} label={c("colDriver")}>{offer.driver_name ?? "—"}</Row>
                <Row icon={CircleDollarSign} label={c("colFare")}>{offer.fare_formatted ?? "—"}</Row>
                <Row icon={Clock} label={c("acceptWindow") || "Accept window"}>
                  {offer.accept_window_seconds != null ? `${offer.accept_window_seconds}s` : "—"}
                </Row>
                <Row icon={Clock} label={c("colTime")}>
                  {offer.received_at ? new Date(offer.received_at).toLocaleString(locale) : "—"}
                </Row>
                <Row icon={Hash} label="Offer ID">
                  <span dir="ltr" className="font-mono text-xs text-slate-500">{offer.offer_uuid}</span>
                </Row>
              </dl>

              {/* Raw payload — nothing hidden */}
              <div className="p-5">
                <button
                  onClick={() => setShowRaw((v) => !v)}
                  className="text-sm font-medium text-slate-600 hover:text-slate-800"
                >
                  {showRaw ? "▾ " : "▸ "}
                  {c("rawPayload") || "Full raw data"}
                </button>
                {showRaw && (
                  <pre
                    dir="ltr"
                    className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-start font-mono text-[11px] leading-relaxed text-slate-100"
                  >
                    {JSON.stringify(offer.raw, null, 2)}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
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

/**
 * Pull an ordered list of stop addresses from the raw offer. Uber puts extra
 * waypoints in arrays that vary by offer type, so we look through common keys
 * and fall back to the flat pickup/dropoff fields.
 */
function extractStops(raw: Record<string, unknown> | null | undefined): string[] {
  if (!raw) return [];
  const arrayKeys = ["waypoints", "wayPoints", "stops", "legs", "route"];
  for (const key of arrayKeys) {
    const arr = raw[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const addrs = arr
        .map((w) => addressOf(w))
        .filter((a): a is string => Boolean(a));
      if (addrs.length > 0) return addrs;
    }
  }
  // Fallback: the flat pickup -> dropoff pair.
  const flat = [raw.pickupAddress, raw.dropoffAddress].filter(
    (a): a is string => typeof a === "string" && a.length > 0,
  );
  return flat;
}

function addressOf(node: unknown): string | null {
  if (typeof node === "string") return node;
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    for (const k of ["address", "formattedAddress", "fullAddress", "title", "name"]) {
      if (typeof o[k] === "string" && (o[k] as string).length > 0) return o[k] as string;
    }
  }
  return null;
}
