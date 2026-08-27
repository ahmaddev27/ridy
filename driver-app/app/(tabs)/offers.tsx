import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, FlatList, Pressable, RefreshControl, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { Text, TextInput } from "@/components/typography";
import { useRouter, useFocusEffect } from "expo-router";
import { Search, SlidersHorizontal } from "lucide-react-native";
import { api, type Offer, type OffersQuery, type FleetDriver } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, isRTL, getLocale } from "@/lib/i18n";
import { useColors, radius, isDarkPalette } from "@/lib/theme";
import { fleetNow } from "@/lib/fleet-day";
import { OfferCard } from "@/components/offer-card";
import { FilterSheet, DEFAULT_FILTERS, type OfferFilters, type SortKey } from "@/components/filter-sheet";

const PER_PAGE = 20;

/** Local yyyy-mm-dd for the date window. */
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** from/to for the chosen date window (empty for "all"). Dates are fleet-days
 *  (the Uber day starts at 04:00), so "today" before 04:00 is still yesterday. */
function dateWindow(day: OfferFilters["day"]): { from?: string; to?: string } {
  if (day === "all") return {};
  const now = fleetNow();
  const start = new Date(now);
  if (day === "week") start.setDate(now.getDate() - 6);
  return { from: ymd(start), to: ymd(now) };
}

/** €/km for a sort comparison (missing metrics sink to the bottom). */
function rate(o: Offer): number {
  if (o.fare_amount == null || !o.distance_m) return -1;
  return o.fare_amount / (o.distance_m / 1000);
}

function sortOffers(list: Offer[], sort: SortKey): Offer[] {
  if (sort === "new") return list; // backend already returns newest-first
  const copy = [...list];
  if (sort === "rate") copy.sort((a, b) => rate(b) - rate(a));
  else if (sort === "total") copy.sort((a, b) => (b.fare_amount ?? -1) - (a.fare_amount ?? -1));
  return copy;
}

