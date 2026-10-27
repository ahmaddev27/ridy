import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius, cardStyle, type Palette } from "@/lib/theme";
import { pad, toDateValue, fromDateValue, monthGrid, toTimeValue, fromTimeValue, splitNames } from "@/lib/calendar";

/**
 * Date and time pickers, written in plain React Native.
 *
 * ## Why not `@react-native-community/datetimepicker`
 *
 * It is a NATIVE module, so adopting it would move the Expo runtime
 * fingerprint — and that ends OTA for this app until a new build clears both
 * stores. The owner's instruction was "if all of it can ship as an OTA update,
 * do it that way", and a date field is not worth an App Store review cycle (the
 * 1.1.0 submission was already rejected once). Everything here is JS.
 *
 * ## The two rules this file must not break
 *
 * - **Week starts Monday.** Fleet weeks do, everywhere else in this product.
 * - **Latin digits, always, including Arabic.** Every number here is built with
 *   `pad()` / `String(n)`, never through a locale-aware formatter: `Intl` would
 *   render Arabic-Indic digits under an `ar` locale, and a driver reading ٠٨:٣٠
 *   on a German timesheet is exactly what the rule exists to prevent. Month and
 *   weekday NAMES are translated (they are words); the numbers are not.
 */

/** Names out of one dictionary key, so a language is one line not twelve. */
function names(key: string, expected: number): string[] {
  return splitNames(t(key), expected);
}

/** Monday-first weekday labels; the English set if a translation is miscounted. */
function weekdays(): string[] {
  const list = names("cal.weekdays", 7);
  return list.length === 7 ? list : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
}

function monthName(month: number): string {
  const list = names("cal.months", 12);
  return list[month] ?? String(month + 1);
}

