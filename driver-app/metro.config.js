// Default Expo Metro config. Present so EAS uses a known-good bundler setup.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
