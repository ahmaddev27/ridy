import { View, Pressable } from "react-native";
import { Clock } from "lucide-react-native";
import { Text } from "@/components/typography";
import { Badge, StatusBadge } from "@/components/ui";
import { useColors, radius, cardStyle, isDarkPalette } from "@/lib/theme";
import { isRTL, t } from "@/lib/i18n";
import type { Offer } from "@/lib/api";
import { fareLabel, perKmValue, distanceLabel, cleanAddress, timeLabel } from "@/lib/format";

const start = () => (isRTL() ? "right" : "left") as "right" | "left";
const end = () => (isRTL() ? "left" : "right") as "left" | "right";
const rowDir = () => (isRTL() ? "row-reverse" : "row") as "row-reverse" | "row";

/**
 * The product's central component: a monochrome offer card whose hero is the
 * €/km rate (the number a driver judges in ~5 seconds), with the total price,
 * a hairline-framed metadata strip, a pickup→drop-off route, and a status/time
 * footer. View-only — the driver accepts inside Uber — so the whole card is one
 * press target that opens the details, with no accept/reject actions.
 */
export function OfferCard({
  offer,
  onPress,
  showDriver,
}: {
  offer: Offer;
  onPress: () => void;
  showDriver?: boolean;
}) {
  const c = useColors();
  const status = offer.status ?? "pending";
  const dim = status === "rejected" || status === "canceled";
  const live = status === "pending";
  const perKm = perKmValue(offer.fare_amount, offer.distance_m);
  const hero = perKm?.value ?? fareLabel(offer.fare_formatted, offer.fare_amount);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        ...cardStyle(c, live),
        padding: 16,
        gap: 14,
        opacity: dim ? 0.55 : pressed ? 0.85 : 1,
      })}
    >
      {/* 1 · Badge + hero €/km  |  total price */}
      <View style={{ flexDirection: rowDir(), alignItems: "flex-start", justifyContent: "space-between" }}>
        <View style={{ gap: 8, alignItems: isRTL() ? "flex-end" : "flex-start" }}>
          {live ? (
            <Badge variant={perKm?.good ? "top" : "verified"} label={perKm?.good ? "Top Offer" : "Verified"} />
          ) : (
            <StatusBadge status={status} label={t(`status.${status}`)} />
          )}
          <View style={{ flexDirection: rowDir(), alignItems: "flex-end", gap: 3 }}>
            <Text style={{ color: c.ink, fontSize: 33, fontWeight: "800", letterSpacing: -1, textAlign: start() }}>
              {hero}
            </Text>
            {perKm && (
              <Text style={{ color: c.inkSubtle, fontSize: 15, fontWeight: "500", marginBottom: 5 }}>/km</Text>
            )}
          </View>
        </View>
        <View style={{ alignItems: isRTL() ? "flex-start" : "flex-end", gap: 2 }}>
          <Text style={{ color: c.ink, fontSize: 17, fontWeight: "700" }}>
            {fareLabel(offer.fare_formatted, offer.fare_amount)}
          </Text>
          <Text style={{ color: c.inkSubtle, fontSize: 11 }}>{t("offer.total")}</Text>
        </View>
      </View>

      {/* 2 · Metadata strip — hairline framed, equal columns */}
      <View
        style={{
          flexDirection: rowDir(),
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: c.overlay,
          paddingVertical: 11,
        }}
      >
        <MetaCol value={distanceLabel(offer.distance_m)} label={t("offer.distance")} />
        <MetaDivider />
        <MetaCol value={timeLabel(offer.received_at).split(",")[0]?.trim() || "—"} label={t("offer.received")} />
        <MetaDivider />
        <MetaCol
          value={offer.rider_name || (timeLabel(offer.received_at).split(",")[1]?.trim() ?? "—")}
          label={offer.rider_name ? t("offer.rider") : t("offer.requested")}
        />
      </View>

      {/* 3 · Route: pickup → drop-off */}
      <View style={{ flexDirection: rowDir(), gap: 12 }}>
        <View style={{ alignItems: "center", paddingVertical: 3 }}>
          <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: c.ink }} />
          <View style={{ flex: 1, width: 1, marginVertical: 3, backgroundColor: c.line, minHeight: 16 }} />
          <View style={{ width: 11, height: 11, borderRadius: 2, backgroundColor: c.ink }} />
        </View>
        <View style={{ flex: 1, gap: 12 }}>
          <Stop label={t("offers.pickup")} value={cleanAddress(offer.pickup_address)} c={c} />
          <Stop label={t("offers.dropoff")} value={cleanAddress(offer.dropoff_address)} c={c} />
        </View>
      </View>

      {/* 4 · Footer: driver (owner mode) + countdown/received */}
      {(live || showDriver) && (
        <View style={{ flexDirection: rowDir(), alignItems: "center", justifyContent: "space-between" }}>
          {showDriver && offer.driver_name ? (
            <Text style={{ color: c.inkMuted, fontSize: 12.5, fontWeight: "500" }}>{offer.driver_name}</Text>
          ) : (
            <View />
          )}
          {live && offer.accept_window_seconds != null && (
            <View style={{ flexDirection: rowDir(), alignItems: "center", gap: 6 }}>
              <Clock size={14} color={c.inkSubtle} />
              <Text style={{ color: c.inkMuted, fontSize: 12.5, fontWeight: "700" }}>
                {offer.accept_window_seconds}
                {t("offer.secShort")}
              </Text>
              <Text style={{ color: c.inkSubtle, fontSize: 11 }}>{t("offer.remaining")}</Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

function MetaCol({ value, label }: { value: string; label: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
      <Text numberOfLines={1} style={{ color: c.ink, fontSize: 12.5, fontWeight: "700" }}>
        {value}
      </Text>
      <Text style={{ color: c.inkSubtle, fontSize: 10.5 }}>{label}</Text>
    </View>
  );
}

function MetaDivider() {
  const c = useColors();
  return <View style={{ width: 1, backgroundColor: c.overlay }} />;
}

function Stop({ label, value, c }: { label: string; value: string; c: ReturnType<typeof useColors> }) {
  return (
    <View style={{ gap: 1 }}>
      <Text style={{ color: c.inkSubtle, fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textAlign: start() }}>
        {label.toUpperCase()}
      </Text>
      <Text numberOfLines={1} style={{ color: c.ink, fontSize: 13.5, fontWeight: "500", textAlign: start() }}>
        {value}
      </Text>
    </View>
  );
}
