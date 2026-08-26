"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { latnLocale } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker, StyleSpecification } from "maplibre-gl";
import { RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { getLiveDrivers, type LiveDriver, type LiveWaypoint } from "@/lib/api/drivers";
import { presence, PRESENCE_COLOR, PRESENCE_TONE, PRESENCE_LABEL_KEY, type Presence } from "@/lib/driver-status";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
}

const STATUS_COLOR = (status: string | null): string => PRESENCE_COLOR[presence(status)];
const statusLabel = (status: string | null, c: (k: string) => string): string => c(PRESENCE_LABEL_KEY[presence(status)]);

/**
 * A free, token-less MapLibre style built inline from OpenStreetMap raster
 * tiles. Kept in code (not a hosted style URL) so the map never depends on any
 * API key or third-party style host.
 */
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const LINE_SOURCE = "wp-lines";
const POINT_SOURCE = "wp-points";

type DriverMarker = {
  marker: Marker;
  /** The car <img> inside the marker element — restyled (rotation) each poll. */
  car: HTMLImageElement;
  /** The translucent halo ring behind the car — recolored each poll. */
  halo: HTMLSpanElement;
  raf: number | null;
};

/**
 * Build the DOM element for a driver marker: a fixed-size halo ring with the
 * rotatable car icon centered on top. Mirrors the old Leaflet divIcon + halo.
 */
function createMarkerElement(): { el: HTMLDivElement; car: HTMLImageElement; halo: HTMLSpanElement } {
  const el = document.createElement("div");
  el.style.cssText = "position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer";

  const halo = document.createElement("span");
  halo.style.cssText = "position:absolute;inset:0;border-radius:9999px;border-width:2px;border-style:solid;box-sizing:border-box";

  const car = document.createElement("img");
  car.src = "/markers/car.png";
  car.alt = "";
  car.style.cssText = "position:relative;width:26px;height:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))";

  el.appendChild(halo);
  el.appendChild(car);
  return { el, car, halo };
}

function styleHalo(halo: HTMLSpanElement, color: string): void {
  halo.style.borderColor = hexToRgba(color, 0.5);
  halo.style.backgroundColor = hexToRgba(color, 0.12);
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Glide a driver's marker from its current point to the new one over a short
 * duration (client-side only — no polling change, no server load), so cars
 * slide smoothly between position updates instead of teleporting.
 */
function animateTo(entry: DriverMarker, from: { lng: number; lat: number }, to: [number, number]) {
  if (entry.raf) cancelAnimationFrame(entry.raf);
  const [lat, lng] = to;
  const dLat = lat - from.lat;
  const dLng = lng - from.lng;
  if (Math.abs(dLat) < 1e-6 && Math.abs(dLng) < 1e-6) {
    entry.marker.setLngLat([lng, lat]);
    return;
  }
  const DURATION = 1400;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / DURATION);
    entry.marker.setLngLat([from.lng + dLng * t, from.lat + dLat * t]);
    entry.raf = t < 1 ? requestAnimationFrame(step) : null;
  };
  entry.raf = requestAnimationFrame(step);
}

/**
 * The live fleet map. Self-contained (own MapLibre instance + polling) so it can
 * be embedded on the dashboard and used full-page alike. `heightClass` sets the
 * map height; everything else adapts. MapLibre GL runs on the free, token-less
 * OpenStreetMap raster style above.
 */
