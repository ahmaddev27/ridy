import { Linking } from "react-native";

type Point = { lat?: number | null; lng?: number | null };

/** A single stop on the offer route. Carries the address and, once resolved from
 *  Uber's live map, its exact coordinates. */
type RouteStop = { address: string | null; lat?: number | null; lng?: number | null };

/**
 * A Google Maps location token for one endpoint:
 *  - "lat,lng" when we have an EXACT coordinate and are told to prefer it (Uber's
 *    post-accept waypoints) — the maps app pins there directly, no re-geocoding,
 *    so a house-number-less address never lands on the wrong spot.
 *  - otherwise the URL-encoded address text — Google's geocoder (better than ours
 *    for imprecise text) places it.
 * Returns null when neither is usable.
 */
function locationToken(address: string | null | undefined, point: Point | undefined, preferCoords: boolean): string | null {
  if (preferCoords && point && typeof point.lat === "number" && typeof point.lng === "number") {
    return `${point.lat},${point.lng}`;
  }
  const text = (address ?? "").trim();
  return text ? encodeURIComponent(text) : null;
}

/**
 * Google Maps `&waypoints=` value for the intermediate stops of a multi-stop trip
 * — everything BETWEEN the pickup (first) and the final drop-off (last). Each stop
 * uses its exact coordinate when preferred/available, else its address. Returns ""
 * when there are no usable intermediate stops, so the URL stays untouched.
 */
function waypointsParam(stops: RouteStop[] | null | undefined, preferCoords: boolean): string {
  if (!stops || stops.length <= 2) return "";
  const middle = stops
    .slice(1, -1)
    .map((s) => locationToken(s.address, s, preferCoords))
    .filter((token): token is string => token !== null);
  return middle.length ? `&waypoints=${middle.join("|")}` : "";
}

/**
 * Open the maps app at the pickup → drop-off route. Prefers EXACT coordinates
 * (Uber's post-accept waypoints, `exact: true`) so the pin is precise even when
 * the address text lost its house number; otherwise passes the address text for
 * the maps app to geocode. Falls back to a plain search when only one end is
 * present, and no-ops when neither is. Shared by the offer card, offer detail,
 * and the notification "Open in map" action.
 */
export function openRouteInMaps(route: {
  pickup?: string | null;
  dropoff?: string | null;
  pickupPoint?: Point;
  dropoffPoint?: Point;
  stops?: RouteStop[] | null;
  /** True when the coordinates are Uber's exact waypoints — pin by coordinate. */
  exact?: boolean;
}): void {
  const preferCoords = route.exact === true;
  const origin = locationToken(route.pickup, route.pickupPoint, preferCoords);
  const dest = locationToken(route.dropoff, route.dropoffPoint, preferCoords);

  let url: string | null = null;
  if (origin && dest) {
    url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${waypointsParam(route.stops, preferCoords)}&travelmode=driving`;
  } else if (origin || dest) {
    url = `https://www.google.com/maps/search/?api=1&query=${origin || dest}`;
  }

  if (url) Linking.openURL(url).catch(() => {});
}
