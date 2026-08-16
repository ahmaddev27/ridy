import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, statusColors, type Palette } from "@/lib/theme";
import { isRTL } from "@/lib/i18n";

const align = () => (isRTL() ? "right" : "left") as "right" | "left";

// The brand mark is a white silhouette on transparency — tinted to the ink color
// so it reads on both light and dark backgrounds.
const LOGO = require("../../assets/notification-icon.png");

/** Theme-aware Reidey brand mark. */
export function Logo({ size = 28, color }: { size?: number; color?: string }) {
  const c = useColors();
  return <Image source={LOGO} style={{ width: size, height: size, tintColor: color ?? c.ink }} resizeMode="contain" />;
}

/** Full-width primary action — dark pill button (near-black on light, near-white on dark). */
export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const c = useColors();
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={{
        backgroundColor: c.primary,
        borderRadius: radius.xl,
        paddingVertical: 18,
        alignItems: "center",
        opacity: off ? 0.45 : 1,
      }}
    >
      {loading ? (
        <ActivityIndicator color={c.primaryInk} />
      ) : (
        <Text style={{ color: c.primaryInk, fontWeight: "700", fontSize: 17 }}>{label}</Text>
      )}
    </Pressable>
  );
}

/** White field with a floating uppercase label above the value (matches the sign-in design). */
export function Field({
  label,
  secure,
  ...props
}: { label: string; secure?: boolean } & TextInputProps) {
  const c = useColors();
  const [hidden, setHidden] = useState(!!secure);
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: focused ? c.ink : c.line,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.inkSubtle, fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textAlign: align() }}>
          {label.toUpperCase()}
        </Text>
        <TextInput
          placeholderTextColor={c.inkSubtle}
          secureTextEntry={hidden}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
          style={{ color: c.ink, fontSize: 17, paddingVertical: 2, textAlign: align() }}
        />
      </View>
      {secure && (
        <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
          <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={20} color={c.inkSubtle} />
        </Pressable>
      )}
    </View>
  );
}

/** Colored soft pill for an offer status. */
export function StatusBadge({ status, label }: { status: string; label: string }) {
  const c = useColors();
  const tone = statusColors(c, status);
  return (
    <View style={{ backgroundColor: tone.bg, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 4, alignSelf: "flex-start" }}>
      <Text style={{ color: tone.fg, fontSize: 12.5, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

/** € / €€ / €€€ quality mark — green when good, muted otherwise. */
export function QualityMark({ mark, good, size = 14 }: { mark: string; good: boolean; size?: number }) {
  const c = useColors();
  return <Text style={{ color: good ? c.accent : c.inkSubtle, fontSize: size, fontWeight: "700" }}>{mark}</Text>;
}

/** Uppercase muted section label. */
export function SectionLabel({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return (
    <Text
      style={[{ color: c.inkSubtle, fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textAlign: align() }, style]}
    >
      {typeof children === "string" ? children.toUpperCase() : children}
    </Text>
  );
}

/** Card container. */
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return (
    <View
      style={[
        { backgroundColor: c.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: c.line },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A labelled metric (uppercase label + big value), used in the 2×2 grids. */
export function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 4 }}>
      <SectionLabel>{label}</SectionLabel>
      <Text style={{ color: c.ink, fontSize: 26, fontWeight: "800", textAlign: align() }}>
        {value}
        {unit ? <Text style={{ fontSize: 15, fontWeight: "700", color: c.inkMuted }}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

/** Route block: hollow-circle pickup → dotted line → green-square dropoff. */
export function RouteBlock({
  pickup,
  dropoff,
  pickupLabel,
  dropoffLabel,
}: {
  pickup: string;
  dropoff: string;
  pickupLabel?: string;
  dropoffLabel?: string;
}) {
  const c = useColors();
  return (
    <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", gap: 14 }}>
      {/* rail */}
      <View style={{ alignItems: "center", paddingTop: pickupLabel ? 5 : 4 }}>
        <View style={{ width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: c.inkMuted }} />
        <View style={{ flex: 1, width: 2, marginVertical: 3, backgroundColor: "transparent", borderLeftWidth: 2, borderStyle: "dotted", borderColor: c.inkSubtle }} />
        <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: c.accent }} />
      </View>
      <View style={{ flex: 1, gap: pickupLabel ? 14 : 12 }}>
        <View>
          {pickupLabel && <SectionLabel>{pickupLabel}</SectionLabel>}
          <Text style={{ color: c.ink, fontSize: 17, textAlign: align() }}>{pickup}</Text>
        </View>
        <View>
          {dropoffLabel && <SectionLabel>{dropoffLabel}</SectionLabel>}
          <Text style={{ color: c.ink, fontSize: 17, textAlign: align() }}>{dropoff}</Text>
        </View>
      </View>
    </View>
  );
}

export { align, type Palette };
