import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { api, type Offer, type OffersQuery } from "@/lib/api";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius } from "@/lib/theme";
import { fareLabel, perKmLabel, cleanAddress } from "@/lib/format";
import { Field, StatusBadge } from "@/components/ui";

const STATUS_FILTERS = ["all", "pending", "accepted", "started", "completed", "rejected", "canceled"] as const;
const PER_PAGE = 20;

export default function OffersScreen() {
  const router = useRouter();
  const c = useColors();
  const align = isRTL() ? "right" : "left";

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [offers, setOffers] = useState<Offer[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (targetPage: number) => {
      const params: OffersQuery = { per_page: PER_PAGE, page: targetPage };
      if (status !== "all") params.status = status;
      if (search.trim()) params.search = search.trim();
      if (from.trim()) params.from = from.trim();
      if (to.trim()) params.to = to.trim();
      const res = await api.offers(params);
      setLastPage(res.meta?.last_page ?? 1);
      setPage(res.meta?.current_page ?? targetPage);
      setOffers((prev) => (targetPage === 1 ? res.data : [...prev, ...res.data]));
    },
    [status, search, from, to],
  );

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchPage(1);
    } catch {
      /* keep the last list on transient errors */
    } finally {
      setRefreshing(false);
    }
  }, [fetchPage]);

  // Re-query whenever a filter changes (debounced for the free-text search).
  useEffect(() => {
    const handle = setTimeout(reload, 300);
    return () => clearTimeout(handle);
  }, [reload]);

  async function loadMore() {
    if (loadingMore || refreshing || page >= lastPage) return;
    setLoadingMore(true);
    try {
      await fetchPage(page + 1);
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <FlatList
      data={offers}
      keyExtractor={(o) => String(o.id)}
      style={{ backgroundColor: c.canvas }}
      contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={c.ink} />}
      onEndReachedThreshold={0.4}
      onEndReached={loadMore}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 4 }}>
          <Field label={t("offers.search")} value={search} onChangeText={setSearch} autoCapitalize="none" />

          {/* Status chips */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {STATUS_FILTERS.map((s) => {
              const activeChip = status === s;
              const label = s === "all" ? t("filter.all") : t(`status.${s}`);
              return (
                <Pressable
                  key={s}
                  onPress={() => setStatus(s)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 999,
                    backgroundColor: activeChip ? c.primary : c.surface2,
                    borderWidth: 1,
                    borderColor: activeChip ? c.primary : c.line,
                  }}
                >
                  <Text style={{ color: activeChip ? c.primaryInk : c.inkMuted, fontWeight: "600", fontSize: 13 }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Date range */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label={t("offers.from")} value={from} onChangeText={setFrom} placeholder="2026-01-01" autoCapitalize="none" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t("offers.to")} value={to} onChangeText={setTo} placeholder="2026-12-31" autoCapitalize="none" />
            </View>
          </View>
        </View>
      }
      ListEmptyComponent={
        refreshing ? null : (
          <View style={{ alignItems: "center", justifyContent: "center", paddingTop: 60 }}>
            <Text style={{ color: c.inkSubtle }}>{t("offers.empty")}</Text>
          </View>
        )
      }
      ListFooterComponent={
        loadingMore ? (
          <View style={{ paddingVertical: 16 }}>
            <ActivityIndicator color={c.ink} />
          </View>
        ) : page < lastPage ? (
          <Pressable
            onPress={loadMore}
            style={{ paddingVertical: 14, alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: c.line }}
          >
            <Text style={{ color: c.inkMuted, fontWeight: "600" }}>{t("offers.loadMore")}</Text>
          </Pressable>
        ) : null
      }
      renderItem={({ item }) => {
        const s = item.status ?? "pending";
        return (
          <Pressable
            onPress={() => router.push(`/offer/${item.id}`)}
            style={{
              backgroundColor: c.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: c.line,
              padding: 16,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "baseline", gap: 8 }}>
                <Text style={{ color: c.ink, fontSize: 20, fontWeight: "800" }}>
                  {fareLabel(item.fare_formatted, item.fare_amount)}
                </Text>
                <Text style={{ color: c.accent, fontSize: 13, fontWeight: "600" }}>
                  {perKmLabel(item.fare_amount, item.distance_m)}
                </Text>
              </View>
              <StatusBadge status={s} label={t(`status.${s}`)} />
            </View>
            <Text style={{ color: c.inkMuted, textAlign: align }} numberOfLines={1}>
              ↑ {cleanAddress(item.pickup_address)}
            </Text>
            <Text style={{ color: c.inkSubtle, textAlign: align }} numberOfLines={1}>
              ↓ {cleanAddress(item.dropoff_address)}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}
