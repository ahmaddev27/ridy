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

  // `soundOk === false` is the state this hook used to miss entirely: offers
  // arrive and the driver hears nothing, while the banner said all was well.
  // `null` means the platform did not answer — never nag on a guess.
  const ok = !health || (health.granted && health.channelOk && health.soundOk !== false);
  /** Everything is permitted, but the phone will deliver offers silently. */
  const silent = !!health && health.granted && health.channelOk && health.soundOk === false;
  return { health, ok, silent, fix, refresh };
}
