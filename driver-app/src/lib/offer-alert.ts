import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Vibration } from "react-native";
import { cleanAddress, fareLabel } from "./format";
import type { Offer } from "./api";

/**
 * In-app alerting for a NEW offer that arrives while the driver has the app OPEN.
 *
 * The OS push chimes only when the app is in the background; in the foreground a
 * fresh offer surfaces silently via the 4s poll / the real-time channel, so the
 * driver can miss it. This plays a sound (a local notification the foreground
 * handler renders with sound) plus a short vibration, gated on the driver's
 * notification / sound / haptic prefs, and deduped per offer id so the same offer
 * never chimes twice (poll + realtime + a foreground push all point at one offer).
 */

const seen = new Set<number>();
let baselined = false;

/** A boolean pref stored by the settings screen ("1"/"0"); unset = on. */
async function prefOn(key: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(key)) !== "0";
  } catch {
    return true;
  }
}

/** Whether the first load has established which offers were already on screen. */
export function isBaselined(): boolean {
  return baselined;
}

/**
 * Record the offers already present at first load so they don't chime — the driver
 * just opened the app and can see them. Call once, after the initial fetch.
 */
export function baselineOffers(ids: (number | null | undefined)[]): void {
  for (const id of ids) if (typeof id === "number") seen.add(id);
  baselined = true;
}

/** Mark an offer as already alerted (e.g. a foreground OS push handled it), so the
 *  poll/realtime path that follows doesn't chime for it a second time. */
export function markAlerted(id: number | null | undefined): void {
  if (typeof id === "number" && Number.isFinite(id)) seen.add(id);
}

/**
 * Chime + vibrate for a genuinely new pending offer. No-op until {@link baselineOffers}
 * has run, for a non-pending offer, or one already alerted.
 */
export async function alertOffer(offer: Offer | null | undefined): Promise<void> {
  if (!baselined || !offer || offer.status !== "pending" || seen.has(offer.id)) return;
  seen.add(offer.id);

  if (!(await prefOn("pref.notifications"))) return;

  if (await prefOn("pref.haptic")) {
    Vibration.vibrate(400);
  }

  const sound = await prefOn("pref.sound");
  const dropoff = cleanAddress(offer.dropoff_address);
  await Notifications.scheduleNotificationAsync({
    content: {
      // Word-free, data-driven — mirrors the backend push (fare · destination).
      title: `${fareLabel(offer.fare_formatted, offer.fare_amount)}${dropoff ? ` · ${dropoff}` : ""}`,
      body: cleanAddress(offer.pickup_address),
      sound: sound ? "default" : undefined,
      data: { offer_id: String(offer.id) },
    },
    trigger: null,
  }).catch(() => {});
}
