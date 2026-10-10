/**
 * Send a receipt to your own company.
 *
 * ## The photo is READ here and never sent
 *
 * The owner decided on 10.10.2026 that a driver sends the figures, not the
 * document. So the photo is taken, downscaled, passed to the phone's own OCR
 * engine, and stays on the device; what travels is what is on screen after
 * that, which the driver can correct first.
 *
 * **That removes the only thing that could catch a misreading later.** A
 * company reviewing a submission no longer has a document to compare the
 * amount against, so a wrong figure nobody notices at this screen is wrong for
 * good. Hence the marker below: a field the rules are UNSURE about is flagged
 * in the open and the form will not send until the driver has confirmed it by
 * hand. That guard is the whole of what replaced the evidence, and it should
 * not be quietly relaxed.
 *
 * ## Why the photo is still downscaled
 *
 * Nothing is uploaded any more, so `post_max_size` no longer applies — but a
 * 12 MP photo is slower to recognise for no gain, and 1600px on the long edge
 * at quality 0.7 is what the rules were tuned against. `manipulateAsync` also
 * re-encodes, which drops the EXIF; that mattered when the file travelled and
 * is kept because a cached copy carrying the driver's home GPS is not
 * something to leave lying on a phone.
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
// The phone's own OCR, offline, with the model bundled in the app: no
// first-use download and no Play Services dependency. It returns LINES WITH
// COORDINATES, which is the whole reason it is this package and not a lighter
// one - see `rowsFromLines` for what the coordinates are for.
import TextRecognition from "@react-native-ml-kit/text-recognition";
import { AlertCircle, Camera, Check, ChevronLeft, ImageIcon, X } from "@/components/icons";
import { Text } from "@/components/typography";
import { Field, PrimaryButton, SecondaryButton, SectionLabel } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, ApiError, type PickedPhoto } from "@/lib/api";
import { Sentry } from "@/lib/sentry";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
// A COPY of El-Professor's rules; the two move together and are measured
// against the same fixtures in `tests/receipt-text-parse.test.mjs`.
import { parseReceiptText, formatAmountDE, type OcrResult } from "@/lib/receipt-text-parse";
import { rowsFromLines } from "@/lib/ocr-lines";
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

  // What the photo said, and which of its answers still need the driver's eyes.
  // `scanNote` is the one line explaining why a form came back empty; without
  // it a failed read is indistinguishable from a receipt with nothing on it.
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [checkDate, setCheckDate] = useState(false);
  const [checkAmount, setCheckAmount] = useState(false);

  /** Shrink and re-encode, which is also what strips the EXIF. */
  const prepare = async (uri: string): Promise<PickedPhoto> => {
    const out = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: MAX_EDGE } }],
      { compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG },
    );
    return { uri: out.uri, name: "beleg.jpg", type: "image/jpeg" };
  };

  /**
   * Read the receipt and fill the form from it.
   *
   * `Unsicher` is the marker the rules write into their own reason strings when
   * a field scored below their confidence threshold. It is DATA, not prose:
   * this is the one place that reads it, and it decides which field the driver
   * has to confirm. A flagged field is not wrong — the fixtures pin a case where
   * the amount is exactly right and still flagged, because a tax line sat next
   * to it — it is unconfirmed, which with no photo travelling is the only
   * difference left that anyone can act on.
   */
  const scan = async (uri: string) => {
    setScanNote(null);
    setCheckDate(false);
    setCheckAmount(false);
    setScanning(true);
    try {
      // The engine's lines are NOT the receipt's rows: on a two-column till
      // roll a label and its figure come back as separate lines, and every
      // "same line" rule in the parser then sees nothing. `rowsFromLines` puts
      // them back by where they sit on the page.
      const result = await TextRecognition.recognize(uri);
      const text = rowsFromLines(result.blocks.flatMap((b) => b.lines)).join("\n");
      if (text.trim() === "") {
        setScanNote(t("receipt.scanNothing"));
        return;
      }
      const r: OcrResult = parseReceiptText(text);

      if (r.date) {
        setDate(r.date);
        setCheckDate(r.dateReason?.startsWith("Unsicher") === true);
      }
      if (r.amount !== undefined) {
        setAmount(formatAmountDE(r.amount));
        setCheckAmount(r.amountReason?.startsWith("Unsicher") === true);
      }
      // A category the rules read but this build does not offer is dropped
      // rather than shown: the four are what the other side stores literally.
      if (r.category && (CATEGORIES as readonly string[]).includes(r.category)) {
        setCategory(r.category);
      }
      if (r.postalCode) setPlz(r.postalCode);

      // Naming the field that could not be read is the difference between a
      // driver retaking the photo and a driver assuming the app is broken.
      if (r.date === undefined && r.amount === undefined) {
        setScanNote(t("receipt.scanNothing"));
      } else if (r.amount === undefined) {
        setScanNote(t("receipt.scanNoAmount"));
      } else if (r.date === undefined) {
        setScanNote(t("receipt.scanNoDate"));
      }
    } catch {
      setScanNote(t("receipt.scanFailed"));
    } finally {
      setScanning(false);
    }
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
      const prepared = await prepare(result.assets[0].uri);
      setPhoto(prepared);
      await scan(prepared.uri);
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
    // The photo does not travel, so an unchecked field can never be checked
    // against anything afterwards. This is the wall, not a reminder.
    if (checkDate || checkAmount) {
      toast.show(t("receipt.mustConfirm"));
      return;
    }

    setSending(true);
    try {
      await api.submitReceipt({
        receipt_date: date,
        amount: wire,
        category,
        description: description.trim() || null,
        payment_method: method,
        postal_code: plz.trim() || null,
      });
      toast.show(t("receipt.sent"));
      router.back();
    } catch (e) {
      // Four different failures, four different things to do about them. One
      // sentence for all of them is what left the first real failure with no
      // trace anywhere: the server had logged nothing, because the request had
      // never arrived, and the app had said only "try again later".
      //
      // `status === 0` is this client's marker for "no HTTP answer at all", and
      // the message carries which kind, so a dead connection and a request that
      // hung for a minute no longer read the same.
      const err = e instanceof ApiError ? e : null;
      if (err?.status === 422) toast.show(t("receipt.rejectedByServer"));
      else if (err?.status === 413) toast.show(t("receipt.photoTooLarge"));
      else if (err?.status === 0 && err.message === "timeout") toast.show(t("receipt.sendTimeout"));
      else if (err?.status === 0) toast.show(t("receipt.sendOffline"));
      else toast.show(t("receipt.sendFailed"));

      // And whatever it was, it reaches Sentry with its shape. A refusal the
      // driver caused (422) is not a defect and is not reported; everything
      // else is one of ours until it is read.
      if (err?.status !== 422) {
        Sentry.captureException(e, {
          tags: { flow: "receipt_submit" },
          extra: { status: err?.status ?? null, kind: err?.message ?? String(e) },
        });
      }
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
          <View style={{ ...cardStyle(c), padding: 16, gap: 6 }}>
            <Text style={{ color: c.ink, fontWeight: "700", fontSize: 14.5 }}>{t("subs.notConnected")}</Text>
            <Text style={{ color: c.inkMuted, fontSize: 13.5 }}>{t("subs.notConnectedBody")}</Text>
          </View>
        )}

        <View style={{ ...cardStyle(c), padding: 16, gap: 6 }}>
          <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("receipt.reviewNote")}</Text>
        </View>

        <SectionLabel>{t("receipt.photo")}</SectionLabel>
        {photo ? (
          <View style={{ ...cardStyle(c), padding: 12, gap: 10 }}>
            <Image
              source={{ uri: photo.uri }}
              style={{ width: "100%", height: 260, borderRadius: radius.md, backgroundColor: c.surface2 }}
              resizeMode="contain"
              accessibilityLabel={t("receipt.photoAlt")}
            />
            {scanning && (
              <View style={{ flexDirection: row, alignItems: "center", justifyContent: "center", gap: 8 }}>
                <ActivityIndicator color={c.ink} />
                <Text style={{ color: c.inkMuted, fontSize: 13.5 }}>{t("receipt.scanning")}</Text>
              </View>
            )}
            {!scanning && scanNote !== null && (
              <Text style={{ color: c.inkMuted, fontSize: 13, textAlign: "center" }}>{scanNote}</Text>
            )}
            {/* Said plainly, because it is the opposite of what a driver expects
                from a button labelled "take a photo of the receipt". */}
            <Text style={{ color: c.inkSubtle, fontSize: 12.5, textAlign: "center" }}>
              {t("receipt.photoStaysHere")}
            </Text>
            <Pressable
              onPress={() => { setPhoto(null); setScanNote(null); setCheckDate(false); setCheckAmount(false); }}
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

        {/* Typing in a flagged field clears its flag: the value is then the
            driver's own, and asking them to confirm what they just typed is
            noise that teaches people to tap past the warning. */}
        <Field
          label={t("receipt.date")}
          value={date}
          onChangeText={(v) => { setDate(v); setCheckDate(false); }}
          placeholder="2026-10-07"
          autoCapitalize="none"
        />
        {checkDate && <NeedsCheck c={c} row={row} onConfirm={() => setCheckDate(false)} />}

        <Field
          label={t("receipt.amount")}
          value={amount}
          onChangeText={(v) => { setAmount(v); setCheckAmount(false); }}
          placeholder="41,47"
          keyboardType="decimal-pad"
        />
        {checkAmount && <NeedsCheck c={c} row={row} onConfirm={() => setCheckAmount(false)} />}

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
          disabled={sending || busy || scanning || checkDate || checkAmount || !photo || !connected}
        />
        {!photo && <Text style={{ color: c.inkSubtle, fontSize: 12.5, textAlign: "center" }}>{t("receipt.photoRequired")}</Text>}
        {photo && (checkDate || checkAmount) && (
          <Text style={{ color: c.warning, fontSize: 12.5, textAlign: "center", fontWeight: "700" }}>
            {t("receipt.mustConfirm")}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The marker on a field the rules were not sure about.
 *
 * Deliberately loud: a filled amber band, its own icon, and a button that has
 * to be pressed. With the photo staying on the phone this is the ONLY thing
 * standing between a misread figure and the company's books, so it is not a
 * hint and it does not sit quietly under the field.
 */
function NeedsCheck({ c, row, onConfirm }: { c: Palette; row: "row" | "row-reverse"; onConfirm: () => void }) {
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: radius.md,
        borderWidth: 2,
        borderColor: c.warning,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: row, alignItems: "center", gap: 8 }}>
        <AlertCircle size={18} color={c.warning} strokeWidth={2.2} />
        <Text style={{ color: c.warning, fontWeight: "700", fontSize: 14 }}>{t("receipt.checkTitle")}</Text>
      </View>
      <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("receipt.checkBody")}</Text>
      <Pressable
        onPress={onConfirm}
        accessibilityRole="button"
        accessibilityLabel={t("receipt.checkConfirm")}
        style={{
          flexDirection: row,
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: radius.control,
          backgroundColor: c.warning,
        }}
      >
        <Check size={18} color={c.surface} strokeWidth={2.4} />
        <Text style={{ color: c.surface, fontWeight: "700", fontSize: 14 }}>{t("receipt.checkConfirm")}</Text>
      </Pressable>
    </View>
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
      style={{ ...cardStyle(c), flex: 1, alignItems: "center", gap: 8, paddingVertical: 20, paddingHorizontal: 12, opacity: busy ? 0.6 : 1 }}
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
