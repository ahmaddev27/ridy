const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * react-native-firebase (v23+) resolves firebase-ios-sdk through Swift Package
 * Manager by default, which collides with `use_frameworks! :linkage => :static`
 * (each Firebase pod embeds its own copy → duplicate-symbol link errors). Prepend
 * `$RNFirebaseDisableSPM = true` to the Podfile so Firebase is pulled via
 * CocoaPods instead, which links cleanly under static frameworks. Must sit before
 * any target block, so we prepend it to the very top of the generated Podfile.
 */
module.exports = function withDisableFirebaseSPM(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfile, "utf8");
      if (!contents.includes("$RNFirebaseDisableSPM")) {
        contents = "$RNFirebaseDisableSPM = true\n" + contents;
        fs.writeFileSync(podfile, contents);
      }
      return config;
    },
  ]);
};
