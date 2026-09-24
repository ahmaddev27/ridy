import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform, type NativeEventSubscription } from "react-native";
import {
  deleteToken,
  getAPNSToken,
  getMessaging,
  getToken,
  onTokenRefresh,
  registerDeviceForRemoteMessages,
} from "@react-native-firebase/messaging";
import { api } from "./api";
import { t, onLocaleChange } from "./i18n";
import { emitLive } from "./live";
import { markAlerted, wasAlerted } from "./offer-alert";
import { getPrefs } from "./prefs";
import { Sentry } from "./sentry";
import {
  MULTISTOP_CHANNEL,
  OFFERS_CHANNEL,
  OFFER_CATEGORY,
  OPEN_MAP_ACTION,
  isMultiStop,
} from "./notification-channels";

export { MULTISTOP_CHANNEL, OFFERS_CHANNEL, OFFER_CATEGORY, OPEN_MAP_ACTION };

/**
 * Push delivery for the driver app.
 *
 * Android: FCM is received by expo-notifications' messaging service. The
 * react-native-firebase messaging service/receiver are stripped from the
 * manifest (plugins/withExpoOwnsFcm.js) — they used to outrank expo's service
 * and swallow every foreground offer push. RNFB stays linked for deleteToken.
 * iOS: RNFB mints the FCM token (expo only returns the raw APNs token).
 */

const PUSH_TOKEN_KEY = "reidey_push_token";
/** JSON { owner, at } for the last SUCCESSFUL server registration. */
const PUSH_META_KEY = "reidey_push_meta";
/** Re-register at least this often so the server's last_used_at stays fresh. */
const REREGISTER_AFTER_MS = 24 * 3600 * 1000;
/** Bounded backoff for a failed registration while the app is open. */
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];

// ---------------------------------------------------------------------------
// Foreground presentation
// ---------------------------------------------------------------------------

const SILENT = {
  shouldShowAlert: false,
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
} as const;

// Offers are time-critical — show them in the foreground with the channel sound,
// honouring the in-app prefs. A remote push for an offer the in-app fallback
// already alerted stays quiet (no double chime).
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
    const offerId = data.offer_id as string | number | undefined;
    const isRemoteOffer = offerId != null && data.local !== "1";
    if (isRemoteOffer) {
      const multi = isMultiStop(data.stops_count);
      if (wasAlerted(offerId, multi)) return SILENT;
      markAlerted(offerId, multi);
    }
    const prefs = getPrefs();
    const show = offerId == null || prefs.notifications;
    return {
      shouldShowAlert: show,
      shouldShowBanner: show,
      shouldShowList: true,
      shouldPlaySound: show && prefs.sound,
      shouldSetBadge: false,
    };
  },
});

// Any offer push that lands while the app is open refreshes the visible screen.
Notifications.addNotificationReceivedListener((notification) => {
  const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
  if (data.offer_id == null || data.local === "1") return;
  const id = Number(data.offer_id);
  emitLive({ reason: "push", offerId: Number.isFinite(id) ? id : undefined });
});

// Opening the app from its icon while an offer push still sits in the tray: that
// push already rang in the background, so record it before the resume reload's
// in-app fallback (2 s grace) could ring it again.
AppState.addEventListener("change", (state) => {
  if (state !== "active") return;
  Notifications.getPresentedNotificationsAsync()
    .then((list) => {
      for (const n of list) {
        const data = (n.request.content.data ?? {}) as Record<string, unknown>;
        if (data.offer_id == null || data.local === "1") continue;
        markAlerted(data.offer_id as string | number, isMultiStop(data.stops_count));
      }
    })
    .catch(() => { /* unsupported: the fallback grace still dedupes most cases */ });
});

// ---------------------------------------------------------------------------
// Category ("Open in map" action) + channels — re-labelled on language change
// ---------------------------------------------------------------------------

async function writeOfferCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(OFFER_CATEGORY, [
    {
      identifier: OPEN_MAP_ACTION,
      buttonTitle: t("notif.openMap"),
      // The app must come to the foreground: iOS refuses to open a URL (Maps)
      // from a background action handler.
      options: { opensAppToForeground: true },
    },
  ]);
}

/** Registers the "offer" notification category. Safe to call repeatedly. */
export async function registerOfferCategory(): Promise<void> {
  try {
    await writeOfferCategory();
  } catch {
    /* retried on the next call / language change */
  }
}

/**
 * Ensure both Android channels exist. Re-running it only updates the NAME —
 * Android keeps the user's (and the original) sound/importance settings.
 */
