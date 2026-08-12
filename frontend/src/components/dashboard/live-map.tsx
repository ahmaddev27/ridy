"use client";

import "leaflet/dist/leaflet.css";
import { latnLocale } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { Radio, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { getLiveDrivers, type LiveDriver } from "@/lib/api/drivers";
import { presence, PRESENCE_COLOR, PRESENCE_TONE, PRESENCE_LABEL_KEY, type Presence } from "@/lib/driver-status";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}

const STATUS_COLOR = (status: string | null): string => PRESENCE_COLOR[presence(status)];
const statusLabel = (status: string | null, c: (k: string) => string): string => c(PRESENCE_LABEL_KEY[presence(status)]);

/** A realistic top-view car marker, filled with the status color. */
function carMarkerHtml(color: string): string {
  return (
    `<div style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))">` +
    `<svg width="34" height="34" viewBox="0 0 48 48" fill="none">` +
    `<path d="M17 5h14c2.1 0 3.8 1.4 4.1 3.4L37 19v20c0 1.7-1.3 3-3 3h-2c-1.7 0-3-1.3-3-3v-1H19v1c0 1.7-1.3 3-3 3h-2c-1.7 0-3-1.3-3-3V19l1.9-10.6C13.2 6.4 14.9 5 17 5z" fill="${color}"/>` +
    `<rect x="16" y="9" width="16" height="8" rx="2.5" fill="#ffffff" opacity="0.92"/>` +
    `<rect x="16" y="31" width="16" height="5" rx="2" fill="#000000" opacity="0.18"/>` +
    `<circle cx="15" cy="23" r="2" fill="#ffffff" opacity="0.9"/><circle cx="33" cy="23" r="2" fill="#ffffff" opacity="0.9"/>` +
    `</svg></div>`
  );
}

/**
 * The live fleet map. Self-contained (own Leaflet instance + polling) so it can
 * be embedded on the dashboard and used full-page alike. `heightClass` sets the
 * map height; everything else adapts.
 */
export function LiveMap({ heightClass = "h-[70vh]" }: { heightClass?: string }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.map.${k}`);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const firstFitRef = useRef(true);

  const [count, setCount] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [drivers, setDrivers] = useState<LiveDriver[]>([]);

  /** Pan + zoom the map onto one driver (from the side list). */
  function focusDriver(dr: LiveDriver) {
    mapRef.current?.setView([dr.lat, dr.lng], 16, { animate: true });
  }

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const L = LRef.current;
      const layer = layerRef.current;
      const map = mapRef.current;
      if (!L || !layer || !map) return;

      let drivers: LiveDriver[] = [];
      try {
        drivers = await getLiveDrivers();
      } catch {
        return;
      }
      if (cancelled) return;

      layer.clearLayers();
      const points: [number, number][] = [];

      for (const d of drivers) {
        const color = STATUS_COLOR(d.status);
        points.push([d.lat, d.lng]);

        // A soft halo ring around each driver so they stand out on the map.
        L.circleMarker([d.lat, d.lng], { radius: 24, color, weight: 2, opacity: 0.5, fillColor: color, fillOpacity: 0.12 }).addTo(layer);

        const icon = L.divIcon({
          className: "",
          iconSize: [34, 34],
          iconAnchor: [17, 17],
          html: carMarkerHtml(color),
        });
        L.marker([d.lat, d.lng], { icon })
          .bindPopup(`<b>${escapeHtml(d.name)}</b><br>${escapeHtml(statusLabel(d.status, c))}`)
          .addTo(layer);

        const wp = d.waypoints ?? [];
        if (wp.length >= 2) {
          const line = wp.map((w) => [w.lat, w.lng]) as [number, number][];
          L.polyline(line, { color, weight: 3, opacity: 0.5, dashArray: "6 6" }).addTo(layer);
          for (const w of wp) {
            const isPickup = (w.type ?? "").toUpperCase().includes("PICKUP");
            L.circleMarker([w.lat, w.lng], {
              radius: 5,
              color: "#fff",
              weight: 2,
              fillColor: isPickup ? "#2563eb" : "#dc2626",
              fillOpacity: 1,
            })
              .bindPopup(isPickup ? c("pickup") : c("dropoff"))
              .addTo(layer);
            points.push([w.lat, w.lng]);
          }
        }
      }

      setCount(drivers.length);
      setDrivers(drivers);
      setUpdatedAt(new Date());

      if (firstFitRef.current && points.length > 0) {
        firstFitRef.current = false;
        // Zoom in close on the drivers (tighter than a country-wide view).
        map.fitBounds(points, { padding: [60, 60], maxZoom: 15 });
        if (points.length === 1) map.setView(points[0], 15);
      }
    }

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;
      LRef.current = L;
      const map = L.map(containerRef.current, { attributionControl: true }).setView([51.1657, 10.4515], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      await refresh();
    })();

    const timer = setInterval(refresh, 12000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_2px_10px_-2px_rgba(30,34,43,0.06)]">
      <div ref={containerRef} className={`w-full ${heightClass}`} style={{ zIndex: 0 }} />

      <div className="pointer-events-none absolute top-3 z-[1000] flex flex-wrap gap-2 px-3 ltr:left-3 rtl:right-3">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2 text-sm shadow-md backdrop-blur">
          <Radio className="h-4 w-4 text-slate-600" />
          <span className="font-semibold text-slate-800">{count ?? "…"}</span>
          <span className="text-slate-500">{c("activeTrips")}</span>
        </div>
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-white/95 px-3 py-2 text-xs shadow-md backdrop-blur">
          <Legend color="#f59e0b" label={c("enRoute")} />
          <Legend color="#10b981" label={c("onTrip")} />
        </div>
      </div>

      {/* Driver list — click to zoom onto one */}
      {drivers.length > 0 && (
        <div className="pointer-events-auto absolute top-3 z-[1000] max-h-[calc(100%-1.5rem)] w-56 overflow-y-auto rounded-xl bg-white/95 p-1.5 shadow-md backdrop-blur ltr:right-3 rtl:left-3">
          {drivers.map((dr) => {
            const p: Presence = presence(dr.status);
            return (
              <button
                key={dr.id}
                onClick={() => focusDriver(dr)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-slate-100"
              >
                <span className="relative shrink-0">
                  {dr.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={dr.picture} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                      {dr.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span
                    className="absolute -bottom-0.5 h-3 w-3 rounded-full border-2 border-white ltr:-right-0.5 rtl:-left-0.5"
                    style={{ background: PRESENCE_COLOR[p] }}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{dr.name}</span>
                  {dr.phone && <span className="block truncate text-[11px] text-slate-400" dir="ltr">{dr.phone}</span>}
                </span>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${PRESENCE_TONE[p]}`}>
                  {c(PRESENCE_LABEL_KEY[p])}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {count === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[999] flex items-center justify-center">
          <div className="rounded-xl bg-white/95 px-5 py-4 text-center shadow-lg backdrop-blur">
            <p className="font-semibold text-slate-800">{c("emptyTitle")}</p>
            <p className="mt-1 text-sm text-slate-500">{c("emptyDesc")}</p>
          </div>
        </div>
      )}

      {updatedAt && (
        <p className="pointer-events-none absolute bottom-2 z-[1000] flex items-center gap-1.5 rounded-lg bg-white/90 px-2 py-1 text-[11px] text-slate-400 ltr:right-2 rtl:left-2">
          <RefreshCw className="h-3 w-3" /> {updatedAt.toLocaleTimeString(latnLocale(locale))}
        </p>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-600">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}
