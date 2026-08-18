import {
  useFonts,
  Tajawal_400Regular,
  Tajawal_500Medium,
  Tajawal_700Bold,
  Tajawal_800ExtraBold,
} from "@expo-google-fonts/tajawal";

/**
 * Load Tajawal (routed per-weight via the typography wrappers). Icons are now
 * rendered by lucide-react-native as SVG paths, so no glyph font is needed.
 * Loading is non-blocking: the caller must NOT gate the first render on the
 * returned flag, so a slow/failed font load can never leave the app on a blank
 * screen — text simply re-renders once its font is ready.
 */
export function useAppFonts(): boolean {
  const [textLoaded, textError] = useFonts({
    Tajawal_400Regular,
    Tajawal_500Medium,
    Tajawal_700Bold,
    Tajawal_800ExtraBold,
  });

  // Surface a load failure so a broken font asset is diagnosable from device
  // logs instead of silently degrading to the system font.
  if (textError) console.warn("font.tajawal_load_failed", textError);

  return textLoaded;
}
