import { View, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import {
  Settings as SettingsIcon,
  ShieldCheck,
  User,
  SlidersHorizontal,
  LifeBuoy,
  LogOut,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react-native";
import { Text } from "@/components/typography";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius, cardStyle, type Palette } from "@/lib/theme";

const APP_VERSION = Constants.expoConfig?.version ?? "1.1.0";

export default function ProfileScreen() {
  const c = useColors();
  const router = useRouter();
  const { driver, logout } = useAuth();
  const align = isRTL() ? "right" : "left";
  const row = isRTL() ? "row-reverse" : "row";

  const name = driver?.name ?? "";
  const initials =
    name
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  // Only the fields that actually exist on DriverProfile.
  const idLine = driver?.email ?? driver?.company_name ?? (driver ? `#${driver.id}` : "");

  const facts: { label: string; value: string }[] = [];
  if (driver?.company_name) facts.push({ label: t("profile.company"), value: driver.company_name });
  if (driver?.email) facts.push({ label: t("profile.email"), value: driver.email });

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 18 }}>
        {/* Header */}
        <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: c.ink, fontSize: 26, fontWeight: "800", textAlign: align }}>
            {t("tabs.profile")}
          </Text>
          <Pressable
            onPress={() => router.push("/settings")}
            hitSlop={8}
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.control,
              backgroundColor: c.surface2,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SettingsIcon size={19} color={c.inkMuted} strokeWidth={1.6} />
          </Pressable>
        </View>

        {/* Identity */}
        <View style={{ ...cardStyle(c), padding: 18, flexDirection: row, alignItems: "center", gap: 14 }}>
          <View
            style={{
              width: 58,
              height: 58,
              borderRadius: 29,
              backgroundColor: c.surface2,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: c.inkMuted, fontSize: 20, fontWeight: "800" }}>{initials}</Text>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: c.ink, fontSize: 16, fontWeight: "700", textAlign: align }} numberOfLines={1}>
              {name}
            </Text>
            {idLine ? (
              <Text style={{ color: c.inkSubtle, fontSize: 13, textAlign: align }} numberOfLines={1}>
                {idLine}
              </Text>
            ) : null}
          </View>
          {driver?.uber_linked ? (
            <View
              style={{
                flexDirection: row,
                alignItems: "center",
                gap: 5,
                backgroundColor: c.completedBg,
                borderRadius: radius.pill,
                paddingHorizontal: 10,
                paddingVertical: 5,
              }}
            >
              <ShieldCheck size={13} color={c.accepted} strokeWidth={1.8} />
              <Text style={{ color: c.accepted, fontSize: 11.5, fontWeight: "700" }}>
                {t("profile.verified")}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Facts */}
        {facts.length > 0 && (
          <View style={cardStyle(c)}>
            {facts.map((f, i) => (
              <View key={f.label}>
                <View
                  style={{
                    flexDirection: row,
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 16,
                    paddingVertical: 15,
                    gap: 12,
                  }}
                >
                  <Text style={{ color: c.inkSubtle, fontSize: 13.5, textAlign: align }}>{f.label}</Text>
                  <Text
                    style={{ color: c.ink, fontSize: 13.5, fontWeight: "500", flexShrink: 1, textAlign: isRTL() ? "left" : "right" }}
                    numberOfLines={1}
                  >
                    {f.value}
                  </Text>
                </View>
                {i < facts.length - 1 && <Separator c={c} />}
              </View>
            ))}
          </View>
        )}

        {/* Menu group 1 */}
        <View style={cardStyle(c)}>
          <MenuRow c={c} icon={User} label={t("profile.personalInfo")} onPress={() => {}} />
          <Separator c={c} />
          <MenuRow c={c} icon={SlidersHorizontal} label={t("profile.settings")} onPress={() => router.push("/settings")} last />
        </View>

        {/* Menu group 2 */}
        <View style={cardStyle(c)}>
          <MenuRow c={c} icon={LifeBuoy} label={t("profile.support")} onPress={() => {}} />
          <Separator c={c} />
          <MenuRow c={c} icon={LogOut} label={t("profile.logout")} onPress={logout} danger last />
        </View>

        {/* Footer */}
        <Text style={{ color: c.inkFaint, fontSize: 12, textAlign: "center", marginTop: 4 }}>
          {t("profile.appName")} {APP_VERSION}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuRow({
  c,
  icon: Icon,
  label,
  onPress,
  danger,
  last,
}: {
  c: Palette;
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  const row = isRTL() ? "row-reverse" : "row";
  const align = isRTL() ? "right" : "left";
  const color = danger ? c.danger : c.ink;
  const Chevron = isRTL() ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: row, alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 15 }}
    >
      <Icon size={18} color={danger ? c.danger : c.inkMuted} strokeWidth={1.6} />
      <Text style={{ flex: 1, color, fontSize: 13.5, fontWeight: "500", textAlign: align }}>{label}</Text>
      {!danger && <Chevron size={18} color={c.inkFaint} strokeWidth={1.6} />}
    </Pressable>
  );
}

function Separator({ c }: { c: Palette }) {
  return <View style={{ height: 1, backgroundColor: c.line, marginHorizontal: 16 }} />;
}
