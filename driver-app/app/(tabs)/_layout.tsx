import { Tabs } from "expo-router";
import { View, Pressable, Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Package, BarChart3, User, FileText, type LucideIcon } from "@/components/icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Text } from "@/components/typography";
import { t, useLocale, isRTL } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
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
function BottomBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { driver } = useAuth();

  // The same switch the receipt screen and the profile already read: the
  // company's El-Professor connection, which Reidey fills from
  // `isElprofessorConnected()`. A company without it keeps the four tabs it
  // has always had, and the route stays unreachable rather than empty.
  const connected = driver?.documents_enabled === true;
  const routes = connected
    ? state.routes
    : state.routes.filter(
        (route: BottomTabBarProps["state"]["routes"][number]) => route.name !== "submissions",
      );

  const dark = isDarkPalette(c);
  return (
    <View
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

export default function TabsLayout() {
  useLocale(); // re-render tab labels when the language changes
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <BottomBar {...props} />}>
      {/* Order: Home · Statistics · Offers · Submissions · Profile.
          Submissions sits before the profile because it is where a driver goes
          to DO something; the profile is where they go to change something. */}
      <Tabs.Screen name="index" options={{ title: t("tabs.home") }} />
      <Tabs.Screen name="statistics" options={{ title: t("tabs.statistics") }} />
      <Tabs.Screen name="offers" options={{ title: t("tabs.offers") }} />
      <Tabs.Screen name="submissions" options={{ title: t("tabs.submissions") }} />
      <Tabs.Screen name="profile" options={{ title: t("tabs.profile") }} />
    </Tabs>
  );
}
