import { useCallback, useEffect, useState } from "react";
import { AppState, Linking } from "react-native";
import { ensurePushRegistered, getPushHealth, requestPushPermission, type PushHealth } from "./push";

/**
 * Live view of whether offer notifications can actually ring on this phone:
 * OS permission + (Android) the offers channel not muted/blocked. Re-checked on
 * mount and whenever the app returns to the foreground (the driver may have
 * just fixed it in the system settings).
 */
export function usePushHealth() {
  const [health, setHealth] = useState<PushHealth | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getPushHealth();
      setHealth(next);
      // Permission came back (fixed in Settings): register right away.
      if (next.granted) void ensurePushRegistered();
    } catch {
      /* keep the last known state */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  /** Fix it: ask again when the OS still allows the prompt, else open Settings. */
  const fix = useCallback(async () => {
    if (health && !health.granted && health.canAskAgain) {
      await requestPushPermission().catch(() => false);
      await refresh();
      return;
    }
    Linking.openSettings().catch(() => {});
  }, [health, refresh]);

  const ok = !health || (health.granted && health.channelOk);
  return { health, ok, fix, refresh };
}