async function ensureChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(OFFERS_CHANNEL, {
    name: t("notif.channelOffers"),
    importance: Notifications.AndroidImportance.MAX,
    sound: "normal.wav", // bundled via the expo-notifications `sounds` config (app.json)
    vibrationPattern: [0, 250, 250, 250],
    // Do-Not-Disturb bypass needs the DND-access special permission, which the
    // app doesn't request — so don't claim it here.
    bypassDnd: false,
  });
  // A louder channel for multi-stop / new-stops alerts: distinct sound, urgent
  // vibration and lights. The backend routes such pushes here.
  await Notifications.setNotificationChannelAsync(MULTISTOP_CHANNEL, {
    name: t("notif.channelMultistop"),
    importance: Notifications.AndroidImportance.MAX,
    sound: "multi.wav",
    vibrationPattern: [0, 400, 200, 400, 200, 600],
    bypassDnd: false,
    enableLights: true,
    lightColor: "#2563EB",
  });
}

onLocaleChange(() => {
  void registerOfferCategory();
  void ensureChannels().catch(() => {});
});

// ---------------------------------------------------------------------------
// Health (permission + channel) — surfaced as a banner when offers can't ring
// ---------------------------------------------------------------------------

export type PushHealth = {
  /** OS notification permission granted. */
  granted: boolean;
  /** The OS will still show the permission prompt (else: open Settings). */
  canAskAgain: boolean;
  /** The offers channel exists and is loud enough to pop (Android). */
  channelOk: boolean;
};

export async function getPushHealth(): Promise<PushHealth> {
  const perm = await Notifications.getPermissionsAsync();
  let channelOk = true;
  // Android < 8 (API 26) has no notification channels — expo returns null there,
  // so only the app-level permission decides whether offers can ring.
  if (Platform.OS === "android" && Number(Platform.Version) >= 26) {
    await ensureChannels().catch(() => {});
    const channel = await Notifications.getNotificationChannelAsync(OFFERS_CHANNEL).catch(() => null);
    channelOk = !!channel && channel.importance >= Notifications.AndroidImportance.HIGH;
  } else if (Platform.OS === "android") {
    channelOk = true;
  } else if (perm.granted && perm.ios) {
    channelOk = perm.ios.allowsAlert !== false;
  }
  return { granted: perm.granted, canAskAgain: perm.canAskAgain, channelOk };
}

/** Ask for notification permission when the OS still allows the prompt. */
export async function requestPushPermission(): Promise<boolean> {
  const perm = await Notifications.requestPermissionsAsync();
  if (perm.granted) void ensurePushRegistered(true);
  return perm.granted;
}

// ---------------------------------------------------------------------------
// Token registration (session-scoped, retried, rotation-aware)
// ---------------------------------------------------------------------------

type Session = { owner: boolean };
let session: Session | null = null;
let inFlight: Promise<boolean> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryIndex = 0;
let unsubscribeRefresh: (() => void) | null = null;
let appStateSub: NativeEventSubscription | null = null;
let lastForegroundCheck = 0;

/** Fetch this device's FCM registration token, or null without permission. */
async function fetchDeviceToken(): Promise<string | null> {
  if (Platform.OS === "ios") {
    const fcm = getMessaging();
    await registerDeviceForRemoteMessages(fcm);
    // iOS hands Firebase the APNs token asynchronously AFTER registration
    // resolves; getToken() before it lands throws. Poll briefly; if APNs still
    // hasn't answered, throw so the retry/backoff (and onTokenRefresh) cover it.
    let apns = await getAPNSToken(fcm);
    for (let i = 0; i < 10 && !apns; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      apns = await getAPNSToken(fcm);
    }
    if (!apns) throw new Error("apns_token_unavailable");
    return await getToken(fcm);
  }
  const token = (await Notifications.getDevicePushTokenAsync()).data;
  return typeof token === "string" ? token : null;
}

async function readMeta(): Promise<{ owner: boolean; at: number } | null> {
  try {
    const raw = await SecureStore.getItemAsync(PUSH_META_KEY);
    const parsed = raw ? (JSON.parse(raw) as { owner?: unknown; at?: unknown }) : null;
    if (!parsed || typeof parsed.at !== "number") return null;
    return { owner: parsed.owner === true, at: parsed.at };
  } catch {
    return null;
  }
}

function scheduleRetry(): void {
  if (!session || retryTimer) return;
  const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
  retryIndex++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (AppState.currentState === "active") void ensurePushRegistered(true);
  }, delay);
}

