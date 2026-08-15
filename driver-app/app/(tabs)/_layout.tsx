import { Tabs } from "expo-router";
import { Text } from "react-native";
import { t } from "@/lib/i18n";
import { colors } from "@/lib/theme";

/** Minimal emoji tab icons keep the shell dependency-free. */
function Icon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ fontSize: 18, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.canvas },
        headerTitleStyle: { color: colors.ink },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkSubtle,
      }}
    >
      <Tabs.Screen
        name="offers"
        options={{
          title: t("offers.title"),
          tabBarIcon: ({ color }) => <Icon glyph="🔔" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("settings.title"),
          tabBarIcon: ({ color }) => <Icon glyph="⚙️" color={color} />,
        }}
      />
    </Tabs>
  );
}
