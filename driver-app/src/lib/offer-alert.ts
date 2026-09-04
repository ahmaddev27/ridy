import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Vibration } from "react-native";
import { cleanAddress, fareLabel } from "./format";
import { MULTISTOP_CHANNEL } from "./push";
import type { Offer } from "./api";

/**
 * In-app alerting for a NEW offer that arrives while the driver has the app OPEN.
 *
 * The OS push chimes only in the background; in the foreground a fresh offer surfaces
 * silently via the real-time socket (Reverb) / the poll, so the driver can miss it.
 * This presents a local notification — a banner (fare · destination) the foreground
 * handler renders WITH the system sound — plus a vibration, gated on the driver's
 * notification / sound / haptic prefs. Uses expo-notifications (already in the build)
 * so it ships over-the-air, no native rebuild.
 *
 * Deduped per offer id, and only offers that ARRIVED after the app opened alert — so
 * the offers already on screen at launch stay quiet. Works from any screen (home and
 * the offers feed both call it on a socket/poll refresh).
 */

const seen = new Set<number>();
const APP_OPENED_AT = Date.now();
/** Grace so an offer received just before launch still counts as "new". */
const FRESH_GRACE_MS = 60_000;

/** A boolean pref stored by the settings screen ("1"/"0"); unset = on. */
async function prefOn(key: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(key)) !== "0";
  } catch {
    return true;
  }
}

/** Mark an offer as already alerted (e.g. a foreground OS push handled it), so the
 *  socket/poll refresh that follows doesn't alert for it a second time. */
export function markAlerted(id: number | null | undefined): void {
  if (typeof id === "number" && Number.isFinite(id)) seen.add(id);
}

/**
 * Banner + sound + vibrate for a genuinely new pending offer. No-op for a non-pending
 * offer, one already alerted, or one that arrived before the app opened.
 */
export async function alertOffer(offer: Offer | null | undefined): Promise<void> {
  if (!offer || offer.status !== "pending" || seen.has(offer.id)) return;

  const received = offer.received_at ? new Date(offer.received_at).getTime() : 0;
  if (received && received < APP_OPENED_AT - FRESH_GRACE_MS) return; // pre-existing offer

  seen.add(offer.id);

  if (!(await prefOn("pref.notifications"))) return;

  if (await prefOn("pref.haptic")) {
    Vibration.vibrate(400);
  }

  const sound = await prefOn("pref.sound");
  const dropoff = cleanAddress(offer.dropoff_address);
  // A multi-stop offer routes to the louder "multistop" Android channel (urgent
  // vibration + lights); a single-drop offer delivers on the default channel.
  const multiStop = (offer.stops_count ?? 0) >= 2;
  await Notifications.scheduleNotificationAsync({
    content: {
      // Word-free, data-driven — mirrors the backend push (fare · destination).
      title: `${fareLabel(offer.fare_formatted, offer.fare_amount)}${dropoff ? ` · ${dropoff}` : ""}`,
      body: cleanAddress(offer.pickup_address),
      sound: sound ? "default" : undefined,
      data: { offer_id: String(offer.id) },
    },
    trigger: multiStop ? { channelId: MULTISTOP_CHANNEL } : null,
  }).catch(() => {});
}
