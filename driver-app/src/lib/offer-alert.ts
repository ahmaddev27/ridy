import * as Notifications from "expo-notifications";
import { AppState, Vibration } from "react-native";
import { cleanAddress, fareLabel } from "./format";
import { MULTISTOP_CHANNEL, OFFERS_CHANNEL, isMultiStop } from "./notification-channels";
import { freshUntil, isFreshOffer } from "./offer-freshness";
import { loadPrefs } from "./prefs";
import type { Offer } from "./api";

/**
 * In-app FALLBACK alert for a new offer while the app is open.
 *
 * The normal path is the FCM push: in the foreground the notification handler
 * (push.ts) presents it with the channel sound. This module only covers an offer
 * that surfaces through the socket/poll WITHOUT a push (push failed or is late):
 * it waits a short grace for the push, then presents a local notification.
 *
 * De-duplicated per `${offerId}:${kind}` so a later multi-stop follow-up for the
 * same offer can still alert once. Freshness is judged by the offer's own accept
 * window, not by when the app started — a stale pending offer never chimes.
 */

/** How long the FCM push gets to arrive before the local fallback fires. */
const PUSH_GRACE_MS = 2_000;

/** Offers that actually rang (push presented or fallback shown). */
const alerted = new Set<string>();
/** Offers the socket/poll judged stale — never fallback-chimed, but NOT treated as
 *  alerted, so their real FCM push (e.g. with phone-clock skew) still presents. */
const skipped = new Set<string>();
const pendingFallback = new Map<string, ReturnType<typeof setTimeout>>();

function keyFor(offerId: number | string, multi: boolean): string {
  return `${offerId}:${multi ? "multi" : "new"}`;
}

/** Record an offer as already alerted (e.g. its FCM push was presented), and
 *  cancel any pending local fallback for it. */
export function markAlerted(offerId: number | string | null | undefined, multi = false): void {
  if (offerId == null || offerId === "") return;
  const key = keyFor(offerId, multi);
  alerted.add(key);
  const timer = pendingFallback.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingFallback.delete(key);
  }
}

/** Whether this offer (kind) was already alerted in this app session. */
export function wasAlerted(offerId: number | string | null | undefined, multi = false): boolean {
  if (offerId == null || offerId === "") return false;
  return alerted.has(keyFor(offerId, multi));
}

export { freshUntil, isFreshOffer };

/**
 * Schedule the fallback alert for a genuinely new pending offer. No-op for a
 * non-pending, stale or already-alerted offer.
 */
export function alertOffer(offer: Offer | null | undefined): void {
  if (!offer || offer.status !== "pending") return;
  const multi = isMultiStop(offer.stops_count);
  const key = keyFor(offer.id, multi);
  if (alerted.has(key) || skipped.has(key) || pendingFallback.has(key)) return;
  if (!isFreshOffer(offer)) {
    skipped.add(key); // stale: no fallback chime, but its push may still present
    return;
  }
  const timer = setTimeout(() => {
    pendingFallback.delete(key);
    void presentFallback(offer, multi, key);
  }, PUSH_GRACE_MS);
  pendingFallback.set(key, timer);
}

async function presentFallback(offer: Offer, multi: boolean, key: string): Promise<void> {
  // The push won the race, the app left the foreground (the OS push covers the
  // background), or the window closed during the grace period.
  if (alerted.has(key) || AppState.currentState !== "active" || !isFreshOffer(offer)) return;
  alerted.add(key);

  const prefs = await loadPrefs();
  if (!prefs.notifications) return;
  if (prefs.haptic) Vibration.vibrate(400);

  const dropoff = cleanAddress(offer.dropoff_address);
  await Notifications.scheduleNotificationAsync({
    content: {
      // Word-free, data-driven — mirrors the backend push (fare · destination).
      title: `${fareLabel(offer.fare_formatted, offer.fare_amount)}${dropoff ? ` · ${dropoff}` : ""}`,
      body: cleanAddress(offer.pickup_address),
      // iOS plays this bundled wav; Android takes the sound from the channel.
      sound: prefs.sound ? (multi ? "multi.wav" : "normal.wav") : undefined,
      data: { offer_id: String(offer.id), stops_count: String(offer.stops_count ?? 0), local: "1" },
    },
    // Always name the channel: without one expo falls back to "Miscellaneous".
    trigger: { channelId: multi ? MULTISTOP_CHANNEL : OFFERS_CHANNEL },
  }).catch(() => {});
}