function resetRetry(): void {
  retryIndex = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/** POST the token to the backend — only a 2xx counts as registered. */
async function registerToken(token: string, force: boolean): Promise<boolean> {
  const current = session;
  if (!current) return false;
  const [stored, meta] = await Promise.all([
    SecureStore.getItemAsync(PUSH_TOKEN_KEY).catch(() => null),
    readMeta(),
  ]);
  const upToDate =
    stored === token && meta !== null && meta.owner === current.owner && Date.now() - meta.at < REREGISTER_AFTER_MS;
  if (upToDate && !force) {
    resetRetry();
    return true;
  }

  const platform = Platform.OS === "ios" ? "ios" : "android";
  // Human phone model + OS version, so the manager dashboard can show which
  // device the driver is on. Best-effort — omitted when the OS doesn't expose it.
  const device = { name: Device.modelName, osVersion: Device.osVersion };
  try {
    if (current.owner) await api.fleetRegisterDevice(token, platform, device);
    else await api.registerDevice(token, platform, device);
  } catch {
    scheduleRetry();
    return false;
  }
  if (session !== current) return false; // signed out meanwhile

  // The token rotated: drop the old row so the server stops targeting it.
  if (stored && stored !== token) {
    void (current.owner ? api.fleetDeleteDevice(stored) : api.deleteDevice(stored)).catch(() => {});
  }
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token).catch(() => {});
  await SecureStore.setItemAsync(PUSH_META_KEY, JSON.stringify({ owner: current.owner, at: Date.now() })).catch(() => {});
  resetRetry();
  return true;
}

/**
 * Make sure this device is registered for offer pushes. Never throws; one
 * attempt at a time; a failure retries with backoff while the app is open.
 * Without permission it asks once (when the OS still allows it) and otherwise
 * leaves the existing registration alone, so re-enabling works immediately.
 */
export function ensurePushRegistered(force = false): Promise<boolean> {
  if (!session) return Promise.resolve(false);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      if (!Device.isDevice) return false;
      await ensureChannels().catch(() => {});
      let perm = await Notifications.getPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
      if (!perm.granted) return false;
      const token = await fetchDeviceToken();
      if (!token) return false;
      return await registerToken(token, force);
    } catch (e) {
      Sentry.captureException(e, { tags: { push_register_failed: Platform.OS } });
      scheduleRetry();
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Start push registration for the signed-in identity: registers now, follows
 * token rotation, and re-checks (throttled) whenever the app returns to the
 * foreground. Returns the stop function.
 */
export function startPushRegistration(owner: boolean): () => void {
  stopPushRegistration();
  session = { owner };
  void ensurePushRegistered(true);

  const onNewToken = (token: string) => {
    if (typeof token === "string" && token) void registerToken(token, true);
  };
  if (Platform.OS === "ios") {
    unsubscribeRefresh = onTokenRefresh(getMessaging(), onNewToken);
  } else {
    const sub = Notifications.addPushTokenListener(({ data }) => onNewToken(data as string));
    unsubscribeRefresh = () => sub.remove();
  }

  appStateSub = AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    const now = Date.now();
    if (now - lastForegroundCheck < 5 * 60_000) return;
    lastForegroundCheck = now;
    void ensurePushRegistered();
  });
  return stopPushRegistration;
}

/** Stop retries and listeners (logout / identity change). */
export function stopPushRegistration(): void {
  session = null;
  resetRetry();
  unsubscribeRefresh?.();
  unsubscribeRefresh = null;
  appStateSub?.remove();
  appStateSub = null;
}

/** Deregister this device's push token on the server (logout). Best-effort and
 *  must run while the session token is still valid. */
export async function unregisterForPush(owner: boolean): Promise<void> {
  const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY).catch(() => null);
  if (!token) return;
  try {
    if (owner) await api.fleetDeleteDevice(token);
    else await api.deleteDevice(token);
  } catch {
    /* revokeLocalPush() below invalidates the token at FCM anyway */
  }
}

/**
 * Cut this device off from pushes locally — used on logout AND when the session
 * dies (401 / suspended), where the server can no longer be told. Deleting the
 * FCM token makes the backend's next send fail with UNREGISTERED, which prunes
 * the device row server-side. A later sign-in mints a fresh token.
 */
export async function revokeLocalPush(): Promise<void> {
  stopPushRegistration();
  try {
    await deleteToken(getMessaging());
  } catch {
    /* no token / Firebase unavailable */
  }
  await Promise.all([
    SecureStore.deleteItemAsync(PUSH_TOKEN_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(PUSH_META_KEY).catch(() => {}),
  ]);
  Notifications.dismissAllNotificationsAsync().catch(() => {});
  Notifications.setBadgeCountAsync(0).catch(() => {});
}
