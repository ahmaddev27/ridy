import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { api } from "./api";

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
 * register it with the backend against the signed-in driver.
 */
export async function registerForPush(): Promise<string | null> {
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
  try {
    await api.registerDevice(token, Platform.OS === "ios" ? "ios" : "android");
  } catch {
    // Non-fatal: the driver is signed in; a later launch retries registration.
    return token;
  }
  return token;
}
