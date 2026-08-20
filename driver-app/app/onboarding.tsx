import { useRef, useState } from "react";
import { View, Pressable, ScrollView, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Radio, Gauge, Car, type LucideIcon } from "lucide-react-native";
import { Text } from "@/components/typography";
import { PrimaryButton } from "@/components/ui";
import { useColors, radius } from "@/lib/theme";
import { t, isRTL } from "@/lib/i18n";

type Slide = { icon: LucideIcon; title: string; body: string };

/**
 * First-run intro: three simple slides explaining what the app does. Swipe or tap
 * Next; the last slide's button enters the language picker. Shown once (the splash
 * routes first-run launches here; afterwards it skips straight into the app).
 */
export default function OnboardingScreen() {
  const c = useColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const slides: Slide[] = [
    { icon: Radio, title: t("onboarding.slide1Title"), body: t("onboarding.slide1Body") },
    { icon: Gauge, title: t("onboarding.slide2Title"), body: t("onboarding.slide2Body") },
    { icon: Car, title: t("onboarding.slide3Title"), body: t("onboarding.slide3Body") },
  ];
  const last = index >= slides.length - 1;

  const finish = () => router.replace("/language");

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  const next = () => {
    if (last) return finish();
    scroller.current?.scrollTo({ x: (index + 1) * width, animated: true });
    setIndex(index + 1);
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      {/* Skip */}
      <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingVertical: 8 }}>
        <Pressable onPress={finish} hitSlop={8}>
          <Text style={{ color: c.inkSubtle, fontSize: 14, fontWeight: "600" }}>{t("onboarding.skip")}</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={{ flex: 1 }}
        // RTL note: React Native flips horizontal scroll automatically for the
        // slide order to read right-to-left in Arabic.
      >
        {slides.map((s, i) => {
          const Icon = s.icon;
          return (
            <View key={i} style={{ width, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 22 }}>
              <View style={{ width: 96, height: 96, borderRadius: radius.xl, alignItems: "center", justifyContent: "center", backgroundColor: c.surface2 }}>
                <Icon size={40} color={c.ink} strokeWidth={1.6} />
              </View>
              <Text style={{ color: c.ink, fontSize: 24, fontWeight: "800", letterSpacing: -0.4, textAlign: "center" }}>{s.title}</Text>
              <Text style={{ color: c.inkMuted, fontSize: 15, lineHeight: 23, textAlign: "center" }}>{s.body}</Text>
            </View>
          );
        })}
      </ScrollView>

      {/* Dots + CTA */}
      <View style={{ paddingHorizontal: 24, paddingBottom: 8, gap: 20 }}>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 7 }}>
          {slides.map((_, i) => (
            <View key={i} style={{ width: i === index ? 22 : 7, height: 7, borderRadius: 999, backgroundColor: i === index ? c.ink : c.borderStrong }} />
          ))}
        </View>
        <PrimaryButton label={last ? t("onboarding.start") : t("onboarding.next")} onPress={next} />
      </View>
    </SafeAreaView>
  );
}
