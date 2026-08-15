import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/lib/i18n";
import { useColors } from "@/lib/theme";

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.canvas },
        headerTitleStyle: { color: c.ink, fontWeight: "700" },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line, height: 58, paddingBottom: 6, paddingTop: 6 },
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.inkSubtle,
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="offers"
        options={{
          title: t("offers.title"),
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("settings.title"),
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
