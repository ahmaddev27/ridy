/**
 * Send a receipt to your own company.
 *
 * ## The photo is mandatory, and it is the point
 *
 * Everything typed here is a CLAIM. The photo is the only evidence of it, and
 * the company cannot accept the receipt without one — El-Professor refuses it
 * by name (`document_missing`) and its reviewer's accept button stays disabled
 * until the photo renders. So this screen refuses it too: the driver learns at
 * the moment they send rather than from a rejection days later.
 *
 * ## Why the photo is downscaled here
 *
 * Two measured reasons, not tidiness. Above PHP's `post_max_size` the backend
 * receives an EMPTY request with no message at all, so a 12 MP phone photo
 * fails invisibly; and a Beleg needs legible text, not resolution — 1600px on
 * the long edge at quality 0.7 reads perfectly and lands around 300 KB.
 *
 * `manipulateAsync` also re-encodes, which **drops the EXIF** — a phone photo
 * carries GPS and a timestamp, and a receipt photographed at home would
 * otherwise tell the company where the driver lives.
 *
 * ## The amount has exactly one shape on the wire
 *
 * A plain decimal with a dot. El-Professor's own parser reads `1.234` as 1.23
 * — wrong by a factor of a thousand — and answers 0 for anything it cannot
 * read, and this figure moves what the driver owes their company. So the field
 * accepts a comma from the keyboard (every German keyboard gives one) and
 * converts it once, here, before anything is sent.
 */
import { useState } from "react";
import { View, ScrollView, Pressable, Image, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Camera, ChevronLeft, ImageIcon, X } from "@/components/icons";
import { Text } from "@/components/typography";
import { Field, PrimaryButton, SecondaryButton, SectionLabel } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, ApiError, type PickedPhoto } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { useColors, radius, cardStyle, type Palette } from "@/lib/theme";

/** The four El-Professor stores literally. `Other` is a sentinel it never saves,
 *  so a free description takes its place rather than the word. */
const CATEGORIES = ["Tanken", "Autowäsche", "Autozubehör", "Öl wechseln"] as const;

/** 1600px long edge, quality 0.7: legible text, ~300 KB, no EXIF. */
const MAX_EDGE = 1600;
const QUALITY = 0.7;

/** `YYYY-MM-DD` in the phone's own day, which is the day the driver means. */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** German typing to the one shape the wire takes, or null if it is not money. */
export function toWireAmount(input: string): string | null {
  const cleaned = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(cleaned)) return null;
  return cleaned;
}

