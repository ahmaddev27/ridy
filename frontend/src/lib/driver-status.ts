/**
 * One source of truth for a driver's live presence, derived from Uber's raw
 * MONITORING_SUPPLY_STATUS_* enum. Three engaged/idle states plus offline, each
 * with a consistent color and i18n label key used everywhere (map, lists, …).
 */
export type Presence = "on_trip" | "en_route" | "online" | "offline";

const OFFLINE_TOKENS = ["OFFLINE", "UNAVAILABLE", "DISCONNECTED", "OFF_DUTY", "LOGGED_OUT"];

export function presence(status: string | null | undefined): Presence {
  const s = (status ?? "").toUpperCase();
  if (s.includes("ON_TRIP")) return "on_trip";
  if (s.includes("EN_ROUTE")) return "en_route";
  if (s === "" || OFFLINE_TOKENS.some((t) => s.includes(t))) return "offline";
  return "online";
}

/** Marker / dot color per state. */
export const PRESENCE_COLOR: Record<Presence, string> = {
  online: "#10b981", // available, no trip — green
  en_route: "#f59e0b", // heading to pickup — amber
  on_trip: "#0ea5e9", // rider aboard — sky
  offline: "#94a3b8", // slate
};

/** Badge background/text classes per state. */
export const PRESENCE_TONE: Record<Presence, string> = {
  online: "bg-success-bg text-success-fg",
  en_route: "bg-warning-bg text-warning-fg",
  on_trip: "bg-info-bg text-info-fg",
  offline: "bg-surface-2 text-ink-muted",
};

/** i18n key (under screens.map) for a state's label. */
export const PRESENCE_LABEL_KEY: Record<Presence, string> = {
  online: "online",
  en_route: "enRoute",
  on_trip: "onTrip",
  offline: "offline",
};
