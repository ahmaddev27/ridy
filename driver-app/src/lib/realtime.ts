import Echo from "laravel-echo";
import Pusher from "pusher-js/react-native";
import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const BASE = extra.apiUrl ?? "https://reidey.de";
const HOST = extra.reverbHost ?? "reidey.de";
const KEY = extra.reverbKey ?? "";

export type RealtimeHandle = { disconnect: () => void };

/**
 * Subscribe the driver's private real-time channel (Laravel Reverb). On an
 * `offer.changed` broadcast — a fresh offer or a status move — it calls `onChange`
 * so the open screen can reload instantly instead of waiting for the next poll.
 *
 * Returns null (a no-op) when no Reverb key is configured or the inputs are
 * missing, so the app simply keeps polling. Best-effort: any connection failure
 * is swallowed and the poll remains the safety net.
 */
export function connectDriverRealtime(
  driverId: number,
  token: string,
  onChange: () => void,
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

    echo.private(`driver.${driverId}`).listen(".offer.changed", () => onChange());

    return {
      disconnect: () => {
        try {
          echo.leave(`driver.${driverId}`);
          echo.disconnect();
        } catch {
          /* already gone */
        }
      },
    };
  } catch {
    return null;
  }
}
