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
  const [loaded] = useFonts({
    Tajawal_400Regular,
    Tajawal_500Medium,
    Tajawal_700Bold,
    Tajawal_800ExtraBold,
    ...Ionicons.font,
  });

  return loaded;
}
