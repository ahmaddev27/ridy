"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { Radio, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { getLiveDrivers, type LiveDriver } from "@/lib/api/drivers";

const STATUS_COLOR = (status: string | null): string => {
  const s = (status ?? "").toUpperCase();
  if (s.includes("ON_TRIP")) return "#10b981"; // rider aboard
  if (s.includes("EN_ROUTE")) return "#f59e0b"; // heading to pickup
  return "#64748b";
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}

function statusLabel(status: string | null, c: (k: string) => string): string {
  const s = (status ?? "").toUpperCase();
  if (s.includes("ON_TRIP")) return c("onTrip");
  if (s.includes("EN_ROUTE")) return c("enRoute");
  return c("active");
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

        const icon = L.divIcon({
          className: "",
          iconSize: [18, 18],
          iconAnchor: [9, 9],
          html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>`,
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
      setUpdatedAt(new Date());

      if (firstFitRef.current && points.length > 0) {
        firstFitRef.current = false;
        map.fitBounds(points, { padding: [50, 50], maxZoom: 14 });
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
          <RefreshCw className="h-3 w-3" /> {updatedAt.toLocaleTimeString(locale)}
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
