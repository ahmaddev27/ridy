import { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, type Offer } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useColors, radius } from "@/lib/theme";
import { fareLabel, cleanAddress } from "@/lib/format";
import { StatusBadge } from "@/components/ui";

export default function OffersScreen() {
  const router = useRouter();
  const colors = useColors();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.offers();
      setOffers(res.data);
    } catch {
      /* keep the last list on transient errors */
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Refresh whenever the tab regains focus (e.g. after a push arrives).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <FlatList
      data={offers}
      keyExtractor={(o) => String(o.id)}
      contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.ink} />}
      ListEmptyComponent={
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 }}>
          <Text style={{ color: colors.inkSubtle }}>{t("offers.empty")}</Text>
        </View>
      }
      renderItem={({ item }) => {
        const status = item.status ?? "pending";
        return (
          <Pressable
            onPress={() => router.push(`/offer/${item.id}`)}
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.line,
              padding: 16,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "800" }}>
                {fareLabel(item.fare_formatted, item.fare_amount)}
              </Text>
              <StatusBadge status={status} label={t(`status.${status}`)} />
            </View>
            <Text style={{ color: colors.inkMuted }} numberOfLines={1}>
              ↑ {cleanAddress(item.pickup_address)}
            </Text>
            <Text style={{ color: colors.inkSubtle }} numberOfLines={1}>
              ↓ {cleanAddress(item.dropoff_address)}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}
