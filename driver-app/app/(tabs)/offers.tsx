import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, type Offer, type OffersQuery } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, isRTL, getLocale } from "@/lib/i18n";
import { useColors, radius } from "@/lib/theme";
import { fareLabel, cleanAddress, distanceLabel, euroQuality } from "@/lib/format";
import { StatusBadge, QualityMark } from "@/components/ui";
import { DriverTag } from "./index";

const FILTERS = ["all", "pending", "accepted", "completed"] as const;
const PER_PAGE = 20;

export default function OffersScreen() {
  const c = useColors();
  const router = useRouter();
  const { isOwner } = useAuth();
  const align = isRTL() ? "right" : "left";

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof FILTERS)[number]>("all");
  const [offers, setOffers] = useState<Offer[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (target: number) => {
      const params: OffersQuery = { per_page: PER_PAGE, page: target };
      if (status !== "all") params.status = status;
      if (search.trim()) params.search = search.trim();
      const res = isOwner ? await api.fleetOffers(params) : await api.offers(params);
      setLastPage(res.meta?.last_page ?? 1);
      setTotal(res.meta?.total ?? res.data.length);
      setPage(res.meta?.current_page ?? target);
      setOffers((prev) => (target === 1 ? res.data : [...prev, ...res.data]));
    },
    [status, search, isOwner],
  );

  const reload = useCallback(async () => {
    setRefreshing(true);
    try { await fetchPage(1); } catch { /* keep */ } finally { setRefreshing(false); }
  }, [fetchPage]);

  useEffect(() => {
    const h = setTimeout(reload, 300);
    return () => clearTimeout(h);
  }, [reload]);

  async function loadMore() {
    if (loadingMore || refreshing || page >= lastPage) return;
    setLoadingMore(true);
    try { await fetchPage(page + 1); } catch { /* */ } finally { setLoadingMore(false); }
  }

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <FlatList
        data={offers}
        keyExtractor={(o) => String(o.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={c.ink} />}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 2 }}>
            <Text style={{ color: c.ink, fontSize: 30, fontWeight: "800", textAlign: align }}>{t("offers.title")}</Text>

            {/* Search */}
            <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 10, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, paddingHorizontal: 14, paddingVertical: 13 }}>
              <Ionicons name="search" size={18} color={c.inkSubtle} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={t("offers.search")}
                placeholderTextColor={c.inkSubtle}
                style={{ flex: 1, color: c.ink, fontSize: 16, textAlign: align }}
                autoCapitalize="none"
              />
            </View>

            {/* Filter chips */}
            <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", flexWrap: "wrap", gap: 10 }}>
              {FILTERS.map((s) => {
                const on = status === s;
                const label = s === "all" ? t("home.all") : t(`status.${s}`);
                const hue = s === "pending" ? c.pending : s === "accepted" ? c.accepted : s === "completed" ? c.completed : c.ink;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setStatus(s)}
                    style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.line }}
                  >
                    <Text style={{ color: on ? c.primaryInk : hue, fontWeight: "700", fontSize: 14 }}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Count */}
            {total > 0 && (
              <Text style={{ color: c.inkSubtle, fontSize: 13, textAlign: align }}>
                {total.toLocaleString(getLocale() === "ar" ? "en" : getLocale())} {t("offers.title")}
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={refreshing ? null : (
          <View style={{ alignItems: "center", paddingTop: 60 }}>
            <Text style={{ color: c.inkSubtle }}>{t("offers.empty")}</Text>
          </View>
        )}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={c.ink} style={{ paddingVertical: 16 }} /> : null}
        renderItem={({ item }) => <OfferCard offer={item} showDriver={isOwner} onPress={() => router.push(`/offer/${item.id}`)} />}
      />
    </SafeAreaView>
  );
}

function OfferCard({ offer, onPress, showDriver }: { offer: Offer; onPress: () => void; showDriver?: boolean }) {
  const c = useColors();
  const status = offer.status ?? "pending";
  const dim = status === "rejected" || status === "canceled";
  const q = euroQuality(offer.fare_amount, offer.distance_m);
  const arrow = (d: string) => (isRTL() ? { textAlign: "right" as const } : { textAlign: "left" as const });
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 14, backgroundColor: c.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: c.line, padding: 16, opacity: dim ? 0.55 : 1 }}
    >
      <View style={{ minWidth: 96 }}>
        <Text style={{ color: c.ink, fontSize: 21, fontWeight: "800", textAlign: isRTL() ? "right" : "left" }}>{fareLabel(offer.fare_formatted, offer.fare_amount)}</Text>
        <QualityMark mark={q.mark} good={q.good} />
      </View>
      <View style={{ flex: 1 }}>
        {showDriver && offer.driver_name && <DriverTag name={offer.driver_name} />}
        <Text numberOfLines={1} style={{ color: c.ink, fontSize: 15, ...arrow("p") }}>↑ {cleanAddress(offer.pickup_address)}</Text>
        <Text numberOfLines={1} style={{ color: c.ink, fontSize: 15, ...arrow("d") }}>↓ {cleanAddress(offer.dropoff_address)}</Text>
      </View>
      <View style={{ alignItems: isRTL() ? "flex-start" : "flex-end", gap: 6 }}>
        <StatusBadge status={status} label={t(`status.${status}`)} />
        <Text style={{ color: c.inkSubtle, fontSize: 13 }}>{distanceLabel(offer.distance_m)}</Text>
      </View>
    </Pressable>
  );
}
