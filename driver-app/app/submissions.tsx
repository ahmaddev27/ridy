/**
 * Belege & Notizen — what this driver has sent their own company, and what the
 * company decided.
 *
 * A stack screen pushed from Profil, not a fifth tab: the four tabs are fixed
 * and every driver sees all of them, so a tab that appeared for some fleets and
 * not others would change the shape of the bar from driver to driver.
 *
 * ## Why the list exists at all, and not just the two forms
 *
 * A rejection the driver cannot see is a rejection they cannot act on. The push
 * notification is the first telling; this screen is where the reason still is
 * tomorrow, after the notification was swiped away.
 *
 * ## Nothing here enters anybody's books
 *
 * Everything a driver sends is a CLAIM waiting for a person at the company to
 * accept or reject it. The empty state and the status words say so plainly,
 * because a driver who believes a submitted receipt is already paid will not
 * chase it.
 */
import { useCallback, useState } from "react";
import { View, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, FileText, Package, Plus } from "@/components/icons";
import { Text } from "@/components/typography";
import { SectionLabel } from "@/components/ui";
import { api, type DriverSubmission } from "@/lib/api";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius, cardStyle, type Palette } from "@/lib/theme";

/**
 * How each state reads. `pending` and `taken` are the same thing from the
 * driver's side — whether El-Professor has fetched it yet is our plumbing, not
 * news — so both show as waiting.
 *
 * A rejection uses the offer lifecycle's `canceled` hue and not its `rejected`
 * one: `rejected` is the muted grey an expired offer gets, and a company
 * refusing a receipt is something the driver has to act on.
 */
function statusStyle(status: string, c: Palette): { fg: string; bg: string; label: string } {
  if (status === "accepted") return { fg: c.accepted, bg: c.completedBg, label: t("subs.status.accepted") };
  if (status === "rejected") return { fg: c.canceled, bg: c.canceledBg, label: t("subs.status.rejected") };
  return { fg: c.pending, bg: c.pendingBg, label: t("subs.status.pending") };
}

export default function SubmissionsScreen() {
  const c = useColors();
  const router = useRouter();
  const row = isRTL() ? "row-reverse" : "row";

  const [rows, setRows] = useState<DriverSubmission[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await api.submissions();
      setRows(r.data ?? []);
    } catch {
      // An empty list would read as "you have sent nothing", which is the one
      // thing a failed read must not say to someone who sent something.
      setFailed(true);
      setRows(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }} edges={["top"]}>
      <View style={{ flexDirection: row, alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          hitSlop={10}
        >
          <ChevronLeft size={24} color={c.ink} strokeWidth={1.8} style={isRTL() ? { transform: [{ scaleX: -1 }] } : undefined} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: "700", color: c.ink }}>{t("subs.title")}</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.ink} />}
      >
        {/* The two things a driver can send. Side by side, because a receipt
            and a note are different acts and neither is the default. */}
        <View style={{ flexDirection: row, gap: 12 }}>
          <NewButton
            c={c}
            icon={Package}
            label={t("subs.newReceipt")}
            onPress={() => router.push("/submission/receipt")}
          />
          <NewButton
            c={c}
            icon={FileText}
            label={t("subs.newNote")}
            onPress={() => router.push("/submission/note")}
          />
        </View>

        <SectionLabel>{t("subs.mine")}</SectionLabel>

        {rows === null && !failed && (
          <View style={{ paddingVertical: 32, alignItems: "center" }}>
            <ActivityIndicator color={c.ink} />
          </View>
        )}

        {failed && (
          <View style={{ ...cardStyle(c), gap: 6 }}>
            <Text style={{ color: c.danger, fontWeight: "700", fontSize: 14.5 }}>{t("subs.loadFailed")}</Text>
            <Text style={{ color: c.inkMuted, fontSize: 13.5 }}>{t("subs.loadFailedBody")}</Text>
          </View>
        )}

        {rows !== null && rows.length === 0 && (
          <View style={{ ...cardStyle(c), gap: 6 }}>
            <Text style={{ color: c.ink, fontWeight: "700", fontSize: 14.5 }}>{t("subs.empty")}</Text>
            <Text style={{ color: c.inkMuted, fontSize: 13.5 }}>{t("subs.emptyBody")}</Text>
          </View>
        )}

        {(rows ?? []).map((r) => (
          <View key={r.id} style={{ ...cardStyle(c), gap: 8 }}>
            <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <Text style={{ color: c.ink, fontWeight: "700", fontSize: 14.5 }}>
                {r.subject === "receipt" ? t("subs.kind.receipt") : t("subs.kind.note")}
              </Text>
              {(() => {
                const st = statusStyle(r.status, c);
                return (
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: radius.pill,
                      backgroundColor: st.bg,
                    }}
                  >
                    <Text style={{ color: st.fg, fontWeight: "700", fontSize: 12.5 }}>{st.label}</Text>
                  </View>
                );
              })()}
            </View>

            {r.created_at && (
              <Text style={{ color: c.inkMuted, fontSize: 12.5 }}>
                {new Date(r.created_at).toLocaleDateString()}
              </Text>
            )}

            {/* The company's own words. Without them a rejection is something
                the driver cannot do anything about. */}
            {r.status === "rejected" && r.reason ? (
              <View style={{ gap: 2 }}>
                <Text style={{ color: c.inkMuted, fontSize: 12.5 }}>{t("subs.reason")}</Text>
                <Text style={{ color: c.ink, fontSize: 13.5 }}>{r.reason}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function NewButton({
  c,
  icon: Icon,
  label,
  onPress,
}: {
  c: Palette;
  icon: typeof Package;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        ...cardStyle(c),
        flex: 1,
        alignItems: "center",
        gap: 8,
        paddingVertical: 18,
      }}
    >
      <Icon size={22} color={c.primary ?? c.ink} strokeWidth={1.8} />
      <Text style={{ color: c.ink, fontWeight: "700", fontSize: 13.5, textAlign: "center" }}>{label}</Text>
      <Plus size={14} color={c.inkMuted} strokeWidth={2} />
    </Pressable>
  );
}
