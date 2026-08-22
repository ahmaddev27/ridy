import { useEffect, useRef } from "react";
import { View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Text } from "@/components/typography";
import { Logo } from "@/components/ui";
import { setLocale } from "@/lib/i18n";

// Fixed dark palette matching the NATIVE splash (app.json backgroundColor +
// white logo). The native splash can't know the in-app theme, so this JS frame
// mirrors it exactly — the two read as ONE continuous splash instead of a dark
// frame followed by a themed one.
const SPLASH_BG = "#14171a";
const SPLASH_FG = "#ffffff";

// Short: this frame only bridges the native splash to the first route, so it
// hands off quickly instead of dwelling as a separate "loading" screen.
const AUTO_ADVANCE_MS = 650;

/**
 * Brand bridge: the same centered monogram + REIDEY wordmark as the native
 * splash, on the same background — one continuous splash, no caption or loading
 * bar. Routes to onboarding on first run, otherwise into the app.
 */
export default function SplashScreen() {
  const router = useRouter();

  // First launch (no stored language) → onboarding → language picker; afterwards
  // apply the saved language and hand off to the app (the auth Gate takes over).
  // Guarded so a tap + the timer can't both navigate.
  const navigated = useRef(false);
  const advance = useRef(async () => {
    if (navigated.current) return;
    navigated.current = true;
    const stored = await SecureStore.getItemAsync("locale").catch(() => null);
    if (stored) {
      setLocale(stored);
      router.replace("/");
    } else {
      router.replace("/onboarding"); // first run: intro → language → login
    }
  }).current;

  useEffect(() => {
    const timer = setTimeout(() => advance(), AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [advance]);

  return (
    <Pressable style={{ flex: 1 }} onPress={advance}>
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: SPLASH_BG }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 20 }}>
          <Logo size={92} color={SPLASH_FG} />
          {/* Just the wordmark — no caption or loading bar, so this frame reads as
              a seamless continuation of the native splash (one splash, not two). */}
          <Text
            style={{
              color: SPLASH_FG,
              fontSize: 34,
              fontWeight: "800",
              fontStyle: "italic",
              letterSpacing: -1,
            }}
          >
            REIDEY
          </Text>
        </View>
      </SafeAreaView>
    </Pressable>
  );
}
