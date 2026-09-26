import { useFonts } from "expo-font";
// Per-weight subpath imports: the package barrels `require` EVERY weight's TTF,
// which bundled 5 unused font files into the app.
import { Tajawal_400Regular } from "@expo-google-fonts/tajawal/400Regular";
import { Tajawal_500Medium } from "@expo-google-fonts/tajawal/500Medium";
import { Tajawal_700Bold } from "@expo-google-fonts/tajawal/700Bold";
import { Tajawal_800ExtraBold } from "@expo-google-fonts/tajawal/800ExtraBold";
import { Manrope_400Regular } from "@expo-google-fonts/manrope/400Regular";
import { Manrope_500Medium } from "@expo-google-fonts/manrope/500Medium";
import { Manrope_600SemiBold } from "@expo-google-fonts/manrope/600SemiBold";
import { Manrope_700Bold } from "@expo-google-fonts/manrope/700Bold";
import { Manrope_800ExtraBold } from "@expo-google-fonts/manrope/800ExtraBold";

/**
 * Load Tajawal (Arabic text) + Manrope (the Uber-Move-like face for Latin text and
 * all digits), routed per-weight via the typography wrappers. Icons are now
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
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  // Surface a load failure so a broken font asset is diagnosable from device
  // logs instead of silently degrading to the system font.
  if (textError) console.warn("font.tajawal_load_failed", textError);

  return textLoaded;
}
