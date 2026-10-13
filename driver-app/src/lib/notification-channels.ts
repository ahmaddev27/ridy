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

/**
 * A decision from the driver's own company about something they sent: a Beleg
 * or a note accepted or rejected. Its own channel because it is NOT an offer —
 * an offer expires in minutes and earns the loudest sound the app has, where
 * this is news the driver reads when they get to it. Default importance, no
 * custom sound, so it never competes with a live offer for attention.
 */
export const DOCUMENTS_CHANNEL = "documents";

/**
 * Category id shared with the backend (`data.categoryId`), kept in sync with
 * DispatchNotifier.
 *
 * It is registered with NO ACTIONS, on purpose. An offer notification carries no
 * buttons: the decision lives in the pop-up, on the screen that shows the fare and
 * the countdown it should be judged on, and a tap on a tray notification — under
 * time pressure, away from that context — is the wrong place for it. "Open in map"
 * went the same way: it meant nothing on an offer nobody had taken yet, and once
 * the ride IS the driver's they are on the offer screen, which has the button.
 *
 * The category is still named and registered, because the backend sets this field
 * to mark a push as an offer push (FcmPushSender::isOfferPush) and that is what
 * gives it its TTL and collapse key.
 */
export const OFFER_CATEGORY = "offer";

/** True when an FCM/local payload describes a multi-stop offer (louder channel). */
export function isMultiStop(stopsCount: unknown): boolean {
  const n = Number(stopsCount ?? 0);
  return Number.isFinite(n) && n >= 2;
}
