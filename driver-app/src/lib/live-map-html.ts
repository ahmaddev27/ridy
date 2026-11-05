/**
 * The Leaflet page the manager live map renders inside a WebView.
 *
 * Free + light: Leaflet from a CDN and raster tiles. The default tile source is
 * the public OpenStreetMap server (fine for a handful of managers; see the OSM
 * tile usage policy). A keyed / self-hosted source can be set at build time with
 * EXPO_PUBLIC_MAP_TILE_URL (a {z}/{x}/{y} template) and EXPO_PUBLIC_MAP_ATTRIBUTION
 * — the same knobs as the dashboard's NEXT_PUBLIC_MAP_TILE_URL.
 */
import type { ManagerLiveDriver } from "@/lib/api";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
const LEAFLET = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist";

const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL || OSM_TILES;
const ATTRIBUTION = process.env.EXPO_PUBLIC_MAP_ATTRIBUTION
  ? `${process.env.EXPO_PUBLIC_MAP_ATTRIBUTION} · ${OSM_ATTRIBUTION}`
  : OSM_ATTRIBUTION;

export type Presence = "on_trip" | "en_route" | "online" | "offline";

/** Marker colours — identical to the dashboard's PRESENCE_COLOR. */
export const PRESENCE_COLOR: Record<Presence, string> = {
  online: "#10b981",
  en_route: "#f59e0b",
  on_trip: "#0ea5e9",
  offline: "#94a3b8",
};

const OFFLINE_TOKENS = ["OFFLINE", "UNAVAILABLE", "DISCONNECTED", "OFF_DUTY", "LOGGED_OUT"];

/** Same derivation as frontend/src/lib/driver-status.ts. */
export function presence(status: string | null | undefined): Presence {
  const s = (status ?? "").toUpperCase();
  if (s.includes("ON_TRIP")) return "on_trip";
  if (s.includes("EN_ROUTE")) return "en_route";
  if (s === "" || OFFLINE_TOKENS.some((tok) => s.includes(tok))) return "offline";
  return "online";
}

export type MapMarker = { id: number; name: string; sub: string; lat: number; lng: number; color: string };

/** Only drivers with a usable position become markers. */
export function toMarkers(drivers: ManagerLiveDriver[]): MapMarker[] {
  return drivers
    .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng))
    .map((d) => ({
      id: d.id,
      name: d.name,
      sub: [d.plz, d.city].filter(Boolean).join(" "),
      lat: d.lat,
      lng: d.lng,
      color: PRESENCE_COLOR[presence(d.status)],
    }));
}

/** The JS the app injects after every poll. JSON is safe to embed as a literal. */
export function setMarkersScript(markers: MapMarker[]): string {
  return `window.setMarkers(${JSON.stringify(markers)});true;`;
}

export function buildMapHtml(dark: boolean): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="${LEAFLET}/leaflet.css">
<style>
html,body,#map{height:100%;margin:0;background:${dark ? "#14161b" : "#f4f4f3"}}
${dark ? ".leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.9) contrast(.9)}" : ""}
.dot{width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)}
.leaflet-control-attribution{font-size:9px}
</style></head><body><div id="map"></div>
<script src="${LEAFLET}/leaflet.js"></script>
<script>
var map=L.map('map',{zoomControl:false}).setView([51.1657,10.4515],6);
L.tileLayer(${JSON.stringify(TILE_URL)},{maxZoom:19,attribution:${JSON.stringify(ATTRIBUTION)}}).addTo(map);
var layer=L.layerGroup().addTo(map),fitted=false;
window.setMarkers=function(list){
  layer.clearLayers();
  var pts=[];
  list.forEach(function(m){
    var icon=L.divIcon({className:'',iconSize:[16,16],iconAnchor:[8,8],html:'<div class="dot" style="background:'+m.color+'"></div>'});
    var el=document.createElement('div');
    var b=document.createElement('b');b.textContent=m.name;el.appendChild(b);
    if(m.sub){el.appendChild(document.createElement('br'));el.appendChild(document.createTextNode(m.sub));}
    L.marker([m.lat,m.lng],{icon:icon}).bindPopup(el).addTo(layer);
    pts.push([m.lat,m.lng]);
  });
  if(!fitted&&pts.length){map.fitBounds(pts,{padding:[40,40],maxZoom:14});fitted=true;}
};
</script></body></html>`;
}
