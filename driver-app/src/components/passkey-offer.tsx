import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { PasskeyAlreadyRegisteredError, PasskeyCancelledError, passkeysAvailable } from "@/lib/passkeys";
import { enrolPasskey } from "@/lib/passkey-enrol";
import { useToast } from "@/components/toast";
import { t } from "@/lib/i18n";

// Per driver, not per device: on a shared phone each driver gets their own
// one-time offer instead of inheriting someone else's answer.
function dismissedKey(driverId: number | string): string {
  return `passkey_offer_dismissed_${driverId}`;
}

/** Whether the one-time offer should be made: supported, never answered, none yet. */
async function shouldOffer(key: string): Promise<boolean> {
  if ((await SecureStore.getItemAsync(key).catch(() => null)) === "1") return false;
  if (!(await passkeysAvailable())) return false;
  const mine = await api.passkeys().catch(() => null);
  return mine !== null && mine.data.length === 0;
}

/**
 * Renders nothing. Right after a driver's OTP sign-in it asks, ONCE, whether to
 * add a passkey. Any answer (including dismissing the dialog) is remembered, so
 * it never nags; Settings stays the place to add one later.
 */
export function PasskeyOffer() {
  const { passkeyOffer, closePasskeyOffer, driver } = useAuth();
  const driverId = driver?.id;
  const toast = useToast();
  // The toast api is a fresh object per render: keep the effect keyed on the
  // offer flag alone so a re-render cannot restart it mid-check.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!passkeyOffer || driverId == null) return;
    const key = dismissedKey(driverId);

    async function enrol() {
      try {
        await enrolPasskey();
        toastRef.current.show(t("passkey.added"), "success");
      } catch (e) {
        if (e instanceof PasskeyCancelledError) return;
        toastRef.current.show(t(e instanceof PasskeyAlreadyRegisteredError ? "passkey.exists" : "passkey.addError"), "error");
      }
    }

    async function offer() {
      const ask = await shouldOffer(key).catch(() => false);
      if (!ask) return closePasskeyOffer();
      // Remembered up front: every way out of the dialog counts as an answer.
      await SecureStore.setItemAsync(key, "1").catch(() => {});
      closePasskeyOffer();
      Alert.alert(t("passkey.offerTitle"), t("passkey.offerBody"), [
        { text: t("passkey.offerLater"), style: "cancel" },
        { text: t("passkey.offerAdd"), onPress: () => void enrol() },
      ]);
    }

    void offer();
  }, [passkeyOffer, closePasskeyOffer, driverId]);

  return null;
}
