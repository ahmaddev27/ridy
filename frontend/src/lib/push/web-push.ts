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

export type EnableResult = "enabled" | "denied" | "unsupported" | "failed";

/** True only in a browser that can actually run FCM web push. */
export async function isSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return false;
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
  return navigator.serviceWorker.register("/firebase-messaging-sw.js");
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
  if (!(await isSupported())) return "unsupported";

  if (silent && Notification.permission !== "granted") return "denied";

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
  } catch {
    return "failed";
  }
}

/**
 * Subscribe to foreground messages and toast them. Clicking the toast navigates
 * to `data.href` when present. Returns an unsubscribe function (or a no-op).
 */
export async function listenForeground(): Promise<() => void> {
  if (!(await isSupported())) return () => {};

  try {
    const messaging = await getMessaging();
    const { onMessage } = await import("firebase/messaging");

    return onMessage(messaging, (payload) => {
      const data = payload.data ?? {};
      const title = payload.notification?.title ?? data.title ?? "Reidey";
      const body = payload.notification?.body ?? data.body;
      const href = data.href;

      toast(title, {
        description: body,
        action: href
          ? {
              label: "Open",
              onClick: () => {
                window.location.assign(href);
              },
            }
          : undefined,
      });
    });
  } catch {
    return () => {};
  }
}