export function LiveMap({ heightClass = "h-[70vh]" }: { heightClass?: string }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.map.${k}`);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const MRef = useRef<typeof import("maplibre-gl") | null>(null);
  const readyRef = useRef(false);
  const firstFitRef = useRef(true);
  // One persistent marker per driver, so positions animate (tween) between polls
  // instead of the whole layer being cleared and redrawn (which made cars "jump").
  const markersRef = useRef<Map<number, DriverMarker>>(new Map());
  // Last-known pickup/drop-off per driver, kept for the whole engaged trip — Uber
  // trims the pickup once ON_TRIP, so cache them so the stops never vanish mid-trip.
  const waypointsRef = useRef<Map<number, LiveWaypoint[]>>(new Map());

  const [count, setCount] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [drivers, setDrivers] = useState<LiveDriver[]>([]);

  /** Pan + zoom the map onto one driver (from the side list). */
  function focusDriver(dr: LiveDriver) {
    const map = mapRef.current;
    if (!map) return;
    // essential:true so the fly still happens under a "prefers-reduced-motion"
    // setting — MapLibre silently skips non-essential camera animations there,
    // which made clicking a driver appear to do nothing. Don't auto-open the
    // popup: centred on the car, its white box sat right on top of the marker and
    // hid the car icon — the point of the click is to SEE the car. The label still
    // opens on tapping the marker itself.
    map.flyTo({ center: [dr.lng, dr.lat], zoom: 16, essential: true });
  }

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const map = mapRef.current;
      if (!map || !readyRef.current) return;

      let drivers: LiveDriver[] = [];
      try {
        drivers = await getLiveDrivers();
      } catch {
        return;
      }
      if (cancelled) return;

      const maplibregl = MRef.current;
      if (!maplibregl) return;

      const registry = markersRef.current;
      const points: [number, number][] = [];
      const seen = new Set<number>();
      const lineFeatures: GeoJSON.Feature[] = [];
      const pointFeatures: GeoJSON.Feature[] = [];

      for (const d of drivers) {
        const color = STATUS_COLOR(d.status);
        const to: [number, number] = [d.lat, d.lng];
        points.push(to);
        seen.add(d.id);

        const rot = typeof d.heading === "number" ? d.heading : 0;
        const popupHtml = `<b>${escapeHtml(d.name)}</b><br>${escapeHtml(statusLabel(d.status, c))}`;

        let entry = registry.get(d.id);
        if (!entry) {
          // First sighting — create the halo + car marker at the position.
          const { el, car, halo } = createMarkerElement();
          styleHalo(halo, color);
          car.style.transform = `rotate(${rot}deg)`;
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([d.lng, d.lat])
            .setPopup(new maplibregl.Popup({ offset: 24, closeButton: false }).setHTML(popupHtml))
            .addTo(map);
          entry = { marker, car, halo, raf: null };
          registry.set(d.id, entry);
        } else {
          // Existing — glide from the current spot to the new one; refresh style.
          styleHalo(entry.halo, color);
          entry.car.style.transform = `rotate(${rot}deg)`;
          entry.marker.getPopup()?.setHTML(popupHtml);
          animateTo(entry, entry.marker.getLngLat(), to);
        }

        // Draw the ACTIVE leg from the car itself to its current target: heading
        // to pickup (en route) → car → pickup; rider aboard (on trip) → car →
        // drop-off. So the line always originates at the driver, not between the
        // two stops. Colored by presence so the leg reads at a glance.
        const phase = presence(d.status);
        const engaged = phase === "on_trip" || phase === "en_route";
        const wpCache = waypointsRef.current;
        // Cache fresh waypoints; while engaged, fall back to the cached set when a
        // poll trims them (so ON_TRIP keeps showing both pickup and drop-off).
        let wp = d.waypoints ?? [];
        if (wp.length > 0) wpCache.set(d.id, wp);
        else if (engaged && wpCache.has(d.id)) wp = wpCache.get(d.id)!;
        if (!engaged) wpCache.delete(d.id);

        if (wp.length > 0) {
          const pickup = wp.find((w) => (w.type ?? "").toUpperCase().includes("PICKUP"));
          const dropoff = wp.find((w) => (w.type ?? "").toUpperCase().includes("DROPOFF")) ?? wp.find((w) => w !== pickup);
          const target = phase === "on_trip" ? dropoff : phase === "en_route" ? pickup : null;

          if (target) {
            lineFeatures.push({
              type: "Feature",
              properties: { color },
              geometry: { type: "LineString", coordinates: [[d.lng, d.lat], [target.lng, target.lat]] },
            });
            points.push([d.lat, d.lng]); // keep the car in view when fitting
          }

          for (const w of wp) {
            const isPickup = (w.type ?? "").toUpperCase().includes("PICKUP");
            pointFeatures.push({
              type: "Feature",
              properties: { color: isPickup ? "#2563eb" : "#dc2626", label: isPickup ? c("pickup") : c("dropoff") },
              geometry: { type: "Point", coordinates: [w.lng, w.lat] },
            });
            points.push([w.lat, w.lng]);
          }
        }
      }

      // Remove drivers that dropped off the feed.
      for (const [id, entry] of registry) {
        if (!seen.has(id)) {
          if (entry.raf) cancelAnimationFrame(entry.raf);
          entry.marker.remove();
          registry.delete(id);
          waypointsRef.current.delete(id);
        }
      }

      // Push the fresh waypoint geometry into the two GeoJSON sources.
      (map.getSource(LINE_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: lineFeatures });
      (map.getSource(POINT_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: pointFeatures });

      setCount(drivers.length);
      setDrivers(drivers);
      setUpdatedAt(new Date());

      if (firstFitRef.current && points.length > 0) {
        firstFitRef.current = false;
        if (points.length === 1) {
          map.setCenter([points[0][1], points[0][0]]);
          map.setZoom(15);
        } else {
          const bounds = new maplibregl.LngLatBounds();
          for (const [lat, lng] of points) bounds.extend([lng, lat]);
          map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
        }
      }
    }

    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      MRef.current = maplibregl;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: OSM_STYLE,
        center: [10.4515, 51.1657],
        zoom: 5,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      mapRef.current = map;

      map.on("load", async () => {
        if (cancelled) return;
        // Route line + pickup/dropoff dot layers, fed by GeoJSON sources refreshed each poll.
        map.addSource(LINE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource(POINT_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: LINE_SOURCE,
          type: "line",
          source: LINE_SOURCE,
          paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.5, "line-dasharray": [2, 2] },
        });
        map.addLayer({
          id: POINT_SOURCE,
          type: "circle",
          source: POINT_SOURCE,
          paint: {
            "circle-radius": 5,
            "circle-color": ["get", "color"],
            "circle-stroke-color": "#fff",
            "circle-stroke-width": 2,
          },
        });
        // Waypoint dots open a pickup/dropoff popup on click (like the old bindPopup).
        map.on("click", POINT_SOURCE, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const label = String(f.properties?.label ?? "");
          const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          new maplibregl.Popup({ offset: 8, closeButton: false }).setLngLat([lng, lat]).setText(label).addTo(map);
        });
        map.on("mouseenter", POINT_SOURCE, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", POINT_SOURCE, () => { map.getCanvas().style.cursor = ""; });

        readyRef.current = true;
        await refresh();
      });
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
      readyRef.current = false;
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
