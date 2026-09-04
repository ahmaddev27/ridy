"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { Map as MapLibreMap, Marker, StyleSpecification } from "maplibre-gl";

type Point = { lat: number; lng: number };

/**
 * A free, token-less MapLibre style built inline from OpenStreetMap raster
 * tiles. Kept in code (not a hosted style URL) so the map never depends on any
 * API key or third-party style host. Mirrors the dashboard live map.
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

const ROUTE_SOURCE = "trip-route";

/** Small colored dot marker element (replaces Leaflet's divIcon pin). */
function pinElement(color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `width:16px;height:16px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);box-sizing:border-box`;
  return el;
}

/** The blue "stop" marker for a drop-off — a filled disc with a white rounded
 *  square (⏹), matching the StopMarker used in the itinerary list. */
function stopElement(color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `width:20px;height:20px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);box-sizing:border-box;display:flex;align-items:center;justify-content:center`;
  const inner = document.createElement("div");
  // ~45% of the disc, moderately rounded — a clear, symmetric ⏹ stop square.
  inner.style.cssText = "width:9px;height:9px;border-radius:2.5px;background:#fff";
  el.appendChild(inner);
  return el;
}

/** A numbered marker for an intermediate multi-stop drop-off. */
function numberedElement(color: string, n: number): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = String(n);
  el.style.cssText = `width:20px;height:20px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);box-sizing:border-box;color:#fff;font:700 11px system-ui,sans-serif;display:flex;align-items:center;justify-content:center`;
  return el;
}

export function TripMap({
  pickup,
  dropoff,
  routeGeometry,
  stops,
}: {
  pickup: Point | null;
  dropoff: Point | null;
  routeGeometry: { coordinates: [number, number][] } | null;
  // Uber live-map stops (pickup first, then each drop-off). When there is more
  // than one drop-off, the intermediate stops are drawn as numbered markers.
  stops?: { lat: number; lng: number }[] | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  // Intermediate drop-offs = everything between the first (pickup) and last (final
  // drop-off) stop. Empty for a normal single-drop trip.
  const midStops = (stops?.length ?? 0) > 2 ? stops!.slice(1, -1) : [];

  const pts: [number, number][] = [];
  if (pickup) pts.push([pickup.lat, pickup.lng]);
  for (const s of midStops) pts.push([s.lat, s.lng]);
  if (dropoff) pts.push([dropoff.lat, dropoff.lng]);

  // A stable string identity for the route so the effect re-runs only when the
  // actual geometry changes — depending on the object itself re-initialised the
  // map on every parent render (the endless load + zoom-in/out loop).
  const coords = routeGeometry?.coordinates;
  const routeKey = coords?.length
    ? `${coords.length}:${coords[0]?.join(",")}:${coords[coords.length - 1]?.join(",")}`
    : "";

  useEffect(() => {
    if (pts.length === 0) return;
    let cancelled = false;
    const markers: Marker[] = [];

    // GeoJSON route is already [lng,lat]; fall back to a straight pickup→dropoff line.
    const line: [number, number][] = routeGeometry?.coordinates?.length
      ? routeGeometry.coordinates
      : pts.map(([lat, lng]) => [lng, lat]);

    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: OSM_STYLE,
        center: [pts[0][1], pts[0][0]],
        zoom: 13,
        scrollZoom: false,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      mapRef.current = map;

      map.on("load", () => {
        if (cancelled) return;

        if (line.length >= 2) {
          map.addSource(ROUTE_SOURCE, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: line },
            },
          });
          map.addLayer({
            id: ROUTE_SOURCE,
            type: "line",
            source: ROUTE_SOURCE,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#4f46e5", "line-width": 4 },
          });
        }

        if (pickup) {
          markers.push(new maplibregl.Marker({ element: pinElement("#059669") }).setLngLat([pickup.lng, pickup.lat]).addTo(map));
        }
        // Numbered blue markers for each intermediate drop-off on a multi-stop trip.
        midStops.forEach((s, i) => {
          markers.push(new maplibregl.Marker({ element: numberedElement("#2563eb", i + 1) }).setLngLat([s.lng, s.lat]).addTo(map));
        });
        if (dropoff) {
          markers.push(new maplibregl.Marker({ element: stopElement("#2563eb") }).setLngLat([dropoff.lng, dropoff.lat]).addTo(map));
        }

        // Fit to the pickup/dropoff pair, or center on the single known point.
        if (pts.length >= 2) {
          const bounds = new maplibregl.LngLatBounds();
          for (const [lat, lng] of pts) bounds.extend([lng, lat]);
          map.fitBounds(bounds, { padding: 30 });
        } else {
          map.setCenter([pts[0][1], pts[0][0]]);
          map.setZoom(14);
        }
      });
    })();

    return () => {
      cancelled = true;
      for (const m of markers) m.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, routeKey, midStops.map((s) => `${s.lat},${s.lng}`).join("|")]);

  if (pts.length === 0) return null;

  return <div ref={containerRef} style={{ height: "220px", width: "100%" }} className="overflow-hidden rounded-xl" />;
}
