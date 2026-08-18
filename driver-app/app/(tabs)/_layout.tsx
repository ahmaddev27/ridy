import { Tabs } from "expo-router";
import { View, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Text } from "@/components/typography";
import { t, useLocale, isRTL } from "@/lib/i18n";
import { useColors, radius, type Palette } from "@/lib/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** Ionicon for each route — filled variant when the tab is active. */
function iconFor(routeName: string, focused: boolean): IconName {
  switch (routeName) {
    case "offers":
      return "reorder-three";
    case "profile":
      return focused ? "person" : "person-outline";
    default: // index / home
      return focused ? "home" : "home-outline";
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
          gap: 6,
          backgroundColor: c.surface,
          borderRadius: 28,
          borderWidth: 1,
          borderColor: c.line,
          paddingHorizontal: 8,
          paddingVertical: 8,
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
                gap: 8,
                borderRadius: radius.pill,
                paddingHorizontal: focused ? 16 : 14,
                paddingVertical: 10,
                backgroundColor: focused ? c.accent : "transparent",
              }}
            >
              <Ionicons
                name={iconFor(route.name, focused)}
                size={24}
                color={focused ? "#ffffff" : c.inkSubtle}
              />
              {focused && (
                <Text style={{ color: "#ffffff", fontSize: 14, fontWeight: "700" }}>{label}</Text>
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
    android: { elevation: 12 },
    default: {
      shadowColor: "#000000",
      shadowOpacity: c.canvas === "#090b0f" ? 0.5 : 0.15,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
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
