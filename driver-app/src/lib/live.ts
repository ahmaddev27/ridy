import { AppState, type AppStateStatus, type NativeEventSubscription } from "react-native";
import { connectDriverRealtime, type RealtimeHandle } from "./realtime";

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
export type LiveEvent = { reason: LiveReason; offerId?: number };
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

function openSocket(): void {
  if (!session || handle) return;
  handle = connectDriverRealtime(
    session.driverId,
    session.token,
    (e) => emitLive({ reason: "socket", offerId: typeof e.offer_id === "number" ? e.offer_id : undefined }),
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
