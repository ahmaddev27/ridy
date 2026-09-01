import { useState } from "react";
import { View, Pressable, Modal } from "react-native";
import { Text } from "@/components/typography";
import { ChevronLeft, ChevronRight, ChevronDown, Check } from "lucide-react-native";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius, cardStyle } from "@/lib/theme";
import { fleetNow } from "@/lib/fleet-day";

/**
 * The Uber-style date-range navigator shared by Statistics and Offers:
 *   ‹  [ 24 Aug – 31 Aug  ⌄ ]  ›
 * The centre pill opens the range-type picker (today / week / month); the arrows
 * step the period (weeks Monday-to-Monday, months by the 1st) and never page into
 * the future. All windows are fleet-days (the Uber day starts at 04:00).
 */

type Colors = ReturnType<typeof useColors>;

export type PeriodRange = "today" | "week" | "month";
export const PERIOD_RANGES: PeriodRange[] = ["today", "week", "month"];

const DAY_LOCALE = "en-DE";
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;

/** Local yyyy-mm-dd (the date-range the stats/offers endpoints expect). */
export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(d.getDate() + n);
  return x;
};

/** Monday (00:00) of the fleet-week containing `d`. */
export function mondayOf(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(d.getDate() - mondayIndex(m));
  return m;
}

/**
 * The first fleet-day of a period, `offset` periods away from now: 0 = current,
 * -1 = previous, +1 = next. Days step by one, weeks Monday-to-Monday, months by the 1st.
 */
export function startOfPeriod(r: PeriodRange, offset: number): Date {
  const now = fleetNow();
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (r === "today") d.setDate(now.getDate() + offset);
  else if (r === "week") d.setDate(now.getDate() - mondayIndex(now) + offset * 7);
  else d.setMonth(now.getMonth() + offset, 1);
  return d;
}

/** The last fleet-day of the period that starts at `start`. */
export function endOfPeriod(r: PeriodRange, start: Date): Date {
  if (r === "today") return start;
  if (r === "week") return addDays(start, 6);
  const e = new Date(start);
  e.setMonth(start.getMonth() + 1, 0); // day 0 of next month = last of this
  return e;
}

/** Human label: "Mon, 25 Aug" · "24 Aug – 31 Aug" · "August 2026". */
export function periodLabel(r: PeriodRange, start: Date, end: Date): string {
  const dm = (d: Date) => d.toLocaleDateString(DAY_LOCALE, { day: "numeric", month: "short" });
  if (r === "today") return start.toLocaleDateString(DAY_LOCALE, { weekday: "short", day: "numeric", month: "short" });
  if (r === "week") return `${dm(start)} – ${dm(end)}`;
  return start.toLocaleDateString(DAY_LOCALE, { month: "long", year: "numeric" });
}

/** from/to (fleet-day yyyy-mm-dd) + label + the containing week's Monday, for a range+offset. */
export function periodWindow(range: PeriodRange, offset: number): { from: string; to: string; label: string; weekMonday: Date } {
  const now = fleetNow();
  const start = startOfPeriod(range, offset);
  const end = endOfPeriod(range, start);
  const to = end > now ? now : end; // never query into the future
  return { from: ymd(start), to: ymd(to), label: periodLabel(range, start, end), weekMonday: mondayOf(start) };
}

export function PeriodNavigator({
  label,
  range,
  onRange,
  onPrev,
  onNext,
  canNext,
}: {
  label: string;
  range: PeriodRange;
  onRange: (r: PeriodRange) => void;
  onPrev: () => void;
  onNext: () => void;
  canNext: boolean;
}) {
  const c = useColors();
  const [menu, setMenu] = useState(false);
  const rtl = isRTL();
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  const arrow = (Icon: typeof ChevronLeft, onPress: () => void, on: boolean) => (
    <Pressable
      onPress={on ? onPress : undefined}
      disabled={!on}
      hitSlop={10}
      style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", opacity: on ? 1 : 0.3 }}
    >
      <Icon size={22} color={c.ink} />
    </Pressable>
  );

  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }}>
      {arrow(Prev, onPrev, true)}

      {/* The centre pill — tap to open the range picker (⌄). */}
      <Pressable
        onPress={() => setMenu(true)}
        hitSlop={8}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}
      >
        <Text style={{ color: c.ink, fontSize: 15.5, fontWeight: "700", writingDirection: "ltr" }}>{label}</Text>
        <ChevronDown size={16} color={c.inkMuted} />
      </Pressable>

      {arrow(Next, onNext, canNext)}

      {/* Range-type picker (today / week / month). */}
      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable onPress={() => setMenu(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 32 }}>
          <View style={{ ...cardStyle(c), padding: 6, gap: 2 }}>
            {PERIOD_RANGES.map((r) => {
              const on = r === range;
              return (
                <Pressable
                  key={r}
                  onPress={() => { onRange(r); setMenu(false); }}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 13, borderRadius: radius.md, backgroundColor: on ? c.primary : "transparent" }}
                >
                  <Text style={{ color: on ? c.primaryInk : c.ink, fontSize: 15, fontWeight: "700" }}>{t(`range.${r}`)}</Text>
                  {on && <Check size={18} color={c.primaryInk} />}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
