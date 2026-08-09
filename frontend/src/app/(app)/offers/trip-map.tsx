"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type Point = { lat: number; lng: number };

/** Small colored pin, avoids Leaflet's broken default-icon asset paths. */
function pin(color: string) {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:16px;height:16px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length >= 2) {
      map.fitBounds(points, { padding: [30, 30] });
    } else if (points.length === 1) {
      map.setView(points[0], 14);
    }
  }, [map, points]);
  return null;
}

export function TripMap({
  pickup,
  dropoff,
  routeGeometry,
}: {
  pickup: Point | null;
  dropoff: Point | null;
  routeGeometry: { coordinates: [number, number][] } | null;
}) {
  const pts: [number, number][] = [];
  if (pickup) pts.push([pickup.lat, pickup.lng]);
  if (dropoff) pts.push([dropoff.lat, dropoff.lng]);

  if (pts.length === 0) return null;

  // GeoJSON is [lng,lat]; Leaflet wants [lat,lng]. Fall back to a straight line.
  const line: [number, number][] = routeGeometry?.coordinates?.length
    ? routeGeometry.coordinates.map(([lng, lat]) => [lat, lng])
    : pts;

  return (
    <MapContainer
      center={pts[0]}
      zoom={13}
      scrollWheelZoom={false}
      style={{ height: "220px", width: "100%" }}
      className="rounded-xl"
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {line.length >= 2 && <Polyline positions={line} pathOptions={{ color: "#4f46e5", weight: 4 }} />}
      {pickup && <Marker position={[pickup.lat, pickup.lng]} icon={pin("#059669")} />}
      {dropoff && <Marker position={[dropoff.lat, dropoff.lng]} icon={pin("#e11d48")} />}
      <FitBounds points={pts} />
    </MapContainer>
  );
}
