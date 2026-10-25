/**
 * Send a note to your own company - a breakdown, a police check, a wait, or an
 * absence.
 *
 * ## Ten types, and the rules are not in this file
 *
 * All ten of El-Professor's note types may cross, the absence ones included
 * (owner's decision, 13.10.2026). What a note needs before it may be sent is
 * `lib/note-rules.ts`, which the send asks and a test pins.
 *
 * ## The vehicle is picked, never typed
 *
 * The five incident types must name one. A failed load is shown as a failure,
 * not as an empty picker.
 *
 * ## No photo, so this half ships over the air
 *
 * Nothing on this screen is native. The receipt's camera is what forces a store
 * build, and that is why the two forms are separate screens rather than one
 * with a switch: this one can reach installed phones immediately.
 */
import { useCallback, useEffect, useState } from "react";
import { View, ScrollView, Pressable, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft } from "@/components/icons";
import { Text } from "@/components/typography";
import { DateField, TimeField } from "@/components/date-time-picker";
import { PrimaryButton, SectionLabel } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { NOTE_TYPES, noteProblem, platePayload, vehicleRequired, type VehicleList } from "@/lib/note-rules";
import { useColors, radius, cardStyle, type Palette } from "@/lib/theme";

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function NoteScreen() {
  const c = useColors();
  const router = useRouter();
  const toast = useToast();
  const row = isRTL() ? "row-reverse" : "row";
  // The company's connection. The endpoint answers 403 `not_connected` without
  // it, so offering the form would be offering a send that cannot land.
  const { driver } = useAuth();
  const connected = driver?.documents_enabled === true;

  const [type, setType] = useState<string>("general");
  const [text, setText] = useState("");
  const [date, setDate] = useState(today());
  const [fullDay, setFullDay] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [plate, setPlate] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<VehicleList>({ status: "loading" });

  const loadVehicles = useCallback(async () => {
    setVehicles({ status: "loading" });
    try {
      const res = await api.driverVehicles();
      setVehicles({ status: "ready", vehicles: res.data });
    } catch {
      setVehicles({ status: "failed" });
    }
  }, []);

  useEffect(() => {
    if (connected) void loadVehicles();
  }, [connected, loadVehicles]);

  const submit = async () => {
    const problem = noteProblem({ type, text, fullDay, from, to, plate, vehicles });
    if (problem) {
      const vars = problem.vars ? { field: t(problem.vars.field) } : undefined;
      toast.show(t(problem.key, vars));
      return;
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
        vehicle_plate: platePayload(plate, vehicles),
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
        {!connected && (
          <View style={{ ...cardStyle(c), padding: 16, gap: 6 }}>
            <Text style={{ color: c.ink, fontWeight: "700", fontSize: 14.5 }}>{t("subs.notConnected")}</Text>
            <Text style={{ color: c.inkMuted, fontSize: 13.5 }}>{t("subs.notConnectedBody")}</Text>
          </View>
        )}

        <View style={{ ...cardStyle(c), padding: 16, gap: 6 }}>
          <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("note.reviewNote")}</Text>
        </View>

        <SectionLabel>{t("note.type")}</SectionLabel>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {NOTE_TYPES.map((item) => (
            <Chip key={item} c={c} label={t(`note.type.${item}`)} active={type === item} onPress={() => setType(item)} />
          ))}
        </View>

        <SectionLabel>{t("note.vehicle")}</SectionLabel>
        <VehiclePicker c={c} list={vehicles} plate={plate} onPick={setPlate} onRetry={() => void loadVehicles()} required={vehicleRequired(type)} />

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
            paddingHorizontal: 14,
            paddingTop: 12,
            paddingBottom: 12,
            textAlignVertical: "top",
            color: c.ink,
            fontSize: 14.5,
            textAlign: isRTL() ? "right" : "left",
          }}
        />

        {/* Picked, never typed. A driver filling a note on the move got
            `2026-13-07` or `8:0` past the keyboard and only found out when the
            send bounced; a calendar and an hour list cannot produce either. */}
        <DateField label={t("note.date")} value={date} onChange={setDate} />

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip c={c} label={t("note.fullDay")} active={fullDay} onPress={() => setFullDay(true)} />
          <Chip c={c} label={t("note.timeRange")} active={!fullDay} onPress={() => setFullDay(false)} />
        </View>

        {!fullDay && (
          <View style={{ flexDirection: row, gap: 12 }}>
            <View style={{ flex: 1 }}>
              <TimeField label={t("note.from")} value={from} onChange={setFrom} />
            </View>
            <View style={{ flex: 1 }}>
              <TimeField label={t("note.to")} value={to} onChange={setTo} />
            </View>
          </View>
        )}

        <PrimaryButton label={sending ? t("note.sending") : t("note.send")} onPress={() => void submit()} disabled={sending || !connected} />
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

/** Pick a plate from the fleet's list. A failed load says so and offers a retry. */
function VehiclePicker({ c, list, plate, onPick, onRetry, required }: {
  c: Palette; list: VehicleList; plate: string | null; onPick: (p: string | null) => void; onRetry: () => void; required: boolean;
}) {
  if (list.status === "loading") return <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("note.vehiclesLoading")}</Text>;
  if (list.status === "failed") {
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("note.vehiclesFailed")}</Text>
        <Chip c={c} label={t("note.vehiclesRetry")} active={false} onPress={onRetry} />
      </View>
    );
  }
  if (list.vehicles.length === 0) return <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("note.vehiclesNone")}</Text>;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("note.vehicleHint")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {!required && <Chip c={c} label={t("note.vehicleNone")} active={plate === null} onPress={() => onPick(null)} />}
        {list.vehicles.map((v) => (
          <Chip key={v.id} c={c} label={v.license_plate} active={plate === v.license_plate} onPress={() => onPick(v.license_plate)} />
        ))}
      </View>
    </View>
  );
}
