import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { getAPNSToken, getMessaging, getToken, registerDeviceForRemoteMessages } from "@react-native-firebase/messaging";
import { api } from "./api";
import { t } from "./i18n";

const PUSH_TOKEN_KEY = "reidey_push_token";

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

  // The backend delivers via FCM HTTP v1, so every device must present an FCM
  // registration token. On Android expo-notifications already returns one; on iOS
  // it returns the raw APNs token (which FCM rejects), so mint a real FCM token
  // through Firebase Messaging — it registers with APNs under the hood first.
  let token: string;
  if (Platform.OS === "ios") {
    const fcm = getMessaging();
    await registerDeviceForRemoteMessages(fcm);
    // iOS hands Firebase the APNs token asynchronously AFTER registration resolves;
    // calling getToken() before it lands throws "No APNS token specified before
    // fetching FCM Token". Poll briefly for the APNs token first, then fetch FCM.
    let apns = await getAPNSToken(fcm);
    for (let i = 0; i < 10 && !apns; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      apns = await getAPNSToken(fcm);
    }
    if (!apns) return null; // APNs never registered (entitlement/network) — retry next launch
    token = await getToken(fcm);
  } else {
    token = (await Notifications.getDevicePushTokenAsync()).data as string;
  }
  const platform = Platform.OS === "ios" ? "ios" : "android";
  // Remember the token so logout can deregister THIS device and stop its pushes.
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token).catch(() => {});
  try {
    if (owner) await api.fleetRegisterDevice(token, platform);
    else await api.registerDevice(token, platform);
  } catch {
    // Non-fatal: the driver is signed in; a later launch retries registration.
    return token;
  }
  return token;
}

/** Deregister this device's push token on logout so it stops receiving offers.
 *  Best-effort and must run while the session token is still valid. */
export async function unregisterForPush(owner: boolean): Promise<void> {
  const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY).catch(() => null);
  if (!token) return;
  try {
    if (owner) await api.fleetDeleteDevice(token);
    else await api.deleteDevice(token);
  } catch {
    /* best-effort */
  }
  await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY).catch(() => {});
}
