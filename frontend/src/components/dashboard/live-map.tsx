"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { latnLocale } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
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

const DRIVER_SOURCE = "drivers";
const HALO_LAYER = "driver-halo";
const CAR_LAYER = "driver-car";
const LINE_SOURCE = "wp-lines";
const POINT_SOURCE = "wp-points";
const CAR_IMAGE = "car";

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * The live fleet map. Self-contained (own MapLibre instance + polling) so it can
 * be embedded on the dashboard and used full-page alike. `heightClass` sets the
 * map height; everything else adapts. MapLibre GL runs on the free, token-less
 * OpenStreetMap raster style above.
 *
 * Drivers are drawn as a MapLibre SYMBOL layer (the car icon is painted onto the
 * map canvas), not DOM markers — so a car stays pinned exactly to its coordinate
 * and scales with the map on zoom instead of floating/drifting above it.
 */
export function LiveMap({ heightClass = "h-[70vh]" }: { heightClass?: string }) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.map.${k}`);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const MRef = useRef<typeof import("maplibre-gl") | null>(null);
  const readyRef = useRef(false);
  const firstFitRef = useRef(true);
  // Last-known pickup/drop-off per driver, kept for the whole engaged trip — Uber
  // trims the pickup once ON_TRIP, so cache them so the stops never vanish mid-trip.
  const waypointsRef = useRef<Map<number, LiveWaypoint[]>>(new Map());

  const [count, setCount] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [drivers, setDrivers] = useState<LiveDriver[]>([]);

  /** Pan + zoom the map onto one driver (from the side list). */
  function focusDriver(dr: LiveDriver) {
    // essential:true so the fly still happens under a "prefers-reduced-motion" OS
    // setting (MapLibre otherwise skips the camera animation).
    mapRef.current?.flyTo({ center: [dr.lng, dr.lat], zoom: 16, essential: true });
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

      const points: [number, number][] = [];
      const driverFeatures: GeoJSON.Feature[] = [];
      const lineFeatures: GeoJSON.Feature[] = [];
      const pointFeatures: GeoJSON.Feature[] = [];

      for (const d of drivers) {
        const color = STATUS_COLOR(d.status);
        points.push([d.lat, d.lng]);

        driverFeatures.push({
          type: "Feature",
          properties: {
            color,
            heading: typeof d.heading === "number" ? d.heading : 0,
            name: d.name,
            label: statusLabel(d.status, c),
          },
          geometry: { type: "Point", coordinates: [d.lng, d.lat] },
        });

        // The ACTIVE leg from the car to its current target: heading to pickup (en
        // route) or drop-off (on trip). Colored by presence so it reads at a glance.
        const phase = presence(d.status);
        const engaged = phase === "on_trip" || phase === "en_route";
        const wpCache = waypointsRef.current;
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

      (map.getSource(DRIVER_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: driverFeatures });
      (map.getSource(LINE_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: lineFeatures });
      (map.getSource(POINT_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: pointFeatures });

      setCount(drivers.length);
      setDrivers(drivers);
      setUpdatedAt(new Date());

      if (firstFitRef.current && points.length > 0) {
        firstFitRef.current = false;
        const maplibregl = MRef.current!;
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

        // Load the car icon once, then draw drivers as a symbol layer with a
        // status-colored halo beneath — both painted on the map canvas so they
        // stay pinned to the coordinate and scale with zoom (no DOM-marker drift).
        const img = await map.loadImage("/markers/car.png").catch(() => null);
        if (img && !map.hasImage(CAR_IMAGE)) map.addImage(CAR_IMAGE, img.data);

        map.addSource(DRIVER_SOURCE, { type: "geojson", data: EMPTY_FC });
        map.addSource(LINE_SOURCE, { type: "geojson", data: EMPTY_FC });
        map.addSource(POINT_SOURCE, { type: "geojson", data: EMPTY_FC });

        // Route leg + pickup/dropoff dots (drawn under the cars).
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

        // Status halo behind each car.
        map.addLayer({
          id: HALO_LAYER,
          type: "circle",
          source: DRIVER_SOURCE,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 9, 12, 16, 16, 24],
            "circle-color": ["get", "color"],
            "circle-opacity": 0.18,
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0.6,
          },
        });
        // The car icon, rotated by heading, scaled up as you zoom in.
        map.addLayer({
          id: CAR_LAYER,
          type: "symbol",
          source: DRIVER_SOURCE,
          layout: {
            "icon-image": CAR_IMAGE,
            "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.2, 12, 0.32, 16, 0.46],
            "icon-rotate": ["get", "heading"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });

        // Tapping a car shows the driver's name + status; a waypoint dot its label.
        map.on("click", CAR_LAYER, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          const html = `<b>${escapeHtml(String(f.properties?.name ?? ""))}</b><br>${escapeHtml(String(f.properties?.label ?? ""))}`;
          new maplibregl.Popup({ offset: 16, closeButton: false }).setLngLat([lng, lat]).setHTML(html).addTo(map);
        });
        map.on("click", POINT_SOURCE, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          new maplibregl.Popup({ offset: 8, closeButton: false }).setLngLat([lng, lat]).setText(String(f.properties?.label ?? "")).addTo(map);
        });
        for (const layer of [CAR_LAYER, POINT_SOURCE]) {
          map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
        }

        readyRef.current = true;
        await refresh();
      });
    })();

    const timer = setInterval(refresh, 12000);
    return () => {
      cancelled = true;
      clearInterval(timer);
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
                  {dr.city && (
                    <span className="block truncate text-[11px] text-ink-subtle">
                      {dr.plz ? `${dr.plz} ${dr.city}` : dr.city}
                    </span>
                  )}
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
