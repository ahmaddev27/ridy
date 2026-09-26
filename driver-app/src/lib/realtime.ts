import Echo from "laravel-echo";
import Pusher from "pusher-js/react-native";
import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const BASE = extra.apiUrl ?? "https://reidey.de";
const HOST = extra.reverbHost ?? "reidey.de";
const KEY = extra.reverbKey ?? "";

export type RealtimeHandle = { disconnect: () => void };

/** Payload of the backend's `offer.changed` broadcast (OfferBroadcast). */
export type OfferChangedEvent = { offer_id?: number; reason?: string };

type PusherConnection = { bind: (event: string, cb: (payload: { current?: string }) => void) => void };

/**
 * Open ONE Echo connection on the driver's private channel (Laravel Reverb).
 * `onChange` fires on every `offer.changed` broadcast; `onState` reports whether
 * the socket is currently connected, so pollers can slow down while it is.
 *
 * Returns null (a no-op) when no Reverb key is configured or the inputs are
 * missing, so the app simply keeps polling. Best-effort: any connection failure
 * is swallowed and the poll remains the safety net.
 */
export function connectDriverRealtime(
  driverId: number,
  token: string,
  onChange: (event: OfferChangedEvent) => void,
  onState: (connected: boolean) => void = () => {},
): RealtimeHandle | null {
  if (!KEY || !driverId || !token) return null;

  try {
    const echo = new Echo({
      broadcaster: "reverb",
      Pusher,
      key: KEY,
      wsHost: HOST,
      wsPort: 443,
      wssPort: 443,
      forceTLS: true,
      enabledTransports: ["ws", "wss"],
      authEndpoint: `${BASE}/api/v1/driver/broadcasting/auth`,
      auth: { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    });

    const connection = (echo.connector as unknown as { pusher?: { connection?: PusherConnection } }).pusher?.connection;
    connection?.bind("state_change", (states) => onState(states?.current === "connected"));

    echo.private(`driver.${driverId}`).listen(".offer.changed", (e: OfferChangedEvent) => onChange(e ?? {}));

    return {
      disconnect: () => {
        try {
          echo.leave(`driver.${driverId}`);
          echo.disconnect();
        } catch {
          /* already gone */
        }
        onState(false);
      },
    };
  } catch {
    return null;
  }
}
