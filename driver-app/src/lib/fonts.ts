import {
  useFonts,
  Tajawal_400Regular,
  Tajawal_500Medium,
  Tajawal_700Bold,
  Tajawal_800ExtraBold,
} from "@expo-google-fonts/tajawal";
import { Ionicons } from "@expo/vector-icons";

/**
 * Load Tajawal (routed per-weight via the typography wrappers) plus the Ionicons
 * glyph font used by the tab bar and inline icons. Loading is non-blocking: the
 * caller must NOT gate the first render on the returned flag, so a slow/failed
 * font load can never leave the app on a blank screen — text and icons simply
 * re-render once their font is ready.
 */
export function useAppFonts(): boolean {
  // Load the two font families in separate batches. `useFonts` resolves each
  // batch with Promise.all, so keeping the glyph font apart from Tajawal means a
  // slow/failed load of one family can never block the other from registering
  // (a single combined batch would drop the tab-bar icons and the Arabic text
  // together the moment any one file failed).
  const [textLoaded, textError] = useFonts({
    Tajawal_400Regular,
    Tajawal_500Medium,
    Tajawal_700Bold,
    Tajawal_800ExtraBold,
  });
  const [iconsLoaded, iconsError] = useFonts(Ionicons.font);

  // Surface a load failure so a broken font asset is diagnosable from device
  // logs instead of silently degrading to the system font / blank glyphs.
  if (textError) console.warn("font.tajawal_load_failed", textError);
  if (iconsError) console.warn("font.ionicons_load_failed", iconsError);

  return textLoaded && iconsLoaded;
}
