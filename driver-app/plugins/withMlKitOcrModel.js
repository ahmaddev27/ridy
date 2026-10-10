const { withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

/**
 * Download ML Kit's Latin text model when the app is INSTALLED, not when the
 * driver first photographs a receipt.
 *
 * `expo-text-extractor` uses the unbundled ML Kit artifact
 * (`play-services-mlkit-text-recognition`). That is why it costs about 260 KB
 * instead of the ~20 MB a bundled model adds — the model itself comes from
 * Google Play Services. The default is to fetch it on FIRST USE, and Google's
 * own documentation says requests made before that download finishes "produce
 * no results".
 *
 * On this app that lands on the worst possible moment: a driver standing at a
 * petrol station photographing their first receipt, getting an empty form and
 * no reason for it. This meta-data entry tells Play Services to fetch the model
 * at install time instead, so the first receipt is read like every other one.
 *
 * It is not a guarantee — a device with no Play Services, or one installed
 * offline, still falls back to fetching later, which is why the receipt screen
 * must still handle "no text found" as a normal answer and let the driver type.
 *
 * The value is a comma-separated list of ML Kit features; `ocr` is Latin text
 * recognition. Adding another script later means extending this one string.
 */
const META_NAME = "com.google.mlkit.vision.DEPENDENCIES";
const META_VALUE = "ocr";

function withInstallTimeOcrModel(androidManifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  app["meta-data"] = app["meta-data"] || [];

  // Replace rather than append: a second entry with the same name is what
  // Android's manifest merger refuses, and a build failure here reads as
  // something else entirely.
  const kept = app["meta-data"].filter(
    (e) => !(e.$ && e.$["android:name"] === META_NAME),
  );
  kept.push({ $: { "android:name": META_NAME, "android:value": META_VALUE } });
  app["meta-data"] = kept;

  return androidManifest;
}

module.exports = function withMlKitOcrModel(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = withInstallTimeOcrModel(cfg.modResults);
    return cfg;
  });
};

module.exports.withInstallTimeOcrModel = withInstallTimeOcrModel;
