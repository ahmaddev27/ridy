/**
 * Send a note to your own company — a breakdown, a police check, a wait.
 *
 * ## Seven types, and the three that are missing are missing on purpose
 *
 * `sick`, `vacation` and `off` are not offered. They are health and absence
 * data — Art. 9 — and El-Professor refuses them at its own door, so offering
 * them here would produce a submission that is rejected every time with a
 * reason the driver cannot act on. Absence stays between the driver and their
 * company the way it already works.
 *
 * ## No photo, so this half ships over the air
 *
 * Nothing on this screen is native. The receipt's camera is what forces a store
 * build, and that is why the two forms are separate screens rather than one
 * with a switch: this one can reach installed phones immediately.
 */
import { useState } from "react";
import { View, ScrollView, Pressable, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft } from "@/components/icons";
import { Text } from "@/components/typography";
import { Field, PrimaryButton, SectionLabel } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius, cardStyle, type Palette } from "@/lib/theme";

/** The seven that may cross. Their labels live in the dictionary; the VALUES
 *  are El-Professor's own stored vocabulary and are never translated. */
const TYPES = ["general", "blitzer", "accident", "kontrolle", "breakdown", "wait", "other"] as const;

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function NoteScreen() {
  const c = useColors();
  const router = useRouter();
  const toast = useToast();
  const row = isRTL() ? "row-reverse" : "row";

  const [type, setType] = useState<string>("general");
  const [text, setText] = useState("");
  const [date, setDate] = useState(today());
  const [fullDay, setFullDay] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (text.trim() === "") {
      toast.show(t("note.textRequired"));
      return;
    }
    // An hour outside 00–23 is not a typo the other side can repair: its own
    // parser turns `25:00` into minutes and walks into the next day.
    for (const [value, label] of [[from, "note.from"], [to, "note.to"]] as const) {
      if (!fullDay && value.trim() !== "" && !TIME.test(value.trim())) {
        toast.show(t("note.timeInvalid", { field: t(label) }));
        return;
      }
    }

    setSending(true);
    try {
      await api.submitNote({
        note_type: type,
        note_text: text.trim(),
        start_date: date,
        end_date: date,
        is_full_day: fullDay,
        start_time: fullDay ? null : from.trim() || null,
        end_time: fullDay ? null : to.trim() || null,
      });
      toast.show(t("note.sent"));
      router.back();
    } catch (e) {
      const known = e instanceof ApiError && e.status === 422;
      toast.show(known ? t("note.rejectedByServer") : t("note.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.canvas }} edges={["top"]}>
      <View style={{ flexDirection: row, alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("common.back")} hitSlop={10}>
          <ChevronLeft size={24} color={c.ink} strokeWidth={1.8} style={isRTL() ? { transform: [{ scaleX: -1 }] } : undefined} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: "700", color: c.ink }}>{t("note.title")}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ ...cardStyle(c), gap: 6 }}>
          <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("note.reviewNote")}</Text>
        </View>

        <SectionLabel>{t("note.type")}</SectionLabel>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {TYPES.map((item) => (
            <Chip key={item} c={c} label={t(`note.type.${item}`)} active={type === item} onPress={() => setType(item)} />
          ))}
        </View>

        <SectionLabel>{t("note.text")}</SectionLabel>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t("note.textHint")}
          placeholderTextColor={c.inkFaint}
          multiline
          numberOfLines={5}
          style={{
            ...cardStyle(c),
            minHeight: 120,
            textAlignVertical: "top",
            color: c.ink,
            fontSize: 14.5,
            textAlign: isRTL() ? "right" : "left",
          }}
        />

        <Field label={t("note.date")} value={date} onChangeText={setDate} placeholder="2026-10-07" autoCapitalize="none" />

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip c={c} label={t("note.fullDay")} active={fullDay} onPress={() => setFullDay(true)} />
          <Chip c={c} label={t("note.timeRange")} active={!fullDay} onPress={() => setFullDay(false)} />
        </View>

        {!fullDay && (
          <View style={{ flexDirection: row, gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field label={t("note.from")} value={from} onChangeText={setFrom} placeholder="08:00" keyboardType="numbers-and-punctuation" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t("note.to")} value={to} onChangeText={setTo} placeholder="10:30" keyboardType="numbers-and-punctuation" />
            </View>
          </View>
        )}

        <PrimaryButton label={sending ? t("note.sending") : t("note.send")} onPress={() => void submit()} disabled={sending} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ c, label, active, onPress }: { c: Palette; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? c.borderStrong : c.line,
        backgroundColor: active ? c.surfaceRaised : c.surface,
      }}
    >
      <Text style={{ color: active ? c.ink : c.inkMuted, fontWeight: active ? "700" : "500", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}
