import { AppState, type AppStateStatus, type NativeEventSubscription } from "react-native";
import { connectDriverRealtime, type OfferChangedEvent, type RealtimeHandle } from "./realtime";

/**
 * Session-scoped "something changed, reload" bus.
 *
 * Owns the ONE WebSocket per signed-in driver (instead of one per focused
 * screen) and fans out three triggers to whichever screens are subscribed:
 *   - "socket": an `offer.changed` broadcast (carries the offer id)
 *   - "push":   an offer push arrived while the app is open
 *   - "resume": the app came back to the foreground (catch up on missed events)
 *
 * The socket is dropped after a while in the background (FCM carries background
 * delivery) and reopened on resume.
 */
export type LiveReason = "socket" | "push" | "resume";

/**
 * The bare offer fields a `new` broadcast inlines — fare, route, rider and the
 * two timestamps the countdown needs. Exactly what Uber's dispatch payload gives
 * away for free, so the instant pop-up renders with ZERO extra fetch. Anything
 * that needs geocoding (distance, €/km) is NOT here on purpose: it fills in later.
 */
export type LiveOfferPayload = {
  offerUuid: string | null;
  fare: string | null;
  fareAmount: number | null;
  pickup: string | null;
  dropoff: string | null;
  riderName: string | null;
  acceptWindow: number | null;
  offerGeneratedAt: string | null;
  receivedAt: string | null;
};

export type LiveEvent = {
  reason: LiveReason;
  offerId?: number;
  /** The broadcast's own reason — `new` | `status` | `multistop` — when it came
   *  over the socket. Distinct from `reason`, which says HOW we heard. */
  offerReason?: string;
  /** Present only on a `new` socket broadcast that inlined the bare fields. */
  offer?: LiveOfferPayload;
};
type Listener = (event: LiveEvent) => void;

/** How long the socket may stay open while the app is in the background. */
const BACKGROUND_DISCONNECT_MS = 30_000;

const listeners = new Set<Listener>();
let session: { driverId: number; token: string } | null = null;
let handle: RealtimeHandle | null = null;
let connected = false;
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: NativeEventSubscription | null = null;

/** Subscribe to live events; returns the unsubscribe function. */
export function subscribeLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify every subscribed screen. */
export function emitLive(event: LiveEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      /* a broken listener must not starve the others */
    }
  });
}

/** Whether the realtime socket is currently connected (pollers slow down then). */
export function isLiveConnected(): boolean {
  return connected;
}

/** Narrow a broadcast field to a non-empty string, else null. */
function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Narrow a broadcast field to a finite number, else null. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The bare fields of a `new` broadcast, or undefined when it carried none (an
 * older backend, or any other reason). Every field is narrowed here, once, so no
 * screen has to re-check what the wire actually sent.
 */
function offerPayloadOf(e: OfferChangedEvent): LiveOfferPayload | undefined {
  if (e.reason !== "new") return undefined;
  const payload: LiveOfferPayload = {
    offerUuid: str(e.offer_uuid),
    // Uber sends `formattedUFP`, a string; a numeric fare is accepted too so the
    // app formats it itself (the project's one money shape) when it gets one.
    fare: str(e.fare),
    fareAmount: num(e.fare),
    pickup: str(e.pickup),
    dropoff: str(e.dropoff),
    riderName: str(e.rider_name),
    acceptWindow: num(e.accept_window),
    offerGeneratedAt: str(e.offer_generated_at),
    receivedAt: str(e.received_at),
  };
  // Without a receive/generation time there is no window to count down, so the
  // pop-up would have to fetch anyway — let it, rather than render a dead ring.
  return payload.receivedAt || payload.offerGeneratedAt ? payload : undefined;
}

function openSocket(): void {
  if (!session || handle) return;
  handle = connectDriverRealtime(
    session.driverId,
    session.token,
    (e) =>
      emitLive({
        reason: "socket",
        offerId: typeof e.offer_id === "number" ? e.offer_id : undefined,
        offerReason: str(e.reason) ?? undefined,
        offer: offerPayloadOf(e),
      }),
    (isUp) => {
      const wasUp = connected;
      connected = isUp;
      // Reconnected after a gap: events may have been missed — reload once.
      if (isUp && !wasUp) emitLive({ reason: "resume" });
    },
  );
}

function closeSocket(): void {
  handle?.disconnect();
  handle = null;
  connected = false;
}

function onAppState(state: AppStateStatus): void {
  if (state === "active") {
    if (backgroundTimer) {
      clearTimeout(backgroundTimer);
      backgroundTimer = null;
    }
    openSocket();
    emitLive({ reason: "resume" });
    return;
  }
  if (!backgroundTimer && handle) {
    backgroundTimer = setTimeout(() => {
      backgroundTimer = null;
      closeSocket();
    }, BACKGROUND_DISCONNECT_MS);
  }
}

/**
 * Start (or keep) the realtime session for this driver + token. Idempotent for
 * the same identity; a different identity tears the old socket down first.
 * Owners have no driver channel — pass nothing and only push/resume events flow.
 */
export function startLive(driverId: number | null, token: string | null): void {
  if (!appStateSub) appStateSub = AppState.addEventListener("change", onAppState);
  if (!driverId || !token) {
    stopSocketSession();
    return;
  }
  if (session && session.driverId === driverId && session.token === token) {
    openSocket();
    return;
  }
  stopSocketSession();
  session = { driverId, token };
  if (AppState.currentState === "active") openSocket();
}

function stopSocketSession(): void {
  if (backgroundTimer) {
    clearTimeout(backgroundTimer);
    backgroundTimer = null;
  }
  closeSocket();
  session = null;
}

/** Tear everything down (logout / session death). */
export function stopLive(): void {
  stopSocketSession();
  appStateSub?.remove();
  appStateSub = null;
}
