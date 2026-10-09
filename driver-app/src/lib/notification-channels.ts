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

/** Category id shared with the backend (data.categoryId) so the notification
 *  renders the "Open in map" action. Keep in sync with DispatchNotifier. */
export const OFFER_CATEGORY = "offer";
export const OPEN_MAP_ACTION = "open_map";

/**
 * The semantic type Reidey's `AppNotification` carries for a rejected
 * submission. The backend stores a stable type plus structured params and
 * **never pre-rendered text**, so the sentence below is built here, in the
 * driver's own language, from `params`.
 */
export const SUBMISSION_REJECTED_TYPE = "elprofessor.submission_rejected";

/** True when an FCM/local payload describes a multi-stop offer (louder channel). */
export function isMultiStop(stopsCount: unknown): boolean {
  const n = Number(stopsCount ?? 0);
  return Number.isFinite(n) && n >= 2;
}
