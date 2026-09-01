import * as SecureStore from "expo-secure-store";
import { Vibration } from "react-native";
import { playOfferSound } from "./sound";
import type { Offer } from "./api";

/**
 * In-app alerting for a NEW offer that arrives while the driver has the app OPEN.
 *
 * The OS push chimes only in the background; in the foreground a fresh offer surfaces
 * silently via the real-time socket (Reverb) / the poll, so the driver can miss it.
 * This plays a chime (directly, via expo-audio — reliable even on silent) plus a short
 * vibration, gated on the driver's notification / sound / haptic prefs.
 *
 * Deduped per offer id, and only offers that ARRIVED after the app opened chime — so
 * the offers already on screen at launch stay quiet. Works from any screen (home or
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
 *  socket/poll refresh that follows doesn't chime for it a second time. */
export function markAlerted(id: number | null | undefined): void {
  if (typeof id === "number" && Number.isFinite(id)) seen.add(id);
}

/**
 * Chime + vibrate for a genuinely new pending offer. No-op for a non-pending offer,
 * one already alerted, or one that arrived before the app opened.
 */
export async function alertOffer(offer: Offer | null | undefined): Promise<void> {
  if (!offer || offer.status !== "pending" || seen.has(offer.id)) return;

  const received = offer.received_at ? new Date(offer.received_at).getTime() : 0;
  if (received && received < APP_OPENED_AT - FRESH_GRACE_MS) return; // pre-existing offer

  seen.add(offer.id);

  if (!(await prefOn("pref.notifications"))) return;
  if (await prefOn("pref.sound")) playOfferSound();
  if (await prefOn("pref.haptic")) Vibration.vibrate(400);
}
