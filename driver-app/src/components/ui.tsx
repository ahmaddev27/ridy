import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, radius } from "@/lib/theme";

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
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={{
        backgroundColor: colors.primary,
        borderRadius: radius.md,
        paddingVertical: 14,
        alignItems: "center",
        opacity: off ? 0.5 : 1,
      }}
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryInk} />
      ) : (
        <Text style={{ color: colors.primaryInk, fontWeight: "700", fontSize: 16 }}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.inkMuted, fontSize: 13 }}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.inkSubtle}
        {...props}
        style={{
          backgroundColor: colors.surface2,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.line,
          color: colors.ink,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 16,
        }}
      />
    </View>
  );
}

const TONES: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "#2a2410", fg: colors.warning },
  accepted: { bg: "#0e1f2a", fg: "#38bdf8" },
  started: { bg: "#1e1533", fg: "#a78bfa" },
  completed: { bg: colors.successBg, fg: colors.success },
  rejected: { bg: colors.surface2, fg: colors.inkSubtle },
  canceled: { bg: "#2a1214", fg: colors.danger },
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone = TONES[status] ?? TONES.rejected;
  return (
    <View style={{ backgroundColor: tone.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" }}>
      <Text style={{ color: tone.fg, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}
