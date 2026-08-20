import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { api } from "./api";
import { t } from "./i18n";

/** Category id shared with the backend (data.categoryId) so the notification
 *  renders the "Open in map" action. Keep in sync with DispatchNotifier. */
export const OFFER_CATEGORY = "offer";
export const OPEN_MAP_ACTION = "open_map";

let categoryRegistered = false;

/** Registers the "offer" notification category with a single "Open in map"
 *  action button. Idempotent — safe to call on every app start. */
export async function registerOfferCategory(): Promise<void> {
  if (categoryRegistered) return;
  categoryRegistered = true;
  try {
    await Notifications.setNotificationCategoryAsync(OFFER_CATEGORY, [
      {
        identifier: OPEN_MAP_ACTION,
        buttonTitle: t("notif.openMap"),
        options: { opensAppToForeground: false },
      },
    ]);
  } catch {
    categoryRegistered = false; // allow a later retry if registration failed
  }
}

// Offers are time-critical — always show them, with sound, even in foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Ask for permission, ensure a high-importance Android channel exists (so offers
 * pop with sound while the app is closed), fetch the device push token and
 * register it with the backend. A fleet owner registers on their User token via
 * the fleet endpoint (the driver endpoint would 401 their token); a driver
 * registers against themselves. Owners then receive a copy of every driver's offer.
 */
export async function registerForPush(owner = false): Promise<string | null> {
  if (!Device.isDevice) return null;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("offers", {
      name: "Ride offers",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
      bypassDnd: true,
    });
  }

  const { data: token } = await Notifications.getDevicePushTokenAsync();
  const platform = Platform.OS === "ios" ? "ios" : "android";
  try {
    if (owner) await api.fleetRegisterDevice(token, platform);
    else await api.registerDevice(token, platform);
  } catch {
    // Non-fatal: the driver is signed in; a later launch retries registration.
    return token;
  }
  return token;
}
