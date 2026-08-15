import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { useColors, radius } from "@/lib/theme";
import { isRTL } from "@/lib/i18n";

/** A compact metric tile used on Home + Profile stats. */
export function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const c = useColors();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: "30%",
        minWidth: 100,
        backgroundColor: c.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: c.line,
        paddingVertical: 14,
        paddingHorizontal: 14,
        gap: 4,
      }}
    >
      <Text style={{ color: tone ?? c.ink, fontSize: 22, fontWeight: "800", textAlign: isRTL() ? "right" : "left" }}>
        {value}
      </Text>
      <Text style={{ color: c.inkSubtle, fontSize: 12, textAlign: isRTL() ? "right" : "left" }}>{label}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const c = useColors();
  return (
    <Text style={{ color: c.ink, fontSize: 15, fontWeight: "700", textAlign: isRTL() ? "right" : "left" }}>
      {children}
    </Text>
  );
}

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
        borderRadius: radius.md,
        paddingVertical: 15,
        alignItems: "center",
        opacity: off ? 0.5 : 1,
      }}
    >
      {loading ? (
        <ActivityIndicator color={c.primaryInk} />
      ) : (
        <Text style={{ color: c.primaryInk, fontWeight: "700", fontSize: 16 }}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.inkMuted, fontSize: 13, textAlign: isRTL() ? "right" : "left" }}>{label}</Text>
      <TextInput
        placeholderTextColor={c.inkSubtle}
        {...props}
        style={{
          backgroundColor: c.surface2,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: c.line,
          color: c.ink,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 16,
          textAlign: isRTL() ? "right" : "left",
        }}
      />
    </View>
  );
}

/** Status badge tones resolved against the active palette. */
export function StatusBadge({ status, label }: { status: string; label: string }) {
  const c = useColors();
  const tones: Record<string, { bg: string; fg: string }> = {
    pending: { bg: c.surface2, fg: c.warning },
    accepted: { bg: c.surface2, fg: "#38bdf8" },
    started: { bg: c.surface2, fg: "#a78bfa" },
    completed: { bg: c.successBg, fg: c.success },
    rejected: { bg: c.surface2, fg: c.inkSubtle },
    canceled: { bg: c.surface2, fg: c.danger },
  };
  const tone = tones[status] ?? tones.rejected;
  return (
    <View style={{ backgroundColor: tone.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" }}>
      <Text style={{ color: tone.fg, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}
