import { useCallback, useEffect, useState } from "react";
import { View, ScrollView, RefreshControl, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { useRouter } from "expo-router";
import { Map as MapIcon, Route } from "@/components/icons";
import { api, type HomeData, type FleetHomeData, type Offer } from "@/lib/api";
import { alertOffer, freshUntil, isFreshOffer } from "@/lib/offer-alert";
import { useAuth } from "@/lib/auth";
import { t, isRTL, useLocale } from "@/lib/i18n";
import { openRouteInMaps } from "@/lib/maps";
import { useColors, cardStyle, radius } from "@/lib/theme";
import { fareLabel, perKmValue, distanceLabel, cleanAddress } from "@/lib/format";
import { useLiveReload } from "@/lib/use-live-reload";
import { Logo, SectionLabel, StatusBadge } from "@/components/ui";
import { OfferCard } from "@/components/offer-card";
import { LoadErrorBanner, PushHealthBanner } from "@/components/status-banner";

/** The newest pending offer: the backend's `pending_offer` when it sends one
 *  (newer backends), else the newest pending row in `recent`. It may be HELD
 *  (the driver is on a trip) and long past its accept window. */
function latestPendingOf(home: HomeData): Offer | null {
  if (home.pending_offer !== undefined) return home.pending_offer ?? null;
  return home.recent.find((o) => o.status === "pending") ?? null;
}

/** The pending offer only while it is still inside its accept window — a held,
 *  stale offer is never shown as "New offer". */
function freshPendingOf(home: HomeData, now: number): Offer | null {
  const p = latestPendingOf(home);
  return p && p.status === "pending" && isFreshOffer(p, now) ? p : null;
}

/** Replace state only when the payload actually changed (no re-render per poll). */
function sameJson<T>(a: T | null, b: T): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

export default function HomeScreen() {
  const c = useColors();
  const router = useRouter();
  const { driver, isOwner } = useAuth();
  useLocale(); // re-render on a language switch
  const [data, setData] = useState<HomeData | null>(null);
  const [fleet, setFleet] = useState<FleetHomeData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const row = isRTL() ? "row-reverse" : "row";
  const align = isRTL() ? "right" : "left";

  async function load() {
    try {
      if (isOwner) {
        const next = (await api.fleetHome()).data;
        setFleet((prev) => (sameJson(prev, next) ? prev : next));
      } else {
        const home = (await api.home()).data;
        setData((prev) => (sameJson(prev, home) ? prev : home));
        // Fallback chime for a new offer that surfaced without its push (the
        // push itself already rang through the foreground handler).
        // alertOffer judges freshness itself.
        alertOffer(latestPendingOf(home));
      }
      setLoadError(false);
    } catch {
      setLoadError(true); // keep the last good data, but say it may be stale
    }
  }

  // Live home: load on focus; poll every 4s while the socket is down and every
  // 30s while it's up (then it's only a safety net); reload on every socket
  // event / push / resume. Owners have no socket, so they poll every 8s.
  const run = useLiveReload(load, { fastMs: isOwner ? 8_000 : 4_000, slowMs: 30_000 });

  async function pullToRefresh() {
    setRefreshing(true);
    try {
      await run();
    } finally {
      setRefreshing(false);
    }
  }

  const openOffer = useCallback((id: number) => router.push(`/offer/${id}`), [router]);

  // Identical polls don't re-render (sameJson), so re-render once when the shown
  // pending offer's accept window closes — the "New offer" card then disappears.
  const [, setExpiryTick] = useState(0);
  const latest = !isOwner && data ? latestPendingOf(data) : null;
  const latestExpiry = latest ? freshUntil(latest) : NaN;
  useEffect(() => {
    const ms = latestExpiry - Date.now();
    if (!Number.isFinite(ms) || ms < 0) return;
    const timer = setTimeout(() => setExpiryTick((n) => n + 1), ms + 50);
    return () => clearTimeout(timer);
  }, [latestExpiry]);

  const greeting = new Date().getHours() >= 17 ? t("home.greetingEvening") : t("home.greetingDay");
  const today = isOwner ? fleet?.today : data?.today;
  const active = data?.active_offer ?? null;
  const pending = !isOwner && data ? freshPendingOf(data, Date.now()) : null;
  const noData = isOwner ? !fleet : !data;
  const headline = isOwner ? (fleet?.owner.company_name ?? driver?.company_name ?? "…") : (data?.driver.name ?? "…");
  const sub = isOwner ? t("home.fleetTitle") : (driver?.company_name ?? "");
  const recent = isOwner ? fleet?.recent ?? [] : data?.recent ?? [];
  const activeOffers = fleet?.active_offers ?? [];

  const online = isOwner ? (fleet?.online_drivers ?? 0) > 0 : !!data?.driver.online;
  const engagement = data?.driver.engagement ?? 0;
  const avgKm = today && today.km > 0 ? today.earnings / today.km : 0;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 18 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} tintColor={c.ink} />}
      >
        {/* Offers can't ring (permission / channel off) — the core promise. */}
        <PushHealthBanner />
        {loadError && <LoadErrorBanner onRetry={() => void pullToRefresh()} />}

        {/* Brand + greeting + status — one combined card */}
        <View style={{ ...cardStyle(c), padding: 16, gap: 13 }}>
          <View style={{ flexDirection: row, alignItems: "center", gap: 12 }}>
            <Logo size={36} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: c.ink, fontSize: 17, fontWeight: "700", letterSpacing: -0.3, textAlign: align }}>
                {greeting}, {headline}
              </Text>
              {!!sub && <Text numberOfLines={1} style={{ color: c.inkSubtle, fontSize: 12.5, textAlign: align }}>{sub}</Text>}
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: c.line }} />

          <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flexDirection: row, alignItems: "center", gap: 10 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: online ? c.accent : c.inkFaint }} />
              <View>
                <Text style={{ color: c.ink, fontSize: 14.5, fontWeight: "600", textAlign: align }}>
                  {isOwner
                    ? `${fleet?.online_drivers ?? 0} ${t("fleet.onlineDrivers")}`
                    : online
                      ? t(`home.engagement.${engagement}`)
                      : t("home.offline")}
                </Text>
                <Text style={{ color: c.inkSubtle, fontSize: 11, textAlign: align }}>{t("home.driverStatus")}</Text>
              </View>
            </View>
            <StatusBadge status={online ? "completed" : "rejected"} label={online ? t("home.online") : t("home.offline")} />
          </View>
        </View>

        {/* A NEW offer still inside its accept window — the €/km card the driver
            judges in seconds, above everything else. */}
        {pending && pending.id !== active?.id && (
          <View style={{ gap: 10 }}>
            <SectionLabel>{t("home.newOffer")}</SectionLabel>
            <OfferCard offer={pending} onOpen={openOffer} />
          </View>
        )}

        {/* Live / active offer — the driver's current offer as the full €/km card,
            with a quick "open in map" shortcut for its pickup → drop-off route. */}
        {!isOwner && active && (
          <View style={{ gap: 10 }}>
            <SectionLabel>{t("home.activeOffer")}</SectionLabel>
            <OfferCard offer={active} onOpen={openOffer} />
            <Pressable
              onPress={() =>
                openRouteInMaps({
                  pickup: active.pickup_address,
                  dropoff: active.dropoff_address,
                  pickupPoint: { lat: active.pickup_lat, lng: active.pickup_lng },
                  dropoffPoint: { lat: active.dropoff_lat, lng: active.dropoff_lng },
                  stops: active.stops,
                  exact: active.geo_source === "uber",
                })
              }
              style={({ pressed }) => ({
                flexDirection: row,
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingVertical: 13,
                borderRadius: radius.control,
                backgroundColor: c.surfaceRaised,
                borderWidth: 1,
                borderColor: c.line,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <MapIcon size={17} color={c.ink} />
              <Text style={{ color: c.ink, fontSize: 15, fontWeight: "600" }}>{t("offer.openMaps")}</Text>
            </Pressable>
          </View>
        )}

        {isOwner && activeOffers.length > 0 && (
          <View style={{ gap: 10 }}>
            <SectionLabel>{t("fleet.activeNow")}</SectionLabel>
            <View style={cardStyle(c)}>
              {activeOffers.map((o, i) => (
                <RecentRow key={o.id} offer={o} showDriver onPress={() => router.push(`/offer/${o.id}`)} last={i === activeOffers.length - 1} c={c} />
              ))}
            </View>
          </View>
        )}

        {/* TODAY — 2×2 grid (design: income / avg €/km / offers / accepted) */}
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
            <SectionLabel>{t("home.today")}</SectionLabel>
            <Pressable onPress={() => router.push("/statistics")}>
              <Text style={{ color: c.inkMuted, fontSize: 13.5, fontWeight: "600" }}>{t("profile.stats")}</Text>
            </Pressable>
          </View>
          {/* Never pass a failed load off as real zeros ("0,00 €"): show a dash. */}
          <View style={cardStyle(c)}>
            <View style={{ flexDirection: row }}>
              <GridCell label={t("home.incomeToday")} value={today ? fareLabel(null, today.earnings) : "—"} c={c} border />
              <GridCell label={t("home.avgKm")} value={today ? fareLabel(null, avgKm) : "—"} c={c} />
            </View>
            <View style={{ height: 1, backgroundColor: c.line }} />
            <View style={{ flexDirection: row }}>
              <GridCell label={t("home.st.offers")} value={today ? String(today.total) : "—"} c={c} border />
              <GridCell label={t("home.st.accept")} value={today ? `${today.accepted}/${today.total}` : "—"} c={c} />
            </View>
          </View>
          {noData && loadError && (
            <Text style={{ color: c.inkSubtle, fontSize: 12.5, textAlign: align }}>{t("load.noData")}</Text>
          )}
        </View>

        {/* Recent — compact rows, full list on the Offers tab */}
        {recent.length > 0 && (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between" }}>
              <SectionLabel>{t("home.recent")}</SectionLabel>
              <Pressable onPress={() => router.push("/offers")}>
                <Text style={{ color: c.inkMuted, fontSize: 13.5, fontWeight: "600" }}>{t("home.all")}</Text>
              </Pressable>
            </View>
            <View style={cardStyle(c)}>
              {recent.slice(0, 4).map((o, i, arr) => (
                <RecentRow key={o.id} offer={o} showDriver={isOwner} onPress={() => router.push(`/offer/${o.id}`)} last={i === arr.length - 1} c={c} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

type Colors = ReturnType<typeof useColors>;

function GridCell({ label, value, c, border }: { label: string; value: string; c: Colors; border?: boolean }) {
  const align = isRTL() ? "right" : "left";
  return (
    <View style={{ flex: 1, padding: 16, gap: 5, borderRightWidth: border && !isRTL() ? 1 : 0, borderLeftWidth: border && isRTL() ? 1 : 0, borderColor: c.line }}>
      <SectionLabel>{label}</SectionLabel>
      <Text style={{ color: c.ink, fontSize: 22, fontWeight: "700", letterSpacing: -0.4, textAlign: align, writingDirection: "ltr" }}>{value}</Text>
    </View>
  );
}

/** A compact recent-offer row: €/km + route + status. */
function RecentRow({ offer, onPress, last, showDriver, c }: { offer: Offer; onPress: () => void; last: boolean; showDriver?: boolean; c: Colors }) {
  const row = isRTL() ? "row-reverse" : "row";
  const align = isRTL() ? "right" : "left";
  const status = offer.status ?? "pending";
  const dim = status === "rejected" || status === "canceled";
  const perKm = perKmValue(offer.fare_amount, offer.distance_m);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: row, alignItems: "center", gap: 12, padding: 15, borderBottomWidth: last ? 0 : 1, borderColor: c.line, opacity: dim ? 0.5 : pressed ? 0.7 : 1 })}
    >
      <View style={{ minWidth: 76 }}>
        {/* Primary = the total trip fare (what the driver earns); the €/km rate is
            the secondary line beneath it. */}
        <Text style={{ color: c.ink, fontSize: 17, fontWeight: "700", letterSpacing: -0.5, textAlign: align }}>
          {fareLabel(offer.fare_formatted, offer.fare_amount)}
        </Text>
        <Text style={{ color: c.inkSubtle, fontSize: 10.5, textAlign: align }}>
          {perKm ? `${perKm.value} €/km` : distanceLabel(offer.distance_m)}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        {showDriver && offer.driver_name && (
          <Text numberOfLines={1} style={{ color: c.inkSubtle, fontSize: 11, fontWeight: "500", textAlign: align }}>{offer.driver_name}</Text>
        )}
        <Text numberOfLines={1} style={{ color: c.inkMuted, fontSize: 12.5, textAlign: align }}>{cleanAddress(offer.pickup_address)}</Text>
        <Text numberOfLines={1} style={{ color: c.ink, fontSize: 13, fontWeight: "500", textAlign: align }}>{cleanAddress(offer.dropoff_address)}</Text>
        {(offer.stops_count ?? 0) >= 2 && (
          <View style={{ flexDirection: row, alignItems: "center", gap: 4, marginTop: 2 }}>
            <Route size={11} color={c.pending} />
            <Text numberOfLines={1} style={{ color: c.pending, fontSize: 11, fontWeight: "600", textAlign: align }}>
              {t("offer.multiStop")} · {offer.stops_count} {t("offer.dropoffs")}
            </Text>
          </View>
        )}
      </View>
      <StatusBadge status={status} label={t(`status.${status}`)} />
    </Pressable>
  );
}
