import { useState } from "react";
import { Tabs, usePathname, useRouter } from "expo-router";
import { View, Pressable, Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Package, BarChart3, User, FileText, type LucideIcon } from "@/components/icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Text } from "@/components/typography";
import { t, useLocale, isRTL } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { submissionAccess } from "@/lib/submission-detail";
import { useColors, isDarkPalette, type Palette } from "@/lib/theme";

/** Lucide icon for each route (single outline cut; active state = color/stroke). */
function iconFor(routeName: string): LucideIcon {
  switch (routeName) {
    case "offers":
      return Package;
    case "statistics":
      return BarChart3;
    case "submissions":
      return FileText;
    case "profile":
      return User;
    default: // index / home
      return Home;
  }
}

/**
 * The design's flat bottom navigation: a full-width bar hugging the bottom
 * safe-area with a 1px top hairline. Each tab is a stacked icon + label; the
 * active tab is tinted with the subtle emerald accent, inactive tabs are muted.
 * Monochrome otherwise — no pill, no filled icons. RTL-safe.
 */
function BottomBar({ state, descriptors, navigation, onHeight }: BottomTabBarProps & { onHeight: (h: number) => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();

  // Submissions is never one of these tabs any more. A tab is a PLACE; sending
  // a Beleg or a Notiz is an ACT, and an act sitting in a row of places reads
  // as a fifth thing to look at. It is the floating button below instead, which
  // is also why the bar is four tabs whether or not the company is connected —
  // the row no longer reflows when that switch is turned on.
  const routes = state.routes.filter(
    (route: BottomTabBarProps["state"]["routes"][number]) => route.name !== "submissions",
  );

  const dark = isDarkPalette(c);
  return (
    <View
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      style={{
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
        overflow: "hidden",
        // A solid bar: the old blur sat under a 94%-opaque tint and was invisible.
        backgroundColor: dark ? "rgb(16,18,21)" : "#FFFFFF",
        ...shadow(c),
      }}
    >
      <View
        style={{
          flexDirection: isRTL() ? "row-reverse" : "row",
          paddingTop: 9,
          paddingHorizontal: 8,
          paddingBottom: Math.max(insets.bottom, 12),
        }}
      >
        {routes.map((route: BottomTabBarProps["state"]["routes"][number]) => {
          // `state.index` indexes the FULL list, so comparing it to a filtered
          // position would highlight the wrong tab once one is hidden.
          const focused = state.routes[state.index]?.key === route.key;
          const { options } = descriptors[route.key];
          const label = typeof options.title === "string" ? options.title : t(`tabs.${route.name}`);
          const Icon = iconFor(route.name);
          const tint = focused ? c.accent : c.inkSubtle;

          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              style={{ flex: 1, alignItems: "center" }}
            >
              {/* No pill — the active tab is marked by the emerald tint + heavier
                  weight on the icon and label alone. */}
              <View style={{ alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 6 }}>
                <Icon size={21} strokeWidth={focused ? 2.3 : 1.9} color={tint} />
                <Text style={{ color: tint, fontSize: 9.5, fontWeight: focused ? "700" : "500" }}>{label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A faint top-edge shadow so the bar reads above the scrolling content. */
function shadow(c: Palette) {
  return Platform.select({
    android: { elevation: 8 },
    default: {
      shadowColor: "#000000",
      shadowOpacity: isDarkPalette(c) ? 0.3 : 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: -3 },
    },
  });
}

/** The button's own shadow falls DOWNWARD, unlike the bar's. */
function fabShadow(c: Palette) {
  return Platform.select({
    android: { elevation: 6 },
    default: {
      shadowColor: "#000000",
      shadowOpacity: isDarkPalette(c) ? 0.45 : 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
  });
}

/**
 * Eingänge, as a floating button above the bar rather than a tab in it.
 *
 * It is a sibling of `<Tabs>`, not a child of the tab bar, and that is the
 * whole reason it works: React Navigation measures the custom tab bar and
 * reserves that height on every screen, so a button drawn inside the bar would
 * either be clipped (Android clips a child outside its parent) or would steal
 * that much room from all four tabs for ever. As a sibling it floats OVER the
 * content and costs no layout.
 *
 * It is hidden on the submissions screen itself — a button whose only job is to
 * go somewhere has nothing to say once you are there.
 */
function SubmissionsFab({ bottom }: { bottom: number }) {
  const c = useColors();
  const router = useRouter();
  const label = t("tabs.submissions");

  return (
    <Pressable
      onPress={() => router.push("/submissions")}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        position: "absolute",
        bottom,
        ...(isRTL() ? { left: 16 } : { right: 16 }),
        flexDirection: isRTL() ? "row-reverse" : "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 18,
        paddingVertical: 14,
        borderRadius: 999,
        backgroundColor: c.primary,
        opacity: pressed ? 0.85 : 1,
        ...fabShadow(c),
      })}
    >
      <FileText size={20} strokeWidth={2} color={c.primaryInk} />
      <Text style={{ color: c.primaryInk, fontSize: 14, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  useLocale(); // re-render tab labels when the language changes
  const { driver, isOwner } = useAuth();
  const pathname = usePathname();

  // The bar's height is measured rather than recomputed: it is built from a
  // padding, an icon, a label and the bottom safe-area, and a second copy of
  // that sum would drift the first time any of them changes.
  const [barHeight, setBarHeight] = useState(0);

  // The same switch the receipt screen and the profile already read: the
  // company's El-Professor connection, which Reidey fills from
  // `isElprofessorConnected()`. A company without it gets neither the button nor
  // a way in, exactly as before.
  // An owner never gets the button. The server already answers
  // `documents_enabled: false` for them, so this is the second lock rather than
  // the first: it says what we mean in the UI, so restoring that field to the
  // company's true connection state cannot quietly put the button back. A
  // submission goes UP from a driver to their company, and an owner has none.
  const connected = submissionAccess(driver).canSend;
  const showFab = connected && barHeight > 0 && !pathname.startsWith("/submissions");

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <BottomBar {...props} onHeight={setBarHeight} />}
      >
        {/* Order: Home · Statistics · Offers · Profile. Submissions is still a
            registered route — the floating button and the profile's own link
            both navigate to it — but it is no longer drawn in the bar. */}
        <Tabs.Screen name="index" options={{ title: t("tabs.home") }} />
        <Tabs.Screen name="statistics" options={{ title: t("tabs.statistics") }} />
        <Tabs.Screen name="offers" options={{ title: t("tabs.offers") }} />
        <Tabs.Screen name="submissions" options={{ title: t("tabs.submissions") }} />
        <Tabs.Screen name="profile" options={{ title: t("tabs.profile") }} />
      </Tabs>
      {showFab ? <SubmissionsFab bottom={barHeight + 14} /> : null}
    </View>
  );
}
