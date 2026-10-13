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
import { View, ScrollView, Pressable, Image, ActivityIndicator, Alert, Modal } from "react-native";
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
import {
  stepsFor,
  stepProblem,
  submitProblem,
  toWireAmount,
  toWireDecimal,
  type ReceiptStep,
} from "@/lib/receipt-steps";
import { readOdometer } from "@/lib/odometer-read";
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

export default function ReceiptScreen() {
  const c = useColors();
  const router = useRouter();
  const toast = useToast();
  const row = isRTL() ? "row-reverse" : "row";
  // The company's connection. The endpoint answers 403 `not_connected` without
  // it, so offering the form would be offering a send that cannot land.
  const { driver } = useAuth();
  const connected = driver?.documents_enabled === true;
  // A camera photo is taken now, of something in front of the driver; a
  // gallery picture can be any image on the phone. So the company decides,
  // and an older server that sends nothing here means camera only.
  const galleryAllowed = driver?.gallery_import_enabled === true;

  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string | null>("Tanken");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState<"bar" | "uberweisung">("bar");
  const [plz, setPlz] = useState("");
  // What the receipt itself says, beyond the amount. The owner asked for all
  // of them on 11.10.2026; the two fuel figures are required on `Tanken` only,
  // because a car wash has neither and demanding them would block every
  // receipt that is not a refuel.
  const [merchant, setMerchant] = useState("");
  const [city, setCity] = useState("");
  const [receiptTime, setReceiptTime] = useState("");
  const [litres, setLitres] = useState("");
  const [pricePerLitre, setPricePerLitre] = useState("");

  // The odometer, required with a refuel. Its photo is read here and kept
  // here, exactly like the Beleg's: what travels is the two figures.
  const [odoPhoto, setOdoPhoto] = useState<PickedPhoto | null>(null);
  // The uri the popup is showing. Separate from `odoPhoto` because the popup
  // closes while the photo stays: one is what is on screen, the other is what
  // the receipt carries.
  const [odoShot, setOdoShot] = useState<string | null>(null);
  const [odoScanning, setOdoScanning] = useState(false);
  const [odoNote, setOdoNote] = useState<string | null>(null);
  const [odometerKm, setOdometerKm] = useState("");
  const [rangeKm, setRangeKm] = useState("");

  // What the photo said, and which of its answers still need the driver's eyes.
  // `scanNote` is the one line explaining why a form came back empty; without
  // it a failed read is indistinguishable from a receipt with nothing on it.
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  // Which step is on screen. The list itself is derived, because a refuel has
  // a step a car wash does not — changing the category changes the flow.
  const [step, setStep] = useState<ReceiptStep>("photo");

  const [checkDate, setCheckDate] = useState(false);
  const [checkAmount, setCheckAmount] = useState(false);

  /** Shrink and re-encode, which is also what strips the EXIF. */
  // One description of the form, asked by the step gate AND by the send, so
  // the two can never disagree about what a valid receipt is.
  const formState = {
    photo: { hasPhoto: photo !== null, scanning },
    details: {
      amount, category, description, merchant, city, plz,
      receiptTime,
      unconfirmed: checkDate || checkAmount,
    },
    fuel: { litres, pricePerLitre },
    odometer: { hasOdoPhoto: odoPhoto !== null, odometerKm },
  };

  const steps = stepsFor(category);
  const stepIndex = Math.max(0, steps.indexOf(step));
  const blocker = stepProblem(step, formState);

  const goNext = () => {
    if (blocker !== null) {
      toast.show(t(blocker));
      return;
    }
    const next = steps[stepIndex + 1];
    if (next !== undefined) setStep(next);
  };

  const goBack = () => {
    const previous = steps[stepIndex - 1];
    if (previous === undefined) router.back();
    else setStep(previous);
  };

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
      if (r.merchantName) setMerchant(r.merchantName);
      if (r.city) setCity(r.city);
      if (r.time) setReceiptTime(r.time);
      // German decimals on screen, converted once on the way out.
      if (r.litres !== undefined) setLitres(r.litres.toFixed(2).replace(".", ","));
      if (r.pricePerLitre !== undefined) {
        setPricePerLitre(r.pricePerLitre.toFixed(3).replace(".", ","));
      }

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

  /**
   * Photograph the cluster and read it.
   *
   * The rule behind `readOdometer` ABSTAINS rather than guessing, and that is
   * the behaviour this screen is built around: measured on 59 photos, a vision
   * model answered every one of them and was impossible on 15, where the rule
   * answered 35 and said nothing on 24. An empty field a driver fills in is
   * recoverable; a plausible wrong total is not, because the photo stays here.
   */
  const takeOdometer = async () => {
    setBusy(true);
    setOdoNote(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t("receipt.permTitle"), t("receipt.permBody"));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 1, exif: false });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const prepared = await prepare(result.assets[0].uri);
      setOdoPhoto(prepared);
      setOdoShot(prepared.uri);

      setOdoScanning(true);
      try {
        const recognised = await TextRecognition.recognize(prepared.uri);
        const reading = readOdometer(recognised.blocks.flatMap((b) => b.lines));
        if (reading.odometerKm !== null) {
          setOdometerKm(String(reading.odometerKm));
        } else {
          // Naming the miss is what sends a driver back for a sharper photo
          // instead of leaving them to decide the app is broken.
          setOdoNote(t("receipt.odoNotRead"));
        }
        if (reading.rangeKm !== null) setRangeKm(String(reading.rangeKm));
      } catch {
        setOdoNote(t("receipt.odoScanFailed"));
      } finally {
        setOdoScanning(false);
      }
    } catch {
      toast.show(t("receipt.photoFailed"));
    } finally {
      setBusy(false);
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
    // The last wall, and it asks the SAME function the steps do. A second copy
    // of this list would drift the first time one of them changed, and the
    // driver would be refused on the final screen for a field two steps back.
    const problem = submitProblem(formState);
    if (problem !== null) {
      toast.show(t(problem));
      return;
    }
    const wire = toWireAmount(amount);
    const wireLitres = category === "Tanken" ? toWireDecimal(litres, 2) : null;
    const wirePrice = category === "Tanken" ? toWireDecimal(pricePerLitre, 3) : null;
    // `submitProblem` already refused every unreadable figure, so these are
    // non-null here. The check is kept because TypeScript cannot know that and
    // because a silent `null` would reach the wire as a missing amount.
    if (wire === null) {
      toast.show(t("receipt.amountInvalid"));
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
        merchant_name: merchant.trim(),
        city: city.trim(),
        receipt_time: receiptTime.trim(),
        // Null on anything that is not fuel, never an empty string: the other
        // side stores a numeric column and '' is not a number.
        litres: wireLitres,
        price_per_litre: wirePrice,
        // Null on anything that is not fuel. The range is the fuel reading:
        // the gauge is a bar of lit blocks that nothing could read, and
        // `199 km left` is a figure a fleet manager can act on anyway.
        odometer_km: category === "Tanken" ? odometerKm.trim() : null,
        range_km: category === "Tanken" && rangeKm.trim() !== "" ? rangeKm.trim() : null,
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

        {/* Where the driver is, and what this step is for. Two lines rather
            than a progress bar: a bar shows how far along you are, and what a
            driver needs to know is what is being asked of them now. */}
        <View style={{ gap: 4 }}>
          <Text style={{ color: c.inkSubtle, fontSize: 12.5 }}>
            {t("receipt.stepOf", { n: String(stepIndex + 1), total: String(steps.length) })}
          </Text>
          <Text style={{ color: c.ink, fontWeight: "700", fontSize: 17 }}>
            {step === "photo" ? t("receipt.stepPhoto")
              : step === "details" ? t("receipt.stepDetails")
              : step === "fuel" ? t("receipt.stepFuel")
              : step === "odometer" ? t("receipt.stepOdometer")
              : t("receipt.stepConfirm")}
          </Text>
        </View>

        {step === "photo" && (
        <>
        <View style={{ ...cardStyle(c), padding: 16, gap: 6 }}>
          <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("receipt.photoIntro")}</Text>
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
            {galleryAllowed && (
              <PhotoButton c={c} icon={ImageIcon} label={t("receipt.fromLibrary")} busy={busy} onPress={() => void take("library")} />
            )}
          </View>
        )}

        {/* Said once the read is done, so the driver knows the next screen is
            a check and not a form to fill from nothing. */}
        {photo !== null && !scanning && (
          <Text style={{ color: c.inkSubtle, fontSize: 12.5, textAlign: "center" }}>
            {t("receipt.photoRead")}
          </Text>
        )}
        </>
        )}

        {step === "details" && (
        <>
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
          label={t("receipt.merchant")}
          value={merchant}
          onChangeText={setMerchant}
          placeholder={t("receipt.merchantHint")}
        />

        <Field
          label={t("receipt.time")}
          value={receiptTime}
          onChangeText={setReceiptTime}
          placeholder="14:32"
          keyboardType="numbers-and-punctuation"
        />

        <Field
          label={t("receipt.plz")}
          value={plz}
          onChangeText={setPlz}
          placeholder="10179"
          keyboardType="number-pad"
        />

        <Field
          label={t("receipt.city")}
          value={city}
          onChangeText={setCity}
          placeholder="Berlin"
        />

        </>
        )}

        {/* Fuel only, and the step only exists on a refuel — `stepsFor` is
            what decides that, so the category is not re-tested here. */}
        {step === "fuel" && (
          <>
            <View style={{ ...cardStyle(c), padding: 16, gap: 6 }}>
              <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("receipt.fuelIntro")}</Text>
            </View>

            <Field
              label={t("receipt.litres")}
              value={litres}
              onChangeText={setLitres}
              placeholder="41,47"
              keyboardType="decimal-pad"
            />
            <Field
              label={t("receipt.pricePerLitre")}
              value={pricePerLitre}
              onChangeText={setPricePerLitre}
              placeholder="1,789"
              keyboardType="decimal-pad"
            />

          </>
        )}

        {/* The cluster is a different act from reading the receipt: a different
            object, photographed at a different moment. It used to be two fields
            under the litres, which made a MANDATORY capture read as optional. */}
        {step === "odometer" && (
          <>
            <View style={{ ...cardStyle(c), padding: 16, gap: 6 }}>
              <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("receipt.odoIntro")}</Text>
            </View>

            {odoPhoto ? (
              <View style={{ ...cardStyle(c), padding: 12, gap: 10 }}>
                <Image
                  source={{ uri: odoPhoto.uri }}
                  style={{ width: "100%", height: 180, borderRadius: radius.md, backgroundColor: c.surface2 }}
                  resizeMode="contain"
                  accessibilityLabel={t("receipt.odoAlt")}
                />
                {odoNote !== null && (
                  <Text style={{ color: c.inkMuted, fontSize: 13, textAlign: "center" }}>{odoNote}</Text>
                )}
                <Text style={{ color: c.inkSubtle, fontSize: 12.5, textAlign: "center" }}>
                  {t("receipt.photoStaysHere")}
                </Text>
                <Pressable
                  onPress={() => { setOdoPhoto(null); setOdoNote(null); }}
                  accessibilityRole="button"
                  style={{ flexDirection: row, alignItems: "center", justifyContent: "center", gap: 6 }}
                >
                  <X size={16} color={c.danger} strokeWidth={2} />
                  <Text style={{ color: c.danger, fontWeight: "700", fontSize: 13.5 }}>{t("receipt.photoRemove")}</Text>
                </Pressable>
              </View>
            ) : (
              <PhotoButton c={c} icon={Camera} label={t("receipt.odoTake")} busy={busy} onPress={() => void takeOdometer()} />
            )}

            <Field
              label={t("receipt.odometer")}
              value={odometerKm}
              onChangeText={setOdometerKm}
              placeholder="25382"
              keyboardType="number-pad"
            />
            {/* The range, not a gauge position: it is the only fuel figure on
                the panel that is text, and it says something actionable. */}
            <Field
              label={t("receipt.range")}
              value={rangeKm}
              onChangeText={setRangeKm}
              placeholder="277"
              keyboardType="number-pad"
            />
          </>
        )}

        {step === "confirm" && (
          <>
            <View style={{ ...cardStyle(c), padding: 16, gap: 6 }}>
              <Text style={{ color: c.inkMuted, fontSize: 13 }}>{t("receipt.confirmIntro")}</Text>
            </View>

            {/* Everything that will be sent, in one place. The photo is not
                shown again: it does not travel, and showing it here would
                suggest the company receives it. */}
            <View style={{ ...cardStyle(c), padding: 16, gap: 10 }}>
              <SummaryRow c={c} row={row} label={t("receipt.date")} value={date} />
              <SummaryRow c={c} row={row} label={t("receipt.amount")} value={`${amount} €`} />
              <SummaryRow
                c={c}
                row={row}
                label={t("receipt.category")}
                value={category ?? description.trim()}
              />
              <SummaryRow
                c={c}
                row={row}
                label={t("receipt.payment")}
                value={method === "bar" ? t("receipt.cash") : t("receipt.transfer")}
              />
              <SummaryRow c={c} row={row} label={t("receipt.merchant")} value={merchant} />
              <SummaryRow c={c} row={row} label={t("receipt.time")} value={receiptTime} />
              <SummaryRow c={c} row={row} label={t("receipt.city")} value={city} />
              <SummaryRow c={c} row={row} label={t("receipt.plz")} value={plz} />
              {category === "Tanken" && (
                <>
                  <SummaryRow c={c} row={row} label={t("receipt.litres")} value={litres} />
                  <SummaryRow c={c} row={row} label={t("receipt.pricePerLitre")} value={pricePerLitre} />
                  <SummaryRow c={c} row={row} label={t("receipt.odometer")} value={odometerKm} />
                  <SummaryRow c={c} row={row} label={t("receipt.range")} value={rangeKm} />
                </>
              )}
            </View>
          </>
        )}

        {/* The way forward and the way back, always in the same place. The
            last step sends instead of advancing; nothing else changes. */}
        {step !== "confirm" ? (
          <>
            <PrimaryButton label={t("receipt.next")} onPress={goNext} disabled={busy || sending} />
            {/* The reason this step will not let go, said before it is tapped
                rather than as a toast afterwards. */}
            {blocker !== null && (
              <Text style={{ color: c.inkSubtle, fontSize: 12.5, textAlign: "center" }}>
                {t(blocker)}
              </Text>
            )}
          </>
        ) : (
        <PrimaryButton
          label={sending ? t("receipt.sending") : t("receipt.send")}
          onPress={() => void submit()}
          disabled={sending || busy || scanning || checkDate || checkAmount || !photo || !connected}
        />
        )}

        <Pressable onPress={goBack} accessibilityRole="button" style={{ paddingVertical: 10 }}>
          <Text style={{ color: c.inkMuted, fontSize: 13.5, textAlign: "center", fontWeight: "700" }}>
            {t("receipt.back")}
          </Text>
        </Pressable>
      </ScrollView>

      {/* The popup the owner asked for. The camera itself is a system sheet, so
          what a modal adds is the moment AFTER it: the shot, the reading, and
          the two figures, over the form instead of buried in it. It cannot be
          dismissed while the read is running — a half-read cluster that looks
          dismissed is how a driver sends yesterday's number. */}
      <Modal
        visible={odoShot !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!odoScanning) setOdoShot(null); }}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 16, gap: 12 }}>
            <Text style={{ color: c.ink, fontWeight: "700", fontSize: 16 }}>{t("receipt.odoSection")}</Text>
            <Image
              source={{ uri: odoShot ?? "" }}
              style={{ width: "100%", height: 200, borderRadius: radius.md, backgroundColor: c.surface2 }}
              resizeMode="contain"
              accessibilityLabel={t("receipt.odoAlt")}
            />
            {odoScanning ? (
              <View style={{ flexDirection: row, alignItems: "center", justifyContent: "center", gap: 8 }}>
                <ActivityIndicator color={c.ink} />
                <Text style={{ color: c.inkMuted, fontSize: 13.5 }}>{t("receipt.odoReading")}</Text>
              </View>
            ) : (
              <>
                {odoNote !== null && (
                  <Text style={{ color: c.inkMuted, fontSize: 13, textAlign: "center" }}>{odoNote}</Text>
                )}
                <Field
                  label={t("receipt.odometer")}
                  value={odometerKm}
                  onChangeText={setOdometerKm}
                  placeholder="25382"
                  keyboardType="number-pad"
                />
                <Field
                  label={t("receipt.range")}
                  value={rangeKm}
                  onChangeText={setRangeKm}
                  placeholder="277"
                  keyboardType="number-pad"
                />
                <PrimaryButton label={t("receipt.odoKeep")} onPress={() => setOdoShot(null)} />
                {/* Retake throws the photo away with it: keeping a photo whose
                    figures were rejected is how the two drift apart. */}
                <Pressable
                  onPress={() => { setOdoShot(null); setOdoPhoto(null); setOdoNote(null); }}
                  accessibilityRole="button"
                  style={{ paddingVertical: 10 }}
                >
                  <Text style={{ color: c.danger, fontSize: 13.5, textAlign: "center", fontWeight: "700" }}>
                    {t("receipt.odoRetake")}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** One label-and-value line of the confirmation, with a dash when empty. */
function SummaryRow({
  c,
  row,
  label,
  value,
}: {
  c: Palette;
  row: "row" | "row-reverse";
  label: string;
  value: string;
}) {
  return (
    <View style={{ flexDirection: row, alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <Text style={{ color: c.inkMuted, fontSize: 13 }}>{label}</Text>
      <Text
        style={{ color: c.ink, fontSize: 13.5, fontWeight: "700", flexShrink: 1, textAlign: isRTL() ? "left" : "right" }}
      >
        {value.trim() === "" ? t("receipt.notGiven") : value}
      </Text>
    </View>
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
