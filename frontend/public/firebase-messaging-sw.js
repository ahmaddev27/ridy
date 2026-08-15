/* global importScripts, firebase */
/**
 * Firebase Cloud Messaging service worker.
 *
 * Runs off the main thread and is what the browser wakes when a push arrives
 * while the dashboard is in the background (or closed). It uses the Firebase
 * *compat* CDN build because a service worker cannot consume ES modules from a
 * bundler — it must pull the SDK in via importScripts.
 */
importScripts(
  "https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js",
);

firebase.initializeApp({
  apiKey: "AIzaSyAD0V17Jn2RPhnCPQYC5S5x984Fxw75vrE",
  authDomain: "reidey-225e8.firebaseapp.com",
  projectId: "reidey-225e8",
  storageBucket: "reidey-225e8.firebasestorage.app",
  messagingSenderId: "1055551156467",
  appId: "1:1055551156467:web:186a6083cf47425671c786",
});

const messaging = firebase.messaging();

/** Background pushes: render the OS notification ourselves so we control the icon and click target. */
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = (payload.notification && payload.notification.title) || data.title || "Reidey";
  const body = (payload.notification && payload.notification.body) || data.body || "";

  self.registration.showNotification(title, {
    body,
    icon: "/icon.svg",
    data,
  });
});

/** Focus an existing dashboard tab (or open one) at the notification's target path. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const href = (event.notification.data && event.notification.data.href) || "/";
  const target = new URL(href, self.location.origin);

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (new URL(client.url).origin === target.origin && "focus" in client) {
            client.navigate(target.href);
            return client.focus();
          }
        }
        return self.clients.openWindow(target.href);
      }),
  );
});
