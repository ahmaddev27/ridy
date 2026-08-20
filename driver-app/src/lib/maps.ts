import { Linking } from "react-native";

/**
 * Open the maps app at the pickup → drop-off route. Falls back to a plain search
 * when only one address is present, and no-ops when neither is. Shared by the
 * offer card, offer detail, and the notification "Open in map" action.
 */
export function openRouteInMaps(pickup?: string | null, dropoff?: string | null): void {
  const origin = (pickup ?? "").trim();
  const dest = (dropoff ?? "").trim();

  let url: string | null = null;
  if (origin && dest) {
    url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=driving`;
  } else if (origin || dest) {
    url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(origin || dest)}`;
  }

  if (url) Linking.openURL(url).catch(() => {});
}
