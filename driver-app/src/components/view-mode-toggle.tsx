import { View, Pressable } from "react-native";
import { Text } from "@/components/typography";
import { useAuth, type ViewMode } from "@/lib/auth";
import { t, isRTL, useLocale } from "@/lib/i18n";
import { useColors, radius } from "@/lib/theme";

const MODES: ViewMode[] = ["admin", "driver"];

/**
 * Admin / Driver switch for a linked owner-driver. A UI mode only — the server
 * re-checks the admin grant on every request. Renders nothing for anyone else.
 */
export function ViewModeToggle({ compact = false }: { compact?: boolean }) {
  const c = useColors();
  const { canAdmin, viewMode, setViewMode } = useAuth();
  useLocale();
  if (!canAdmin) return null;

  return (
    <View style={{ gap: 6 }}>
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: isRTL() ? "row-reverse" : "row",
          backgroundColor: c.surface2,
          borderRadius: radius.control,
          padding: compact ? 2 : 3,
          alignSelf: compact ? "flex-start" : "stretch",
        }}
      >
        {MODES.map((mode) => {
          const active = viewMode === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => setViewMode(mode)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={{
                flex: compact ? undefined : 1,
                paddingVertical: compact ? 4 : 9,
                paddingHorizontal: compact ? 12 : 8,
                borderRadius: radius.control,
                alignItems: "center",
                backgroundColor: active ? c.ink : "transparent",
              }}
            >
              <Text style={{ color: active ? c.canvas : c.inkMuted, fontSize: compact ? 12 : 14, fontWeight: "700" }}>
                {t(`view.${mode}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {!compact && <Text style={{ color: c.inkSubtle, fontSize: 12 }}>{t("view.hint")}</Text>}
    </View>
  );
}
