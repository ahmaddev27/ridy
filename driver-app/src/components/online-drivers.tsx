import { View } from "react-native";
import { Text } from "@/components/typography";
import type { FleetOnlineDriver } from "@/lib/api";
import { t, isRTL, useLocale } from "@/lib/i18n";
import { useColors, cardStyle } from "@/lib/theme";

/**
 * Owner home: WHO is online, not just how many — busiest first (on trip, then
 * heading to a pickup, then available), each with their live status. The backend
 * caps the list, so any overflow is summarised as "+N more".
 */
export function OnlineDriversCard({ drivers, total }: { drivers: FleetOnlineDriver[]; total: number }) {
  useLocale(); // re-render on a language switch
  const c = useColors();
  const row = isRTL() ? "row-reverse" : "row";
  const align = isRTL() ? "right" : "left";
  const more = Math.max(0, total - drivers.length);
  const dot = (engagement: number) => (engagement === 2 ? c.inkMuted : engagement === 1 ? c.warning : c.accent);

  return (
    <View style={cardStyle(c)}>
      {drivers.map((d, i) => (
        <View
          key={d.id}
          style={{
            flexDirection: row,
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 14,
            paddingVertical: 11,
            borderBottomWidth: i === drivers.length - 1 && more === 0 ? 0 : 1,
            borderBottomColor: c.line,
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot(d.engagement) }} />
          <Text numberOfLines={1} style={{ flex: 1, color: c.ink, fontSize: 14.5, fontWeight: "600", textAlign: align }}>
            {d.name}
          </Text>
          <Text style={{ color: c.inkSubtle, fontSize: 12.5 }}>{t(`home.engagement.${d.engagement}`)}</Text>
        </View>
      ))}
      {more > 0 && (
        <Text style={{ color: c.inkSubtle, fontSize: 12.5, paddingHorizontal: 14, paddingVertical: 10, textAlign: align }}>
          {t("fleet.moreOnline", { count: String(more) })}
        </Text>
      )}
    </View>
  );
}
