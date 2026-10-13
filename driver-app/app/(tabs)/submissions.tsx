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
 * So a driver can see what they have already sent. Nothing arrives to tell
 * them — there is no push and no decision — so without this screen a receipt
 * sent twice would be indistinguishable from one sent once.
 *
 * ## What a driver sends goes into the books
 *
 * And it goes in immediately: there is no decision to wait for, because since
 * 13.10.2026 a submission
 * is accepted on arrival (owner's decision), so this screen is a RECORD of
 * what the driver sent, not a queue. The empty state says so plainly,
 * because a driver who believes a submitted receipt is already paid will not
 * chase it.
 */
import { useCallback, useMemo, useState } from "react";
import { View, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, FileText, Package, Plus } from "@/components/icons";
import { Text } from "@/components/typography";
import { SectionLabel } from "@/components/ui";
import { api, type DriverSubmission } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, isRTL, intlLocale } from "@/lib/i18n";
import { groupSubmissions, shortDay } from "@/lib/submission-groups";
import { useColors, radius, cardStyle, type Palette } from "@/lib/theme";

/**
 * One collapsible week.
 *
 * The newest week opens by default and the rest stay shut: a driver who sends
 * a few things a day would otherwise land on a wall of rows, which is the
 * complaint this grouping answers.
 */
function WeekBlock({
  c,
  row,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  c: Palette;
  row: "row" | "row-reverse";
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 10 }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{
          ...cardStyle(c),
          padding: 14,
          flexDirection: row,
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <View style={{ flexDirection: row, alignItems: "center", gap: 8, flexShrink: 1 }}>
          {/* The chevron turns, so the control says which way it goes without
              a second label. Mirrored in Arabic like every other chevron here. */}
          <ChevronLeft
            size={18}
            color={c.inkMuted}
            strokeWidth={2}
            style={{ transform: [{ rotate: open ? "-90deg" : isRTL() ? "0deg" : "180deg" }] }}
          />
          <Text style={{ color: c.ink, fontWeight: "700", fontSize: 14.5 }} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View
          style={{
            paddingHorizontal: 9,
            paddingVertical: 3,
            borderRadius: radius.pill,
            backgroundColor: c.surface2,
          }}
        >
          <Text style={{ color: c.inkMuted, fontWeight: "700", fontSize: 12.5 }}>{count}</Text>
        </View>
      </Pressable>
      {open && <View style={{ gap: 10, paddingHorizontal: 4 }}>{children}</View>}
    </View>
  );
}

export default function SubmissionsScreen() {
  const c = useColors();
  const router = useRouter();
  const row = isRTL() ? "row-reverse" : "row";
  // The company's connection, not the driver's. Hiding the Profil row is the
  // message; this is what a deep link, a stale screen or a company that revoked
  // its token after the app loaded runs into. The endpoint refuses them too.
  const { driver } = useAuth();
  const connected = driver?.documents_enabled === true;

  const [rows, setRows] = useState<DriverSubmission[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // The weeks a driver has opened. The newest one is open without being in
  // here, so the screen is useful before anything is tapped and a driver who
  // closes it stays closed.
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set());

  // Re-grouped only when the rows change: the month and week arithmetic walks
  // every row, and this screen re-renders on every pull-to-refresh frame.
  const months = useMemo(() => groupSubmissions(rows ?? []), [rows]);
  const newestWeekKey = months[0]?.weeks[0] !== undefined
    ? `${months[0].monthKey}/${months[0].weeks[0].mondayIso}`
    : null;

  const monthLabel = (year: number, month: number) =>
    new Intl.DateTimeFormat(intlLocale(), { month: "long", year: "numeric" })
      .format(new Date(year, month - 1, 1));

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
        {!connected && (
          <View style={{ ...cardStyle(c), padding: 16, gap: 6 }}>
            <Text style={{ color: c.ink, fontWeight: "700", fontSize: 14.5 }}>{t("subs.notConnected")}</Text>
            <Text style={{ color: c.inkMuted, fontSize: 13.5 }}>{t("subs.notConnectedBody")}</Text>
          </View>
        )}

        {/* The two things a driver can send. Side by side, because a receipt
            and a note are different acts and neither is the default. */}
        {connected && (
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
        )}

        <SectionLabel>{t("subs.mine")}</SectionLabel>

        {rows === null && !failed && (
          <View style={{ paddingVertical: 32, alignItems: "center" }}>
            <ActivityIndicator color={c.ink} />
          </View>
        )}

        {failed && (
          <View style={{ ...cardStyle(c), padding: 16, gap: 6 }}>
            <Text style={{ color: c.danger, fontWeight: "700", fontSize: 14.5 }}>{t("subs.loadFailed")}</Text>
            <Text style={{ color: c.inkMuted, fontSize: 13.5 }}>{t("subs.loadFailedBody")}</Text>
          </View>
        )}

        {rows !== null && rows.length === 0 && (
          <View style={{ ...cardStyle(c), padding: 16, gap: 6 }}>
            <Text style={{ color: c.ink, fontWeight: "700", fontSize: 14.5 }}>{t("subs.empty")}</Text>
            <Text style={{ color: c.inkMuted, fontSize: 13.5 }}>{t("subs.emptyBody")}</Text>
          </View>
        )}

        {months.map((group) => (
          <View key={group.monthKey || "undated"} style={{ gap: 10 }}>
            {/* The month, in the reader's own language. `intlLocale()` keeps
                Latin digits in Arabic, which is this product's rule for every
                date, amount and distance. */}
            <SectionLabel>
              {group.monthKey === "" ? t("subs.undated") : monthLabel(group.year, group.month)}
            </SectionLabel>

            {group.weeks.map((week) => {
              const key = `${group.monthKey}/${week.mondayIso}`;
              const isNewest = key === newestWeekKey;
              const open = isNewest ? !closed.has(key) : opened.has(key);
              const title = week.weekNo === 0
                ? t("subs.undated")
                : `${t("subs.week", { n: String(week.weekNo) })} · ${shortDay(week.mondayIso)}–${shortDay(week.sundayIso)}`;
              return (
                <WeekBlock
                  key={key}
                  c={c}
                  row={row}
                  title={title}
                  count={week.items.length}
                  open={open}
                  onToggle={() => {
                    // Two sets rather than one, because "open" means the
                    // opposite thing for the newest week: one set would make
                    // the first tap on it do nothing.
                    if (isNewest) {
                      setClosed((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    } else {
                      setOpened((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    }
                  }}
                >
                  {week.items.map((r) => (
                    <View key={r.id} style={{ ...cardStyle(c), padding: 14, gap: 6 }}>
                      <View style={{ flexDirection: row, alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <Text style={{ color: c.ink, fontWeight: "700", fontSize: 14.5 }}>
                          {r.subject === "receipt" ? t("subs.kind.receipt") : t("subs.kind.note")}
                        </Text>
                        {r.created_at && (
                          <Text style={{ color: c.inkMuted, fontSize: 12.5 }}>
                            {new Date(r.created_at).toLocaleDateString(intlLocale())}
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
                </WeekBlock>
              );
            })}
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
        paddingHorizontal: 12,
      }}
    >
      <Icon size={22} color={c.primary ?? c.ink} strokeWidth={1.8} />
      <Text style={{ color: c.ink, fontWeight: "700", fontSize: 13.5, textAlign: "center" }}>{label}</Text>
      <Plus size={14} color={c.inkMuted} strokeWidth={2} />
    </Pressable>
  );
}
