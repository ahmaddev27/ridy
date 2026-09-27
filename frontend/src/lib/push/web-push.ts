"use client";

/**
 * Browser-side FCM web push.
 *
 * The backend already sends pushes to every registered token; this module only
 * handles the browser half: obtaining a token, registering it, and surfacing
 * foreground messages as toasts. Firebase is imported dynamically so the SDK
 * never lands in the server bundle and only loads once push is actually used.
 */
import { toast } from "sonner";
import { apiFetch } from "@/lib/api/client";
import { safeHref } from "@/lib/safe-href";
import type { Messaging } from "firebase/messaging";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAD0V17Jn2RPhnCPQYC5S5x984Fxw75vrE",
  authDomain: "reidey-225e8.firebaseapp.com",
  projectId: "reidey-225e8",
  storageBucket: "reidey-225e8.firebasestorage.app",
  messagingSenderId: "1055551156467",
  appId: "1:1055551156467:web:186a6083cf47425671c786",
};

const VAPID_KEY =
  "BLLmeKN7htEdxf0PU9Gt78-BbjLbtIBRas2cBv3KdLY06WOQrexCWxivwZVQhPQtvCJZAp6JN109lg5XA-X4Hho";

const SW_PATH = "/firebase-messaging-sw.js";

export type EnableResult = "enabled" | "denied" | "unsupported" | "failed";

/** True when the browser has the APIs web push needs (cheap — loads nothing). */
function hasPushApis(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && typeof Notification !== "undefined";
}

/** True only in a browser that can actually run FCM web push. */
export async function isSupported(): Promise<boolean> {
  if (!hasPushApis()) return false;
  try {
    const { isSupported: fcmSupported } = await import("firebase/messaging");
    return await fcmSupported();
  } catch {
    return false;
  }
}

/** Lazily create (or reuse) the Firebase app and return a Messaging instance. */
async function getMessaging(): Promise<Messaging> {
  const { getApps, initializeApp } = await import("firebase/app");
  const { getMessaging: fcmGetMessaging } = await import("firebase/messaging");
  const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  return fcmGetMessaging(app);
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SW_PATH);
}

// Surfaced in the console (and Sentry's console breadcrumbs) instead of a silent
// "failed" — a broken service worker otherwise goes unnoticed.
function reportPushError(stage: string, err: unknown): void {
  console.warn(`[web-push] ${stage} failed`, err);
}

/**
 * Enable web push for the current browser: register the SW, request permission,
 * obtain an FCM token and register it with the backend.
 *
 * @param silent When true, never prompts — only proceeds if permission is
 *   already granted. Used for the automatic re-register on load.
 */
export async function enableWebPush(
  locale: string,
  silent = false,
): Promise<EnableResult> {
  if (!hasPushApis()) return "unsupported";
  // Checked BEFORE loading Firebase so users who never opted in don't download
  // the SDK on every page load.
  if (silent && Notification.permission !== "granted") return "denied";
  if (!(await isSupported())) return "unsupported";

  try {
    const registration = await registerServiceWorker();

    const permission =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (permission !== "granted") return "denied";

    const messaging = await getMessaging();
    const { getToken } = await import("firebase/messaging");
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return "failed";

    await apiFetch("/api/v1/notifications/device", {
      method: "POST",
      body: { token, locale },
      withCsrf: true,
    });
    return "enabled";
  } catch (err) {
    reportPushError("enable", err);
    return "failed";
  }
}

/**
 * Unregister this browser's push token for the signed-in user. Called on logout
 * BEFORE the session ends (the DELETE needs it), so a shared browser stops
 * receiving the previous user's notifications. Best-effort: never throws.
 */
export async function disableWebPush(): Promise<void> {
  if (!hasPushApis() || Notification.permission !== "granted") return;
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (!registration) return;
    const messaging = await getMessaging();
    const { getToken, deleteToken } = await import("firebase/messaging");
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (token) {
      await apiFetch("/api/v1/notifications/device", {
        method: "DELETE",
        body: { token },
        withCsrf: true,
        skipAuthEvents: true,
      });
    }
    await deleteToken(messaging);
  } catch (err) {
    reportPushError("disable", err);
  }
}

/**
 * Subscribe to foreground messages and toast them. Clicking the toast navigates
 * to `data.href` only when it is a path on our own origin. Returns an
 * unsubscribe function (or a no-op). Loads nothing unless permission was granted.
 */
export async function listenForeground(openLabel = "Open"): Promise<() => void> {
  if (!hasPushApis() || Notification.permission !== "granted") return () => {};
  if (!(await isSupported())) return () => {};

  try {
    const messaging = await getMessaging();
    const { onMessage } = await import("firebase/messaging");

    return onMessage(messaging, (payload) => {
      const data = payload.data ?? {};
      const title = payload.notification?.title ?? data.title ?? "Reidey";
      const body = payload.notification?.body ?? data.body;
      const href = safeHref(data.href);

      toast(title, {
        description: body,
        action: href
          ? {
              label: openLabel,
              onClick: () => {
                window.location.assign(href);
              },
            }
          : undefined,
      });
    });
  } catch (err) {
    reportPushError("listen", err);
    return () => {};
  }
}
