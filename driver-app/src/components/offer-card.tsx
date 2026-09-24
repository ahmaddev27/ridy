import { memo, useEffect, useState } from "react";
import { View, Pressable } from "react-native";
import { Clock, Route } from "@/components/icons";
import { Text } from "@/components/typography";
import { Badge, StatusBadge } from "@/components/ui";
import { useColors, radius, cardStyle, isDarkPalette } from "@/lib/theme";
import { isRTL, t } from "@/lib/i18n";
import type { Offer } from "@/lib/api";
import { fareLabel, perKmValue, distanceLabel, cleanAddress, clockLabel, dayLabel } from "@/lib/format";

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
type OfferCardProps = {
  offer: Offer;
  /** Called with the offer id — a stable callback keeps the memoized card quiet. */
  onOpen: (id: number) => void;
  showDriver?: boolean;
};

function OfferCardImpl({ offer, onOpen, showDriver }: OfferCardProps) {
  const c = useColors();
  const status = offer.status ?? "pending";
  const dim = status === "rejected" || status === "canceled";
  const live = status === "pending";
  const perKm = perKmValue(offer.fare_amount, offer.distance_m);
  const fare = fareLabel(offer.fare_formatted, offer.fare_amount);
  const a11yLabel = [
    fare,
    perKm ? `${perKm.value} €/km` : null,
    `${cleanAddress(offer.pickup_address)} → ${cleanAddress(offer.dropoff_address)}`,
    t(`status.${status}`),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Pressable
      onPress={() => onOpen(offer.id)}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      style={({ pressed }) => ({
        ...cardStyle(c, live),
        padding: 16,
        gap: 14,
        opacity: dim ? 0.55 : pressed ? 0.85 : 1,
      })}
    >
      {/* 1 · Badge + hero total price  |  secondary €/km */}
      <View style={{ flexDirection: rowDir(), alignItems: "flex-start", justifyContent: "space-between" }}>
        <View style={{ gap: 8, alignItems: isRTL() ? "flex-end" : "flex-start" }}>
          {live ? (
            <Badge variant={perKm?.good ? "top" : "verified"} label={t(perKm?.good ? "offer.badge.top" : "offer.badge.verified")} />
          ) : (
            <StatusBadge status={status} label={t(`status.${status}`)} />
          )}
          {/* Hero is the total trip price. */}
          <Text style={{ color: c.ink, fontSize: 33, fontWeight: "700", letterSpacing: -1, textAlign: start() }}>
            {fare}
          </Text>
        </View>
        {/* Secondary: €/km rate, top-end. */}
        {perKm && (
          <View style={{ alignItems: isRTL() ? "flex-start" : "flex-end", gap: 2 }}>
            <View style={{ flexDirection: rowDir(), alignItems: "flex-end", gap: 3 }}>
              <Text style={{ color: c.ink, fontSize: 17, fontWeight: "600" }}>{perKm.value}</Text>
              <Text style={{ color: c.inkSubtle, fontSize: 11, marginBottom: 1 }}>€/km</Text>
            </View>
          </View>
        )}
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
        <MetaCol value={clockLabel(offer.received_at)} label={t("offer.received")} />
        <MetaDivider />
        {/* The Uber request time when we have one; otherwise the day received. */}
        {offer.requested_at ? (
          <MetaCol value={clockLabel(offer.requested_at)} label={t("offer.requested")} />
        ) : (
          <MetaCol value={dayLabel(offer.received_at)} label={t("offer.date")} />
        )}
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

      {/* Multi-stop indicator — a compact line; full per-stop detail lives on the detail screen. */}
      {(offer.stops_count ?? 0) >= 2 && (
        <View style={{ flexDirection: rowDir(), alignItems: "center", gap: 6 }}>
          <Route size={13} color={c.pending} />
          <Text style={{ color: c.pending, fontSize: 12, fontWeight: "600", textAlign: start() }}>
            {t("offer.multiStop")} · {offer.stops_count} {t("offer.dropoffs")}
          </Text>
        </View>
      )}

      {/* 4 · Footer: rider (customer) + driver (owner mode) + countdown/received */}
      {(live || showDriver || offer.rider_name) && (
        <View style={{ flexDirection: rowDir(), alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: rowDir(), alignItems: "center", gap: 8, flexShrink: 1 }}>
            {offer.rider_name ? (
              <Text numberOfLines={1} style={{ color: c.inkMuted, fontSize: 12.5, fontWeight: "500" }}>
                {offer.rider_name} <Text style={{ color: c.inkSubtle }}>· {t("offer.rider")}</Text>
              </Text>
            ) : null}
            {showDriver && offer.driver_name ? (
              <Text numberOfLines={1} style={{ color: c.inkSubtle, fontSize: 12 }}>{offer.driver_name}</Text>
            ) : null}
          </View>
          {live && offer.accept_window_seconds != null && offer.received_at && (
            <CardCountdown receivedAt={offer.received_at} windowSeconds={offer.accept_window_seconds} />
          )}
        </View>
      )}
    </Pressable>
  );
}

/** Fields the card renders — a poll that returns the same values re-renders nothing. */
const RENDERED_FIELDS: (keyof Offer)[] = [
  "id",
  "status",
  "fare_amount",
  "fare_formatted",
  "distance_m",
  "received_at",
  "requested_at",
  "stops_count",
  "pickup_address",
  "dropoff_address",
  "rider_name",
  "driver_name",
  "accept_window_seconds",
];

export const OfferCard = memo(
  OfferCardImpl,
  (a, b) =>
    a.onOpen === b.onOpen &&
    a.showDriver === b.showDriver &&
    RENDERED_FIELDS.every((k) => a.offer[k] === b.offer[k]),
);

/** Live "Ns remaining" for a pending card: ticks once a second, hides at zero. */
function CardCountdown({ receivedAt, windowSeconds }: { receivedAt: string; windowSeconds: number }) {
  const c = useColors();
  const deadline = Date.parse(receivedAt) + windowSeconds * 1000;
  const [left, setLeft] = useState(() => Math.ceil((deadline - Date.now()) / 1000));

  useEffect(() => {
    if (!Number.isFinite(deadline)) return;
    const tick = () => setLeft(Math.ceil((deadline - Date.now()) / 1000));
    tick();
    if (deadline <= Date.now()) return;
    const id = setInterval(() => {
      tick();
      if (Date.now() >= deadline) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!Number.isFinite(left) || left <= 0) return null;
  return (
    <View style={{ flexDirection: rowDir(), alignItems: "center", gap: 6 }}>
      <Clock size={14} color={c.inkSubtle} />
      <Text style={{ color: c.inkMuted, fontSize: 12.5, fontWeight: "600", writingDirection: "ltr" }}>
        {left}
        {t("offer.secShort")}
      </Text>
      <Text style={{ color: c.inkSubtle, fontSize: 11 }}>{t("offer.remaining")}</Text>
    </View>
  );
}

function MetaCol({ value, label }: { value: string; label: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
      <Text numberOfLines={1} style={{ color: c.ink, fontSize: 12.5, fontWeight: "600" }}>
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
