import { Linking } from "react-native";

/** A single stop on the offer route (address-only; no lat/lng from Uber). */
type RouteStop = { address: string | null };

/**
 * Google Maps `&waypoints=` value for the intermediate stops of a multi-stop
 * trip — everything BETWEEN the first item (pickup) and the last (final
 * drop-off). Addresses are individually encoded and joined by "|". Returns ""
 * when there are no usable intermediate stops, so the URL stays untouched.
 */
function waypointsParam(stops?: RouteStop[] | null): string {
  if (!stops || stops.length <= 2) return "";
  const middle = stops
    .slice(1, -1)
    .map((s) => (s.address ?? "").trim())
    .filter((a) => a.length > 0)
    .map((a) => encodeURIComponent(a));
  return middle.length ? `&waypoints=${middle.join("|")}` : "";
}

/**
 * Open the maps app at the pickup → drop-off route. Falls back to a plain search
 * when only one address is present, and no-ops when neither is. Shared by the
 * offer card, offer detail, and the notification "Open in map" action.
 *
 * For a multi-stop trip, pass the offer's `stops` array so the intermediate
 * stops are appended as Google Maps waypoints and the full ordered route opens.
 */
export function openRouteInMaps(pickup?: string | null, dropoff?: string | null, stops?: RouteStop[] | null): void {
  const origin = (pickup ?? "").trim();
  const dest = (dropoff ?? "").trim();

  let url: string | null = null;
  if (origin && dest) {
    url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}${waypointsParam(stops)}&travelmode=driving`;
  } else if (origin || dest) {
    url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(origin || dest)}`;
  }

  if (url) Linking.openURL(url).catch(() => {});
}
