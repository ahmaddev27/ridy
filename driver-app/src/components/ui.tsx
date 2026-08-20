import {
  ActivityIndicator,
  Pressable,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { useState } from "react";
import { Eye, EyeOff, type LucideIcon } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";
import { Text, TextInput } from "@/components/typography";
import { useColors, radius, statusColors, cardStyle, isDarkPalette, type Palette } from "@/lib/theme";
import { isRTL } from "@/lib/i18n";

const align = () => (isRTL() ? "right" : "left") as "right" | "left";

// The Reidey "R" monogram as a vector letterform (viewBox 963×1024), ported from
// the dashboard brand SVG. Rendered as a clean ink glyph on transparency — no
// background box — so it matches the sign-in design on light and dark.
const LOGO_PATH =
  "M 442.516 272.659 C 408.147 280.023, 379.651 306.851, 369.715 341.198 C 367.675 348.251, 367.591 350.811, 367.262 416.188 L 366.921 483.875 327.220 507.688 C 305.385 520.784, 284.063 534.094, 279.839 537.265 C 262.873 549.999, 251.072 567.572, 245.375 588.584 C 243.676 594.849, 243.500 599.592, 243.500 639 C 243.500 681.733, 243.541 682.632, 245.829 690 C 251.157 707.159, 262.062 722.661, 276.685 733.860 C 282.152 738.047, 297.774 745.380, 306 747.621 C 316.032 750.354, 335.142 750.105, 345.500 747.106 C 376.917 738.011, 399.457 713.543, 405.431 682.050 C 406.778 674.952, 407 661.972, 407 590.503 L 407 507.227 427.750 494.986 C 439.163 488.253, 454.350 479.264, 461.500 475.009 C 468.650 470.754, 480.516 463.799, 487.869 459.553 L 501.239 451.834 507.369 454.667 C 512.894 457.220, 514.537 457.496, 524 457.463 C 533.422 457.431, 535.095 457.139, 540.294 454.620 C 549.156 450.327, 557.301 442.193, 561.747 433.197 C 565.292 426.024, 565.500 425.075, 565.500 416.052 C 565.500 407.354, 565.210 405.888, 562.257 399.653 C 558.343 391.389, 549.622 382.417, 541.849 378.657 C 525.583 370.789, 506.619 374.118, 493.872 387.079 C 487.354 393.707, 483.561 400.847, 481.731 409.935 L 480.436 416.371 473.968 420.327 C 467.714 424.152, 445.960 437.015, 421.813 451.165 C 415.386 454.932, 409.423 458.284, 408.563 458.614 C 407.159 459.153, 407.001 454.348, 407.008 411.357 C 407.012 384.185, 407.451 360.691, 408.024 357 C 409.313 348.694, 415.569 335.808, 421.534 329.173 C 427.690 322.326, 436.776 316.445, 445.380 313.739 C 452.423 311.524, 453.135 311.500, 511.500 311.536 C 569.413 311.571, 570.647 311.613, 578.500 313.802 C 612.276 323.216, 640.188 351.387, 649.540 385.500 C 661.913 430.635, 646.165 475.971, 609 502.201 C 590.737 515.091, 570.980 521.767, 538.445 526.041 C 529.583 527.205, 529.282 527.176, 524.373 524.689 C 511.267 518.048, 493.905 517.152, 482.500 522.528 C 474.739 526.186, 465.286 535.595, 461.428 543.500 C 458.732 549.025, 458.500 550.370, 458.500 560.500 C 458.500 570.744, 458.713 571.946, 461.606 578 C 465.161 585.437, 471.932 592.556, 479.226 596.527 C 484.432 599.360, 492.741 601.935, 497 602.035 C 499.019 602.082, 500.848 604.051, 506.500 612.260 C 514.464 623.826, 571.286 703.442, 579.348 714.329 C 596.196 737.083, 618.845 749.045, 645.500 749.268 C 661.979 749.406, 676.182 744.768, 689.230 734.989 C 700.643 726.434, 711.045 710.238, 714.609 695.472 C 716.856 686.163, 716.850 670.692, 714.597 660.500 C 712.201 649.666, 704.730 634.304, 696.819 623.947 C 691.571 617.076, 690.143 614.420, 689.560 610.447 C 687.969 599.602, 680.955 589.948, 671.807 586.013 C 665.442 583.274, 654.728 583.502, 648.533 586.509 C 631.181 594.930, 627.241 618.273, 640.799 632.339 C 642.835 634.451, 648.021 637.961, 652.325 640.138 C 662.049 645.059, 668.213 651.118, 672.326 659.799 C 675.233 665.937, 675.500 667.341, 675.500 676.500 C 675.500 687.549, 673.720 692.833, 667.679 699.713 C 657.821 710.940, 637.543 711.967, 622.151 702.019 C 615.057 697.434, 613.167 695.121, 593.947 667.500 C 585.528 655.400, 575.656 641.225, 572.010 636 C 568.364 630.775, 558.727 616.899, 550.593 605.164 L 535.806 583.829 536.961 579.164 C 538.332 573.630, 542.205 567.369, 544.712 566.636 C 545.695 566.348, 552.350 565.144, 559.500 563.961 C 582.373 560.175, 605.056 552.184, 622.230 541.862 C 671.329 512.352, 699.491 458.747, 694.918 403.500 C 693.215 382.912, 688.265 366.034, 678.228 346.585 C 665.287 321.509, 638.652 295.674, 613.671 283.967 C 602.420 278.695, 589.236 274.400, 578.615 272.548 C 565.781 270.310, 453.051 270.402, 442.516 272.659 M 334.500 550.759 C 300.127 571.405, 294.882 575.619, 289.364 587.020 C 283.819 598.478, 283.506 601.249, 283.503 639 C 283.500 678.094, 283.768 679.932, 291.079 690.880 C 299.033 702.792, 313.139 709.743, 327.343 708.751 C 337.809 708.020, 344.941 704.922, 352.556 697.799 C 360.331 690.526, 364.560 682.535, 365.943 672.500 C 367.064 664.369, 367.341 531.966, 366.237 532.069 C 365.832 532.107, 351.550 540.517, 334.500 550.759 M 514.923 409.923 C 512.759 412.087, 512 413.795, 512 416.500 C 512 421.581, 516.419 426, 521.500 426 C 526.581 426, 531 421.581, 531 416.500 C 531 411.419, 526.581 407, 521.500 407 C 518.795 407, 517.087 407.759, 514.923 409.923";

/** Theme-aware Reidey brand monogram. */
export function Logo({ size = 40, color }: { size?: number; color?: string }) {
  const c = useColors();
  return (
    <Svg width={size} height={size * (1024 / 963)} viewBox="0 0 963 1024">
      <Path d={LOGO_PATH} fill={color ?? c.ink} fillRule="evenodd" />
    </Svg>
  );
}

/**
 * Full-width primary action — the design's solid button (near-white on dark,
 * near-black on light), 12px radius. Pass `style` to flex it inside an action
 * row next to a SecondaryButton.
 */
export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  style?: ViewStyle;
}) {
  const c = useColors();
  const off = disabled || loading;
  const Icon = icon;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={[
        {
          flexDirection: isRTL() ? "row-reverse" : "row",
          gap: 8,
          backgroundColor: c.primary,
          borderRadius: radius.control,
          paddingVertical: 14,
          alignItems: "center",
          justifyContent: "center",
          opacity: off ? 0.45 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.primaryInk} />
      ) : (
        <>
          {Icon && <Icon size={17} color={c.primaryInk} />}
          <Text style={{ color: c.primaryInk, fontWeight: "700", fontSize: 15 }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/** Small monochrome badge shown on offer cards (TOP OFFER / VERIFIED / NEW / EXPIRING). */
export function Badge({ variant, label }: { variant: "top" | "verified" | "new" | "expiring"; label: string }) {
  const c = useColors();
  // Expiring is the one tinted badge; the rest are pure monochrome.
  const styles =
    variant === "expiring"
      ? { bg: c.canceledBg, border: isDarkPalette(c) ? "#3d2a2a" : "#f0d4d3", text: isDarkPalette(c) ? "#d98c88" : c.danger }
      : variant === "new"
        ? { bg: c.surfaceRaised, border: c.borderStrong, text: c.ink }
        : { bg: c.surfaceRaised, border: c.line, text: c.inkMuted };
  return (
    <View
      style={{
        alignSelf: isRTL() ? "flex-end" : "flex-start",
        backgroundColor: styles.bg,
        borderWidth: 1,
        borderColor: styles.border,
        borderRadius: radius.xs,
        paddingHorizontal: 8,
        paddingVertical: 3,
      }}
    >
      <Text style={{ color: styles.text, fontSize: 9.5, fontWeight: "700", letterSpacing: 0.8 }}>
        {label.toUpperCase()}
      </Text>
    </View>
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
        paddingVertical: 10,
        flexDirection: isRTL() ? "row-reverse" : "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.inkSubtle, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.8, textAlign: align() }}>
          {label.toUpperCase()}
        </Text>
        <TextInput
          placeholderTextColor={c.inkSubtle}
          secureTextEntry={hidden}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
          style={{ color: c.ink, fontSize: 15, paddingVertical: 1, textAlign: align(), writingDirection: isRTL() ? "rtl" : "ltr" }}
        />
      </View>
      {secure && (
        <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
          {hidden ? <Eye size={20} color={c.inkSubtle} /> : <EyeOff size={20} color={c.inkSubtle} />}
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
    <View style={{ backgroundColor: tone.bg, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 4, alignSelf: isRTL() ? "flex-end" : "flex-start" }}>
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

/** Borderless soft-shadowed card — the single card look shared across the app. */
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[cardStyle(c), style]}>{children}</View>;
}

/** Compact secondary action — outlined pill/rounded button with an optional leading icon. */
export function SecondaryButton({
  label,
  icon,
  onPress,
  style,
}: {
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
  style?: ViewStyle;
}) {
  const c = useColors();
  const Icon = icon;
  // On dark the secondary sits on the raised surface with a muted label; on light
  // it's an outlined white control. Monochrome in both.
  const d = isDarkPalette(c);
  return (
    <Pressable
      onPress={onPress}
      style={[
        {
          flexDirection: isRTL() ? "row-reverse" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          backgroundColor: d ? c.surfaceRaised : c.surface,
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: radius.control,
          paddingVertical: 13,
          paddingHorizontal: 16,
        },
        style,
      ]}
    >
      {Icon && <Icon size={16} color={c.inkMuted} />}
      <Text style={{ color: c.inkMuted, fontSize: 14, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

/** A labelled metric (uppercase label + big value), used in the 2×2 grids. */
export function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 4 }}>
      <SectionLabel>{label}</SectionLabel>
      <Text style={{ color: c.ink, fontSize: 23, fontWeight: "700", textAlign: align() }}>
        {value}
        {unit ? <Text style={{ fontSize: 14, fontWeight: "700", color: c.inkMuted }}> {unit}</Text> : null}
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
          <Text style={{ color: c.ink, fontSize: 16, textAlign: align() }}>{pickup}</Text>
        </View>
        <View>
          {dropoffLabel && <SectionLabel>{dropoffLabel}</SectionLabel>}
          <Text style={{ color: c.ink, fontSize: 16, textAlign: align() }}>{dropoff}</Text>
        </View>
      </View>
    </View>
  );
}

export { align, type Palette };
