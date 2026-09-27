const { withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

/**
 * Let expo-notifications own FCM delivery on Android.
 *
 * @react-native-firebase/messaging registers its own FirebaseMessagingService
 * (plus a c2dm receiver and a headless JS service). Android delivers
 * MESSAGING_EVENT to ONE service only, and RNFB's outranks expo's — so every
 * foreground offer push went to RNFB, where nothing listens (no onMessage), and
 * the driver heard nothing while the app was open. Its receiver also booted a
 * headless JS task (full bundle + wake lock) for every background push.
 *
 * Strip those three components from the merged manifest. RNFB stays linked, so
 * `deleteToken`/`getToken` still work (same default Firebase app/token as expo),
 * and iOS is untouched (it keeps using RNFB for the FCM token).
 */
const MESSAGING = "io.invertase.firebase.messaging";
const REMOVE = {
  service: [`${MESSAGING}.ReactNativeFirebaseMessagingService`, `${MESSAGING}.ReactNativeFirebaseMessagingHeadlessService`],
  receiver: [`${MESSAGING}.ReactNativeFirebaseMessagingReceiver`],
};

function stripRnfbMessaging(androidManifest) {
  const manifest = androidManifest.manifest;
  manifest.$ = manifest.$ || {};
  manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";

  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  for (const [tag, names] of Object.entries(REMOVE)) {
    const entries = (app[tag] || []).filter((e) => !names.includes(e.$ && e.$["android:name"]));
    for (const name of names) {
      entries.push({ $: { "android:name": name, "tools:node": "remove" } });
    }
    app[tag] = entries;
  }
  return androidManifest;
}

module.exports = function withExpoOwnsFcm(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = stripRnfbMessaging(cfg.modResults);
    return cfg;
  });
};

module.exports.stripRnfbMessaging = stripRnfbMessaging;
