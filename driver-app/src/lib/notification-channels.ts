/**
 * Android notification channel ids shared by the push handler, the in-app
 * fallback alert and the backend (FcmPushSender sets `channel_id` to one of
 * these). Kept in their own module so push.ts and offer-alert.ts can both use
 * them without importing each other.
 *
 * A channel's sound/importance is fixed once Android creates it, so these ids
 * must only change together with the backend's per-device channel choice.
 */
export const OFFERS_CHANNEL = "offers";
export const MULTISTOP_CHANNEL = "multistop";

/** Category id shared with the backend (data.categoryId) so the notification
 *  renders the "Open in map" action. Keep in sync with DispatchNotifier. */
export const OFFER_CATEGORY = "offer";
export const OPEN_MAP_ACTION = "open_map";

/** True when an FCM/local payload describes a multi-stop offer (louder channel). */
export function isMultiStop(stopsCount: unknown): boolean {
  const n = Number(stopsCount ?? 0);
  return Number.isFinite(n) && n >= 2;
}
