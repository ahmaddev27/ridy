import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { Text, TextInput } from "@/components/typography";
import { useRouter, useFocusEffect } from "expo-router";
import { Search, SlidersHorizontal } from "@/components/icons";
import { api, type Offer, type OffersQuery, type FleetDriver } from "@/lib/api";
import { useLiveReload } from "@/lib/use-live-reload";
import { useAuth } from "@/lib/auth";
import { t, isRTL, getLocale, useLocale } from "@/lib/i18n";
import { useColors, radius, isDarkPalette } from "@/lib/theme";
import { OfferCard } from "@/components/offer-card";
import { FilterSheet, DEFAULT_FILTERS, type OfferFilters, type SortKey } from "@/components/filter-sheet";
import { PeriodNavigator, periodWindow, startOfPeriod, type PeriodRange } from "@/components/period-navigator";

/** Map a picked calendar day → range="today" + its day-offset from today. */
function dayOffset(d: Date): number {
  const t0 = startOfPeriod("today", 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return Math.min(0, Math.round((day.getTime() - t0.getTime()) / 86_400_000));
}
import { alertOffer } from "@/lib/offer-alert";
import { LoadErrorBanner, PushHealthBanner } from "@/components/status-banner";

const PER_PAGE = 20;
/** Within this many px of the top the feed counts as "at the top" for live reloads. */
const NEAR_TOP_PX = 200;


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

/** Append a page without duplicating rows that shifted while offers kept arriving. */
function mergeById(prev: Offer[], next: Offer[]): Offer[] {
  const seen = new Set(prev.map((o) => o.id));
  return [...prev, ...next.filter((o) => !seen.has(o.id))];
}

/** Search waits for the driver to stop typing; 1-character terms are ignored. */
const SEARCH_DEBOUNCE_MS = 350;

export default function OffersScreen() {
  const c = useColors();
  const router = useRouter();
  const { isOwner } = useAuth();
  useLocale(); // re-render on a language switch
  const align = isRTL() ? "right" : "left";

  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState<OfferFilters>(DEFAULT_FILTERS);
  const [range, setRange] = useState<PeriodRange>("today");
  const [offset, setOffset] = useState(0);
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
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const h = setTimeout(() => {
      const term = search.trim();
      setSearchTerm(term.length === 1 ? "" : term);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [search]);

  // The current query lives in a ref, so the fetcher, the poll and the live
  // listener stay stable while filters change — no socket/poll churn per keystroke.
  const query = { status: filters.status, range, offset, search: searchTerm, driverId };
  const queryRef = useRef(query);
  queryRef.current = query;
  const queryKey = JSON.stringify(query);

  // Drop responses that a newer page-1 request (filter change, poll) superseded.
  const seq = useRef(0);
  const loadingMoreRef = useRef(false);

  const fetchPage = useCallback(
    async (target: number) => {
      const q = queryRef.current;
      const mine = target === 1 ? ++seq.current : seq.current;
      const { from, to } = periodWindow(q.range, q.offset);
      const params: OffersQuery = { per_page: PER_PAGE, page: target, from, to };
      if (q.status !== "all") params.status = q.status;
      if (q.search) params.search = q.search;
      if (isOwner && q.driverId != null) params.driver_id = q.driverId;
      const res = isOwner ? await api.fleetOffers(params) : await api.offers(params);
      if (mine !== seq.current) return; // stale: a newer query already answered
      setLastPage(res.meta?.last_page ?? 1);
      setTotal(res.meta?.total ?? res.data.length);
      setPage(res.meta?.current_page ?? target);
      setOffers((prev) => (target === 1 ? res.data : mergeById(prev, res.data)));
      setLoadError(false);
      setLoaded(true);
      // Fallback chime for a new offer that surfaced without its push (driver only).
      if (target === 1 && !isOwner) alertOffer(res.data.find((o) => o.status === "pending"));
    },
    [isOwner],
  );

  // Load the tenant's drivers once, for the owner-only driver filter.
  useEffect(() => {
    if (!isOwner) return;
    api.fleetDrivers().then((r) => setDrivers(r.data)).catch(() => { /* keep empty */ });
  }, [isOwner]);

  // Only auto-refresh while the driver is near the top of the feed: a silent
  // reset to page 1 mustn't yank away rows they scrolled down to. Tracked by
  // scroll position (not page number), so live updates resume after they
  // scroll back up from page 2+.
  const nearTopRef = useRef(true);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    nearTopRef.current = e.nativeEvent.contentOffset.y < NEAR_TOP_PX;
  }, []);

  // Live feed: focus load, adaptive poll (5s without socket, 30s with), and a
  // reload on every socket event / push / resume — one request at a time.
  useLiveReload(
    async () => {
      if (!nearTopRef.current || loadingMoreRef.current) return;
      try {
        await fetchPage(1);
      } catch {
        setLoadError(true);
      }
    },
    { fastMs: 5_000, slowMs: 30_000 },
  );

  // Keep the app icon clean — no unread badge on this app.
  useFocusEffect(
    useCallback(() => {
      Notifications.setBadgeCountAsync(0).catch(() => { /* badge unsupported */ });
    }, []),
  );

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchPage(1);
    } catch {
      setLoadError(true);
    } finally {
      setRefreshing(false);
    }
  }, [fetchPage]);

  // A query change (debounced search, period, status, driver) reloads page 1.
  // The first render is covered by the focus load.
  const firstQuery = useRef(true);
  useEffect(() => {
    if (firstQuery.current) {
      firstQuery.current = false;
      return;
    }
    void reload();
  }, [queryKey, reload]);

  async function loadMore() {
    if (loadingMoreRef.current || refreshing || page >= lastPage) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try { await fetchPage(page + 1); } catch { /* keep what we have */ } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  const openOffer = useCallback((id: number) => router.push(`/offer/${id}`), [router]);
  const renderItem = useCallback(
    ({ item }: { item: Offer }) => <OfferCard offer={item} showDriver={isOwner} onOpen={openOffer} />,
    [isOwner, openOffer],
  );

  // Sort is applied client-side over the loaded pages.
  const shown = useMemo(() => sortOffers(offers, filters.sort), [offers, filters.sort]);

  // The three quick pills mirror common filter combos.
  const quick: { key: string; label: string; active: boolean; apply: () => void }[] = [
    { key: "all", label: t("filter.all"), active: filters.sort === "new" && filters.status === "all", apply: () => setFilters(DEFAULT_FILTERS) },
    { key: "rate", label: t("filter.bestKm"), active: filters.sort === "rate", apply: () => setFilters((f) => ({ ...f, sort: "rate" })) },
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
        onScroll={onScroll}
        scrollEventThrottle={100}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 2 }}>
            <Text style={{ color: c.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.5, textAlign: align }}>{t("offers.title")}</Text>

            <PushHealthBanner />
            {loadError && <LoadErrorBanner onRetry={() => void reload()} />}

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

            {/* Uber-style date range navigator */}
            <PeriodNavigator
              label={periodWindow(range, offset).label}
              range={range}
              selected={startOfPeriod(range, offset)}
              onRange={(r) => { setRange(r); setOffset(0); }}
              onDate={(d) => { setRange("today"); setOffset(dayOffset(d)); }}
              onPrev={() => setOffset((o) => o - 1)}
              onNext={() => setOffset((o) => Math.min(0, o + 1))}
              canNext={offset < 0}
            />

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
                accessibilityRole="button"
                accessibilityLabel={t("offers.filter")}
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
            {/* A failed first load is not "no offers". */}
            <Text style={{ color: c.inkSubtle }}>{loadError && !loaded ? t("load.noData") : t("offers.empty")}</Text>
          </View>
        )}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={c.ink} style={{ paddingVertical: 16 }} /> : null}
        renderItem={renderItem}
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