/** A tappable value that opens a picker — the read-only twin of `Field`. */
function PickerField({
  c,
  label,
  display,
  placeholder,
  onPress,
}: {
  c: Palette;
  label: string;
  display: string;
  placeholder: string;
  onPress: () => void;
}) {
  const filled = display !== "";
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.inkSubtle, fontSize: 12.5, fontWeight: "600", textAlign: isRTL() ? "right" : "left" }}>
        {label}
      </Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${filled ? display : placeholder}`}
        style={{ ...cardStyle(c), paddingHorizontal: 14, paddingVertical: 13 }}
      >
        <Text style={{ color: filled ? c.ink : c.inkFaint, fontSize: 15, textAlign: isRTL() ? "right" : "left" }}>
          {filled ? display : placeholder}
        </Text>
      </Pressable>
    </View>
  );
}

function Sheet({ c, title, onClose, children }: { c: Palette; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {/* Tapping outside closes: this is a choice, not a decision to defend. */}
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 }}>
        <Pressable onPress={() => {}} style={{ ...cardStyle(c), padding: 16, gap: 12 }}>
          <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: c.ink, fontSize: 16, fontWeight: "700" }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("cal.close")}>
              <Text style={{ color: c.inkMuted, fontSize: 15, fontWeight: "600" }}>{t("cal.close")}</Text>
            </Pressable>
          </View>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Date field + month calendar. `value` and `onChange` speak `YYYY-MM-DD`. */
export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => fromDateValue(value), [value]);
  const [cursor, setCursor] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));

  const today = new Date();
  const cells = monthGrid(cursor.getFullYear(), cursor.getMonth());
  const isSame = (d: number, other: Date) =>
    other.getFullYear() === cursor.getFullYear() && other.getMonth() === cursor.getMonth() && other.getDate() === d;

  const step = (by: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + by, 1));

  return (
    <>
      <PickerField
        c={c}
        label={label}
        display={value.trim() === "" ? "" : `${pad(selected.getDate())}.${pad(selected.getMonth() + 1)}.${selected.getFullYear()}`}
        placeholder=""
        onPress={() => {
          setCursor(new Date(selected.getFullYear(), selected.getMonth(), 1));
          setOpen(true);
        }}
      />

      {open && (
        <Sheet c={c} title={label} onClose={() => setOpen(false)}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            {/* Arrows are NOT mirrored for RTL: they move through time, and the
                calendar grid itself stays left-to-right in every language. */}
            <Pressable onPress={() => step(-1)} hitSlop={14} accessibilityRole="button" accessibilityLabel={t("cal.prevMonth")}>
              <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700" }}>‹</Text>
            </Pressable>
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: "700" }}>
              {monthName(cursor.getMonth())} {cursor.getFullYear()}
            </Text>
            <Pressable onPress={() => step(1)} hitSlop={14} accessibilityRole="button" accessibilityLabel={t("cal.nextMonth")}>
              <Text style={{ color: c.ink, fontSize: 20, fontWeight: "700" }}>›</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: "row" }}>
            {weekdays().map((w) => (
              <Text key={w} style={{ flex: 1, textAlign: "center", color: c.inkFaint, fontSize: 11.5, fontWeight: "600" }}>
                {w}
              </Text>
            ))}
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {cells.map((d, i) => {
              if (d === null) return <View key={`e${i}`} style={{ width: `${100 / 7}%`, height: 42 }} />;
              const picked = isSame(d, selected);
              const now = isSame(d, today);
              return (
                <Pressable
                  key={d}
                  onPress={() => {
                    onChange(toDateValue(new Date(cursor.getFullYear(), cursor.getMonth(), d)));
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: picked }}
                  style={{ width: `${100 / 7}%`, height: 42, alignItems: "center", justifyContent: "center" }}
                >
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: radius.pill,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: picked ? c.primary : "transparent",
                      borderWidth: !picked && now ? 1 : 0,
                      borderColor: c.borderStrong,
                    }}
                  >
                    <Text style={{ color: picked ? c.primaryInk : c.ink, fontSize: 14, fontWeight: picked || now ? "700" : "500" }}>
                      {d}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => {
              onChange(toDateValue(new Date()));
              setOpen(false);
            }}
            accessibilityRole="button"
            style={{ alignSelf: "center", paddingVertical: 8, paddingHorizontal: 16 }}
          >
            <Text style={{ color: c.inkMuted, fontSize: 13.5, fontWeight: "600" }}>{t("cal.today")}</Text>
          </Pressable>
        </Sheet>
      )}
    </>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
/** Five-minute steps: fine enough for a shift note, short enough to scan. */
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/** Time field + hour/minute columns. `value` and `onChange` speak `HH:MM`. */
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const { hour, minute } = fromTimeValue(value);

  const set = (h: number | null, mi: number | null) => {
    if (h === null) return;
    onChange(toTimeValue(h, mi));
  };

  const column = (items: number[], current: number | null, onPick: (n: number) => void, a11y: string) => (
    <ScrollView style={{ flex: 1, maxHeight: 220 }} contentContainerStyle={{ paddingVertical: 4 }} accessibilityLabel={a11y}>
      {items.map((n) => {
        const picked = current === n;
        return (
          <Pressable
            key={n}
            onPress={() => onPick(n)}
            accessibilityRole="button"
            accessibilityState={{ selected: picked }}
            style={{
              paddingVertical: 10,
              marginVertical: 2,
              marginHorizontal: 4,
              borderRadius: radius.control,
              alignItems: "center",
              backgroundColor: picked ? c.primary : c.surface2,
            }}
          >
            <Text style={{ color: picked ? c.primaryInk : c.ink, fontSize: 15, fontWeight: picked ? "700" : "500" }}>{pad(n)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <>
      <PickerField c={c} label={label} display={toTimeValue(hour, minute)} placeholder="" onPress={() => setOpen(true)} />

      {open && (
        <Sheet c={c} title={label} onClose={() => setOpen(false)}>
          {/* Columns stay hour-then-minute in every language: a clock reads the
              same way in Arabic, and mirroring it would invert the time. */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {column(HOURS, hour, (h) => set(h, minute), t("cal.hour"))}
            {column(MINUTES, minute, (mi) => set(hour ?? 0, mi), t("cal.minute"))}
          </View>

          <View style={{ flexDirection: isRTL() ? "row-reverse" : "row", gap: 10 }}>
            <Pressable
              onPress={() => {
                onChange("");
                setOpen(false);
              }}
              accessibilityRole="button"
              style={{ flex: 1, paddingVertical: 11, borderRadius: radius.control, borderWidth: 1, borderColor: c.line, alignItems: "center" }}
            >
              <Text style={{ color: c.inkMuted, fontSize: 14, fontWeight: "600" }}>{t("cal.clear")}</Text>
            </Pressable>
            <Pressable
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              disabled={hour === null}
              style={{
                flex: 1,
                paddingVertical: 11,
                borderRadius: radius.control,
                alignItems: "center",
                backgroundColor: hour === null ? c.surface2 : c.primary,
              }}
            >
              <Text style={{ color: hour === null ? c.inkFaint : c.primaryInk, fontSize: 14, fontWeight: "700" }}>{t("cal.done")}</Text>
            </Pressable>
          </View>
        </Sheet>
      )}
    </>
  );
}
