import { useCallback, useState } from "react";
import { View, ScrollView, RefreshControl, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/typography";
import { useFocusEffect, useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { UserCircle, Map as MapIcon } from "lucide-react-native";
import { api, type HomeData, type FleetHomeData, type Offer } from "@/lib/api";
import { connectDriverRealtime } from "@/lib/realtime";
import { alertOffer, markAlerted } from "@/lib/offer-alert";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { openRouteInMaps } from "@/lib/maps";
import { useColors, cardStyle, radius } from "@/lib/theme";
import { fareLabel, perKmValue, distanceLabel, cleanAddress } from "@/lib/format";
import { Logo, SectionLabel, StatusBadge } from "@/components/ui";
import { OfferCard } from "@/components/offer-card";

export default function HomeScreen() {
  const c = useColors();
  const router = useRouter();
  const { driver, isOwner } = useAuth();
  const [data, setData] = useState<HomeData | null>(null);
  const [fleet, setFleet] = useState<FleetHomeData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const row = isRTL() ? "row-reverse" : "row";
  const align = isRTL() ? "right" : "left";

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      if (isOwner) {
        setFleet((await api.fleetHome()).data);
      } else {
        const home = (await api.home()).data;
        setData(home);
        // Chime/vibrate when a NEW offer arrives while the app is open (the OS push
        // stays silent in the foreground). alertOffer only fires for an offer that
        // arrived after launch, so pre-existing offers stay quiet.
        void alertOffer(home.active_offer);
      }
    } catch {
      /* keep last */
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, [isOwner]);

  // Live home: load on focus, then silently re-poll every few seconds while the
  // screen is open so a new offer or a status change appears without a manual
  // pull. The interval is cleared on blur so it never runs off-screen.
  useFocusEffect(
    useCallback(() => {
      load();
      const iv = setInterval(() => load(true), 4000);
      // Refresh the instant a dispatch push lands, so a new offer / status change
      // shows immediately rather than waiting for the next poll tick.
      // A foreground OS push already chimes on its own — record its offer so the
      // poll/realtime reload that follows doesn't double-chime it.
      const sub = Notifications.addNotificationReceivedListener((n) => {
        markAlerted(Number(n.request.content.data?.offer_id));
        load(true);
      });
      // Real-time (WebSocket): a driver's channel pushes offer changes instantly;
      // the 4s poll stays as the safety net. Owners use the User token, not a
      // driver channel, so they rely on the poll.
      const rt =
        !isOwner && driver?.id ? connectDriverRealtime(driver.id, api.getToken() ?? "", () => load(true)) : null;
      return () => { clearInterval(iv); sub.remove(); rt?.disconnect(); };
    }, [load, isOwner, driver?.id]),
  );

  const greeting = new Date().getHours() >= 17 ? t("home.greetingEvening") : t("home.greetingDay");
  const today = isOwner ? fleet?.today : data?.today;
  const active = data?.active_offer ?? null;
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} tintColor={c.ink} />}
      >
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

        {/* Live / active offer — the driver's current offer as the full €/km card,
            with a quick "open in map" shortcut for its pickup → drop-off route. */}
        {!isOwner && active && (
          <View style={{ gap: 10 }}>
            <SectionLabel>{t("home.activeOffer")}</SectionLabel>
            <OfferCard offer={active} onPress={() => router.push(`/offer/${active.id}`)} />
            <Pressable
              onPress={() => openRouteInMaps(active.pickup_address, active.dropoff_address)}
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
          <View style={cardStyle(c)}>
            <View style={{ flexDirection: row }}>
              <GridCell label={t("home.incomeToday")} value={fareLabel(null, today?.earnings ?? 0)} c={c} border />
              <GridCell label={t("home.avgKm")} value={fareLabel(null, avgKm)} c={c} />
            </View>
            <View style={{ height: 1, backgroundColor: c.line }} />
            <View style={{ flexDirection: row }}>
              <GridCell label={t("home.st.offers")} value={String(today?.total ?? 0)} c={c} border />
              <GridCell label={t("home.st.accept")} value={`${today?.accepted ?? 0}/${today?.total ?? 0}`} c={c} />
            </View>
          </View>
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
      </View>
      <StatusBadge status={status} label={t(`status.${status}`)} />
    </Pressable>
  );
}

/** A small driver-name label used only in fleet-owner mode to attribute a row. */
export function DriverTag({ name }: { name: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", gap: 5, marginBottom: 3, alignSelf: isRTL() ? "flex-end" : "flex-start" }}>
      <UserCircle size={14} color={c.inkSubtle} />
      <Text numberOfLines={1} style={{ color: c.inkSubtle, fontSize: 12, fontWeight: "500", textAlign: isRTL() ? "right" : "left" }}>{name}</Text>
    </View>
  );
}
