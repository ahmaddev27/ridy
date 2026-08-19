import { Tabs } from "expo-router";
import { View, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Package, BarChart3, User, type LucideIcon } from "lucide-react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Text } from "@/components/typography";
import { t, useLocale, isRTL } from "@/lib/i18n";
import { useColors, isDarkPalette, type Palette } from "@/lib/theme";

/** Lucide icon for each route (single outline cut; active state = color/stroke). */
function iconFor(routeName: string): LucideIcon {
  switch (routeName) {
    case "offers":
      return Package;
    case "statistics":
      return BarChart3;
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

  return (
    <View
      style={{
        flexDirection: isRTL() ? "row-reverse" : "row",
        backgroundColor: c.canvas,
        borderTopWidth: 1,
        borderTopColor: c.line,
        paddingTop: 9,
        paddingBottom: Math.max(insets.bottom, 12),
        ...shadow(c),
      }}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
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
            style={{ flex: 1, alignItems: "center", gap: 5 }}
          >
            <Icon size={21} strokeWidth={focused ? 2.3 : 1.9} color={tint} />
            <Text style={{ color: tint, fontSize: 9.5, fontWeight: focused ? "700" : "500" }}>{label}</Text>
          </Pressable>
        );
      })}
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
      {/* Order: Offers · Home · Statistics · Profile. */}
      <Tabs.Screen name="offers" options={{ title: t("tabs.offers") }} />
      <Tabs.Screen name="index" options={{ title: t("tabs.home") }} />
      <Tabs.Screen name="statistics" options={{ title: t("tabs.statistics") }} />
      <Tabs.Screen name="profile" options={{ title: t("tabs.profile") }} />
    </Tabs>
  );
}