export default function OffersScreen() {
  const c = useColors();
  const router = useRouter();
  const { isOwner } = useAuth();
  const align = isRTL() ? "right" : "left";

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<OfferFilters>(DEFAULT_FILTERS);
  // Fleet-owner mode: pick a single driver (or all) to scope the feed.
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [driverId, setDriverId] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (target: number) => {
      const win = dateWindow(filters.day);
      const params: OffersQuery = { per_page: PER_PAGE, page: target, ...win };
      if (filters.status !== "all") params.status = filters.status;
      if (search.trim()) params.search = search.trim();
      if (isOwner && driverId != null) params.driver_id = driverId;
      const res = isOwner ? await api.fleetOffers(params) : await api.offers(params);
      setLastPage(res.meta?.last_page ?? 1);
      setTotal(res.meta?.total ?? res.data.length);
      setPage(res.meta?.current_page ?? target);
      setOffers((prev) => (target === 1 ? res.data : [...prev, ...res.data]));
    },
    [filters.status, filters.day, search, isOwner, driverId],
  );

  // Load the tenant's drivers once, for the owner-only driver filter.
  useEffect(() => {
    if (!isOwner) return;
    api.fleetDrivers().then((r) => setDrivers(r.data)).catch(() => { /* keep empty */ });
  }, [isOwner]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try { await fetchPage(1); } catch { /* keep */ } finally { setRefreshing(false); }
  }, [fetchPage]);

  useEffect(() => {
    const h = setTimeout(reload, 300);
    return () => clearTimeout(h);
  }, [reload]);

  // Refresh page 1 without the pull-to-refresh spinner — used by the background
  // triggers (focus / poll / incoming push) so a new offer surfaces on its own.
  const silentReload = useCallback(async () => {
    try { await fetchPage(1); } catch { /* keep current list */ }
  }, [fetchPage]);

  // Only auto-refresh while the driver is at the top of the feed (page 1); a
  // silent reset to page 1 mustn't yank away pages they scrolled into. A ref
  // keeps the guard current inside the long-lived listener/interval closures.
  const atTopRef = useRef(true);
  useEffect(() => { atTopRef.current = page <= 1 && !loadingMore; }, [page, loadingMore]);

  // Keep the feed live: catch up on focus, poll every 15s, and refresh the moment
  // a dispatch push lands — so a freshly offered ride appears without a manual pull.
  useFocusEffect(
    useCallback(() => {
      silentReload();
      const poll = setInterval(() => { if (atTopRef.current) silentReload(); }, 15000);
      const sub = Notifications.addNotificationReceivedListener(() => {
        if (atTopRef.current) silentReload();
      });
      return () => { clearInterval(poll); sub.remove(); };
    }, [silentReload]),
  );

  async function loadMore() {
    if (loadingMore || refreshing || page >= lastPage) return;
    setLoadingMore(true);
    try { await fetchPage(page + 1); } catch { /* */ } finally { setLoadingMore(false); }
  }

  // Sort is applied client-side over the loaded pages.
  const shown = useMemo(() => sortOffers(offers, filters.sort), [offers, filters.sort]);

  // The three quick pills mirror common filter combos.
  const quick: { key: string; label: string; active: boolean; apply: () => void }[] = [
    { key: "all", label: t("filter.all"), active: filters.sort === "new" && filters.day === "all" && filters.status === "all", apply: () => setFilters(DEFAULT_FILTERS) },
    { key: "rate", label: t("filter.bestKm"), active: filters.sort === "rate", apply: () => setFilters((f) => ({ ...f, sort: "rate" })) },
    { key: "today", label: t("filter.today"), active: filters.day === "today", apply: () => setFilters((f) => ({ ...f, day: "today" })) },
  ];

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <FlatList
        data={shown}
        keyExtractor={(o) => String(o.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={c.ink} />}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 2 }}>
            <Text style={{ color: c.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.5, textAlign: align }}>{t("offers.title")}</Text>

            {/* Search */}
            <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 10, backgroundColor: isDarkPalette(c) ? c.surface2 : c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, paddingHorizontal: 14, paddingVertical: 12 }}>
              <Search size={18} color={c.inkSubtle} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={t("offers.search")}
                placeholderTextColor={c.inkSubtle}
                style={{ flex: 1, color: c.ink, fontSize: 15, textAlign: align, writingDirection: isRTL() ? "rtl" : "ltr" }}
                autoCapitalize="none"
              />
            </View>

            {/* Quick pills + full-filter button */}
            <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 8 }}>
              {quick.map((q) => (
                <Pressable
                  key={q.key}
                  onPress={q.apply}
                  style={{ paddingHorizontal: 15, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: q.active ? c.primary : isDarkPalette(c) ? c.surface2 : c.surface, borderWidth: 1, borderColor: q.active ? c.primary : c.line }}
                >
                  <Text style={{ color: q.active ? c.primaryInk : c.inkMuted, fontWeight: "700", fontSize: 13.5 }}>{q.label}</Text>
                </Pressable>
              ))}
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() => setSheetOpen(true)}
                hitSlop={6}
                style={{ width: 36, height: 36, borderRadius: radius.control, alignItems: "center", justifyContent: "center", backgroundColor: isDarkPalette(c) ? c.surface2 : c.surface, borderWidth: 1, borderColor: c.line }}
              >
                <SlidersHorizontal size={17} color={c.ink} />
              </Pressable>
            </View>

            {/* Owner-only: filter the feed by driver (horizontal pills + "all"). */}
            {isOwner && drivers.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ flexDirection: isRTL() ? "row-reverse" : "row", gap: 8 }}
              >
                <DriverPill c={c} label={t("fleet.allDrivers")} active={driverId == null} onPress={() => setDriverId(null)} />
                {drivers.map((d) => (
                  <DriverPill key={d.id} c={c} label={d.name} active={driverId === d.id} onPress={() => setDriverId(d.id)} />
                ))}
              </ScrollView>
            )}

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

      <FilterSheet open={sheetOpen} value={filters} onApply={setFilters} onClose={() => setSheetOpen(false)} />
    </SafeAreaView>
  );
}

/** A single driver-filter pill (owner mode), styled like the quick pills. */
function DriverPill({ c, label, active, onPress }: { c: ReturnType<typeof useColors>; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ paddingHorizontal: 15, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: active ? c.primary : isDarkPalette(c) ? c.surface2 : c.surface, borderWidth: 1, borderColor: active ? c.primary : c.line }}
    >
      <Text numberOfLines={1} style={{ color: active ? c.primaryInk : c.inkMuted, fontWeight: "700", fontSize: 13.5 }}>{label}</Text>
    </Pressable>
  );
}
