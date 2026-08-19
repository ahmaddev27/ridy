import { useEffect, useRef } from "react";
import { View, Pressable, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Text } from "@/components/typography";
import { Logo } from "@/components/ui";
import { useColors, radius } from "@/lib/theme";
import { t, setLocale, useLocale } from "@/lib/i18n";

const TRACK_WIDTH = 96;
const INDICATOR_WIDTH = TRACK_WIDTH * 0.4;
const AUTO_ADVANCE_MS = 1900;

/**
 * Brand splash: centered monogram + REIDEY wordmark, a tracked caption, and a
 * thin pulsing progress indicator. Auto-advances to the app after ~1.9s;
 * tapping anywhere skips immediately.
 */
export default function SplashScreen() {
  const c = useColors();
  const router = useRouter();
  useLocale(); // re-render the caption once the saved language is applied
  const pulse = useRef(new Animated.Value(0)).current;

  // Apply the saved language immediately on mount so the caption (and the rest of
  // the session) is in the chosen language, not the device default.
  useEffect(() => {
    SecureStore.getItemAsync("locale").then((l) => { if (l) setLocale(l); }).catch(() => {});
  }, []);

  // First launch (no stored language) → language picker; afterwards apply the
  // saved language and hand off to the app (the auth Gate takes it from there).
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
      router.replace("/language");
    }
  }).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    const timer = setTimeout(() => advance(), AUTO_ADVANCE_MS);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
  }, [pulse, advance]);

  // The white indicator slides gently across the track and fades as it pulses.
  const translateX = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0, TRACK_WIDTH - INDICATOR_WIDTH],
  });
  const opacity = pulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.55, 1, 0.55],
  });

  return (
    <Pressable style={{ flex: 1 }} onPress={advance}>
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 20 }}>
          <Logo size={92} />

          <View style={{ alignItems: "center", gap: 10 }}>
            <Text
              style={{
                color: c.ink,
                fontSize: 34,
                fontWeight: "800",
                fontStyle: "italic",
                letterSpacing: -1,
              }}
            >
              REIDEY
            </Text>
            <Text
              style={{
                color: c.inkSubtle,
                fontSize: 11,
                fontWeight: "700",
                letterSpacing: 2.4,
              }}
            >
              {t("splash.caption")}
            </Text>
          </View>

          <View
            style={{
              width: TRACK_WIDTH,
              height: 2,
              borderRadius: radius.pill,
              backgroundColor: c.surfaceRaised,
              overflow: "hidden",
              marginTop: 6,
            }}
          >
            <Animated.View
              style={{
                width: INDICATOR_WIDTH,
                height: 2,
                borderRadius: radius.pill,
                backgroundColor: c.ink,
                transform: [{ translateX }],
                opacity,
              }}
            />
          </View>
        </View>
      </SafeAreaView>
    </Pressable>
  );
}
