import { View, Pressable } from "react-native";
import { BellOff, WifiOff } from "@/components/icons";
import { Text } from "@/components/typography";
import { useColors, radius } from "@/lib/theme";
import { t, isRTL } from "@/lib/i18n";
import { usePushHealth } from "@/lib/use-push-health";

/**
 * A thin warning strip with one action — used for "data may be stale / retry"
 * and "offer notifications are off".
 */
export function StatusBanner({
  kind,
  message,
  actionLabel,
  onAction,
}: {
  kind: "offline" | "push";
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const c = useColors();
  const Icon = kind === "offline" ? WifiOff : BellOff;
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: isRTL() ? "row-reverse" : "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderRadius: radius.md,
        backgroundColor: kind === "push" ? c.canceledBg : c.pendingBg,
        borderWidth: 1,
        borderColor: kind === "push" ? c.canceled : c.pending,
      }}
    >
      <Icon size={17} color={kind === "push" ? c.canceled : c.pending} />
      <Text style={{ flex: 1, color: c.ink, fontSize: 13, lineHeight: 18, textAlign: isRTL() ? "right" : "left" }}>
        {message}
      </Text>
      <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
        <Text style={{ color: c.ink, fontSize: 13, fontWeight: "700" }}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

/** Stays visible while offers cannot ring (permission denied / channel muted). */
export function PushHealthBanner() {
  const { ok, fix } = usePushHealth();
  if (ok) return null;
  return <StatusBanner kind="push" message={t("push.off")} actionLabel={t("push.fix")} onAction={() => void fix()} />;
}

/** "Could not refresh — data may be outdated" with a retry. */
export function LoadErrorBanner({ onRetry }: { onRetry: () => void }) {
  return <StatusBanner kind="offline" message={t("load.error")} actionLabel={t("load.retry")} onAction={onRetry} />;
}
