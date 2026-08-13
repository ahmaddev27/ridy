"use client";

import "leaflet/dist/leaflet.css";
import { latnLocale } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { getLiveDrivers, type LiveDriver } from "@/lib/api/drivers";
import { presence, PRESENCE_COLOR, PRESENCE_TONE, PRESENCE_LABEL_KEY, type Presence } from "@/lib/driver-status";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}

const STATUS_COLOR = (status: string | null): string => PRESENCE_COLOR[presence(status)];
const statusLabel = (status: string | null, c: (k: string) => string): string => c(PRESENCE_LABEL_KEY[presence(status)]);

type DriverMarker = {
  marker: import("leaflet").Marker;
  halo: import("leaflet").CircleMarker;
  wp: import("leaflet").LayerGroup;
  raf: number | null;
};

/**
 * Glide a driver's marker + halo from its current point to the new one over a
 * short duration (client-side only — no polling change, no server load), so cars
 * slide smoothly between position updates instead of teleporting.
 */
function animateTo(entry: DriverMarker, from: import("leaflet").LatLng, to: [number, number]) {
  if (entry.raf) cancelAnimationFrame(entry.raf);
  const dLat = to[0] - from.lat;
  const dLng = to[1] - from.lng;
  if (Math.abs(dLat) < 1e-6 && Math.abs(dLng) < 1e-6) {
    entry.marker.setLatLng(to);
    entry.halo.setLatLng(to);
    return;
  }
  const DURATION = 1400;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / DURATION);
    const at: [number, number] = [from.lat + dLat * t, from.lng + dLng * t];
    entry.marker.setLatLng(at);
    entry.halo.setLatLng(at);
    entry.raf = t < 1 ? requestAnimationFrame(step) : null;
  };
  entry.raf = requestAnimationFrame(step);
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
  // One persistent marker per driver, so positions animate (tween) between polls
  // instead of the whole layer being cleared and redrawn (which made cars "jump").
  const markersRef = useRef<Map<number, DriverMarker>>(new Map());

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

      const registry = markersRef.current;
      const points: [number, number][] = [];
      const seen = new Set<number>();

      for (const d of drivers) {
        const color = STATUS_COLOR(d.status);
        const to: [number, number] = [d.lat, d.lng];
        points.push(to);
        seen.add(d.id);

        const rot = typeof d.heading === "number" ? d.heading : 0;
        const carHtml = `<img src="/markers/car.png" alt="" style="width:42px;height:42px;transform:rotate(${rot}deg);filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))"/>`;
        const popup = `<b>${escapeHtml(d.name)}</b><br>${escapeHtml(statusLabel(d.status, c))}`;

        let entry = registry.get(d.id);
        if (!entry) {
          // First sighting — create the halo + car marker at the position.
          const halo = L.circleMarker(to, { radius: 24, color, weight: 2, opacity: 0.5, fillColor: color, fillOpacity: 0.12 }).addTo(layer);
          const marker = L.marker(to, {
            icon: L.divIcon({ className: "", iconSize: [42, 42], iconAnchor: [21, 21], html: carHtml }),
          }).bindPopup(popup).addTo(layer);
          entry = { marker, halo, wp: L.layerGroup().addTo(layer), raf: null };
          registry.set(d.id, entry);
        } else {
          // Existing — glide from the current spot to the new one; refresh style.
          entry.halo.setStyle({ color, fillColor: color });
          entry.marker.setIcon(L.divIcon({ className: "", iconSize: [42, 42], iconAnchor: [21, 21], html: carHtml }));
          entry.marker.getPopup()?.setContent(popup);
          animateTo(entry, entry.marker.getLatLng(), to);
        }

        // Waypoints (pickup/dropoff route) are cheap to redraw each poll.
        entry.wp.clearLayers();
        const wp = d.waypoints ?? [];
        if (wp.length >= 2) {
          const line = wp.map((w) => [w.lat, w.lng]) as [number, number][];
          L.polyline(line, { color, weight: 3, opacity: 0.5, dashArray: "6 6" }).addTo(entry.wp);
          for (const w of wp) {
            const isPickup = (w.type ?? "").toUpperCase().includes("PICKUP");
            L.circleMarker([w.lat, w.lng], { radius: 5, color: "#fff", weight: 2, fillColor: isPickup ? "#2563eb" : "#dc2626", fillOpacity: 1 })
              .bindPopup(isPickup ? c("pickup") : c("dropoff"))
              .addTo(entry.wp);
            points.push([w.lat, w.lng]);
          }
        }
      }

      // Remove drivers that dropped off the feed.
      for (const [id, entry] of registry) {
        if (!seen.has(id)) {
          if (entry.raf) cancelAnimationFrame(entry.raf);
          layer.removeLayer(entry.marker);
          layer.removeLayer(entry.halo);
          layer.removeLayer(entry.wp);
          registry.delete(id);
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
      // Stop any in-flight marker animations before tearing down the map.
      for (const entry of markersRef.current.values()) {
        if (entry.raf) cancelAnimationFrame(entry.raf);
      }
      markersRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-[0_2px_10px_-2px_rgba(30,34,43,0.06)]">
      <div ref={containerRef} className={`w-full ${heightClass}`} style={{ zIndex: 0 }} />

      {/* Legend — pinned bottom-left so it never rides over the zoom control
          (top-left) or the driver list (top-right). Colors come straight from
          PRESENCE_COLOR so they always match the markers and badges. */}
      <div className="pointer-events-none absolute bottom-3 z-[1000] flex flex-wrap gap-2 px-3 ltr:left-3 rtl:right-3">
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-surface/95 px-3 py-2 text-xs shadow-md backdrop-blur">
          {(["online", "en_route", "on_trip"] as const).map((p) => (
            <Legend key={p} color={PRESENCE_COLOR[p]} label={c(PRESENCE_LABEL_KEY[p])} />
          ))}
        </div>
      </div>

      {/* Driver list — click to zoom onto one */}
      {drivers.length > 0 && (
        <div className="pointer-events-auto absolute top-3 z-[1000] max-h-[calc(100%-1.5rem)] w-56 overflow-y-auto rounded-xl bg-surface/95 p-1.5 shadow-md backdrop-blur ltr:right-3 rtl:left-3">
          {drivers.map((dr) => {
            const p: Presence = presence(dr.status);
            return (
              <button
                key={dr.id}
                onClick={() => focusDriver(dr)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-surface-2"
              >
                <span className="relative shrink-0">
                  {dr.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={dr.picture} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-muted">
                      {dr.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span
                    className="absolute -bottom-0.5 h-3 w-3 rounded-full border-2 border-white ltr:-right-0.5 rtl:-left-0.5"
                    style={{ background: PRESENCE_COLOR[p] }}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{dr.name}</span>
                  {dr.phone && <span className="block truncate text-[11px] text-ink-subtle" dir="ltr">{dr.phone}</span>}
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
          <div className="rounded-xl bg-surface/95 px-5 py-4 text-center shadow-lg backdrop-blur">
            <p className="font-semibold text-ink">{c("emptyTitle")}</p>
            <p className="mt-1 text-sm text-ink-muted">{c("emptyDesc")}</p>
          </div>
        </div>
      )}

      {updatedAt && (
        <p className="pointer-events-none absolute bottom-2 z-[1000] flex items-center gap-1.5 rounded-lg bg-surface/90 px-2 py-1 text-[11px] text-ink-subtle ltr:right-2 rtl:left-2">
          <RefreshCw className="h-3 w-3" /> {updatedAt.toLocaleTimeString(latnLocale(locale))}
        </p>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-ink-muted">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}
