import { useEffect } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

/** Don't hit the update server more often than this while resuming. */
const CHECK_EVERY_MS = 30 * 60_000;

/**
 * Pick up OTA fixes while the app keeps running. expo-updates only checks on a
 * cold launch (and applies on the NEXT one), and drivers rarely kill the app —
 * so a fix could take days to land. On resume, check + download in the
 * background; apply it the next time the app goes to the background, where the
 * JS reload is invisible and can never interrupt an offer on screen.
 */
export function useOtaUpdates(): void {
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    let lastCheck = Date.now(); // the launch itself just checked
    let downloaded = false;

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        if (downloaded) Updates.reloadAsync().catch(() => {});
        return;
      }
      if (state !== "active" || downloaded || Date.now() - lastCheck < CHECK_EVERY_MS) return;
      lastCheck = Date.now();
      (async () => {
        try {
          const result = await Updates.checkForUpdateAsync();
          if (!result.isAvailable) return;
          const fetched = await Updates.fetchUpdateAsync();
          downloaded = fetched.isNew;
        } catch {
          /* offline / update server down — try again on a later resume */
        }
      })();
    });
    return () => sub.remove();
  }, []);
}