export default function ReceiptScreen() {
  const c = useColors();
  const router = useRouter();
  const toast = useToast();
  const row = isRTL() ? "row-reverse" : "row";
  // The company's connection. The endpoint answers 403 `not_connected` without
  // it, so offering the form would be offering a send that cannot land.
  const { driver } = useAuth();
  const connected = driver?.documents_enabled === true;

  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string | null>("Tanken");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState<"bar" | "uberweisung">("bar");
  const [plz, setPlz] = useState("");

  /** Shrink and re-encode, which is also what strips the EXIF. */
  const prepare = async (uri: string): Promise<PickedPhoto> => {
    const out = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: MAX_EDGE } }],
      { compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG },
    );
    return { uri: out.uri, name: "beleg.jpg", type: "image/jpeg" };
  };

  const take = async (from: "camera" | "library") => {
    setBusy(true);
    try {
      const permission =
        from === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        // Named, because a silent no-op reads as a broken button.
        Alert.alert(t("receipt.permTitle"), t("receipt.permBody"));
        return;
      }
      const result =
        from === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 1, exif: false })
          : await ImagePicker.launchImageLibraryAsync({ quality: 1, exif: false, mediaTypes: ["images"] });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setPhoto(await prepare(result.assets[0].uri));
    } catch {
      toast.show(t("receipt.photoFailed"));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!photo) {
      toast.show(t("receipt.photoRequired"));
      return;
    }
    const wire = toWireAmount(amount);
    if (wire === null) {
      toast.show(t("receipt.amountInvalid"));
      return;
    }
    if (!category && description.trim() === "") {
      toast.show(t("receipt.subjectRequired"));
      return;
    }
    if (plz.trim() !== "" && !/^\d{5}$/.test(plz.trim())) {
      toast.show(t("receipt.plzInvalid"));
      return;
    }

    setSending(true);
    try {
      await api.submitReceipt(
        {
          receipt_date: date,
          amount: wire,
          category,
          description: description.trim() || null,
          payment_method: method,
          postal_code: plz.trim() || null,
        },
        photo,
      );
      toast.show(t("receipt.sent"));
      router.back();
    } catch (e) {
      // A validation refusal from the backend is the driver's to fix; anything
      // else is ours, and saying "try again" to a 422 wastes their time.
      const known = e instanceof ApiError && e.status === 422;
      toast.show(known ? t("receipt.rejectedByServer") : t("receipt.sendFailed"));
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
        <Text style={{ fontSize: 18, fontWeight: "700", color: c.ink }}>{t("receipt.title")}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 14 }} keyboardShouldPersistTaps="handled">
        {!connected && (
          <View style={{ ...cardStyle(c), gap: 6 }}>
            <Text style={{ color: c.ink, fontWeight: "700", fontSize: 14.5 }}>{t("subs.notConnected")}</Text>
            <Text style={{ color: c.inkMuted, fontSize: 13.5 }}>{t("subs.notConnectedBody")}</Text>
          </View>
        )}

        <View style={{ ...cardStyle(c), gap: 6 }}>
          <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("receipt.reviewNote")}</Text>
        </View>

        <SectionLabel>{t("receipt.photo")}</SectionLabel>
        {photo ? (
          <View style={{ ...cardStyle(c), gap: 10 }}>
            <Image
              source={{ uri: photo.uri }}
              style={{ width: "100%", height: 260, borderRadius: radius.md, backgroundColor: c.surface2 }}
              resizeMode="contain"
              accessibilityLabel={t("receipt.photoAlt")}
            />
            <Pressable
              onPress={() => setPhoto(null)}
              accessibilityRole="button"
              style={{ flexDirection: row, alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <X size={16} color={c.danger} strokeWidth={2} />
              <Text style={{ color: c.danger, fontWeight: "700", fontSize: 13.5 }}>{t("receipt.photoRemove")}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ flexDirection: row, gap: 12 }}>
            <PhotoButton c={c} icon={Camera} label={t("receipt.takePhoto")} busy={busy} onPress={() => void take("camera")} />
            <PhotoButton c={c} icon={ImageIcon} label={t("receipt.fromLibrary")} busy={busy} onPress={() => void take("library")} />
          </View>
        )}

        <SectionLabel>{t("receipt.details")}</SectionLabel>

        <Field label={t("receipt.date")} value={date} onChangeText={setDate} placeholder="2026-10-07" autoCapitalize="none" />

        <Field
          label={t("receipt.amount")}
          value={amount}
          onChangeText={setAmount}
          placeholder="41,47"
          keyboardType="decimal-pad"
        />

        <SectionLabel>{t("receipt.category")}</SectionLabel>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {CATEGORIES.map((item) => (
            <Chip key={item} c={c} label={item} active={category === item} onPress={() => { setCategory(item); }} />
          ))}
          {/* `Other` is never stored as a word: choosing it clears the category
              and the free text below becomes the Beleg's subject. */}
          <Chip c={c} label={t("receipt.other")} active={category === null} onPress={() => setCategory(null)} />
        </View>

        {category === null && (
          <Field
            label={t("receipt.description")}
            value={description}
            onChangeText={setDescription}
            placeholder={t("receipt.descriptionHint")}
          />
        )}

        <SectionLabel>{t("receipt.payment")}</SectionLabel>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip c={c} label={t("receipt.cash")} active={method === "bar"} onPress={() => setMethod("bar")} />
          <Chip c={c} label={t("receipt.transfer")} active={method === "uberweisung"} onPress={() => setMethod("uberweisung")} />
        </View>
        {method === "bar" && (
          <Text style={{ color: c.inkSubtle, fontSize: 12.5 }}>{t("receipt.cashHint")}</Text>
        )}

        <Field
          label={t("receipt.plz")}
          value={plz}
          onChangeText={setPlz}
          placeholder="10179"
          keyboardType="number-pad"
        />

        <PrimaryButton
          label={sending ? t("receipt.sending") : t("receipt.send")}
          onPress={() => void submit()}
          disabled={sending || busy || !photo || !connected}
        />
        {!photo && <Text style={{ color: c.inkSubtle, fontSize: 12.5, textAlign: "center" }}>{t("receipt.photoRequired")}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function PhotoButton({
  c,
  icon: Icon,
  label,
  busy,
  onPress,
}: {
  c: Palette;
  icon: typeof Camera;
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ ...cardStyle(c), flex: 1, alignItems: "center", gap: 8, paddingVertical: 20, opacity: busy ? 0.6 : 1 }}
    >
      {busy ? <ActivityIndicator color={c.ink} /> : <Icon size={22} color={c.primary} strokeWidth={1.8} />}
      <Text style={{ color: c.ink, fontWeight: "700", fontSize: 13.5, textAlign: "center" }}>{label}</Text>
    </Pressable>
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
