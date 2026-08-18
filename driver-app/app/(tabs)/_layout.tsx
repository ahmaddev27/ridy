import { Tabs } from "expo-router";
import { View, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, List, User, type LucideIcon } from "lucide-react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Text } from "@/components/typography";
import { t, useLocale, isRTL } from "@/lib/i18n";
import { useColors, radius, isDarkPalette, type Palette } from "@/lib/theme";

/** Lucide icon for each route. Active state is conveyed by color/stroke, not a
 *  filled variant (Lucide ships a single outline cut per icon). */
function iconFor(routeName: string): LucideIcon {
  switch (routeName) {
    case "offers":
      return List;
    case "profile":
      return User;
    default: // index / home
      return Home;
  }
}

/**
 * Floating "pill" navigation: a rounded, elevated bar sitting just above the
 * bottom safe-area. The active tab's icon lives inside a brand-emerald rounded
 * square with its label beside it; inactive tabs are muted icons. RTL-safe.
 */
function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: Math.max(insets.bottom, 10),
        alignItems: "center",
      }}
    >
      <View
        style={{
          flexDirection: isRTL() ? "row-reverse" : "row",
          alignItems: "center",
          gap: 4,
          backgroundColor: c.surface,
          borderRadius: radius.pill,
          paddingHorizontal: 6,
          paddingVertical: 6,
          ...(isDarkPalette(c) ? { borderWidth: 1, borderColor: c.line } : null),
          ...shadow(c),
        }}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key];
          const label =
            typeof options.title === "string" ? options.title : t(`tabs.${route.name}`);

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              hitSlop={6}
              style={{
                flexDirection: isRTL() ? "row-reverse" : "row",
                alignItems: "center",
                gap: 7,
                borderRadius: radius.pill,
                paddingHorizontal: focused ? 15 : 13,
                paddingVertical: 9,
                backgroundColor: focused ? c.accent : "transparent",
              }}
            >
              {(() => {
                const Icon = iconFor(route.name);
                return (
                  <Icon
                    size={21}
                    strokeWidth={focused ? 2.4 : 2}
                    color={focused ? "#ffffff" : c.inkSubtle}
                  />
                );
              })()}
              {focused && (
                <Text style={{ color: "#ffffff", fontSize: 13.5, fontWeight: "700" }}>{label}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Soft, theme-aware elevation for the floating bar. */
function shadow(c: Palette) {
  return Platform.select({
    android: { elevation: 10 },
    default: {
      shadowColor: "#000000",
      shadowOpacity: isDarkPalette(c) ? 0.45 : 0.12,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
    },
  });
}

export default function TabsLayout() {
  useLocale(); // re-render tab labels when the language changes
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      {/* Order: Offers, Home (centered), Profile — Home sits in the middle. */}
      <Tabs.Screen name="offers" options={{ title: t("tabs.offers") }} />
      <Tabs.Screen name="index" options={{ title: t("tabs.home") }} />
      <Tabs.Screen name="profile" options={{ title: t("tabs.profile") }} />
    </Tabs>
  );
}
