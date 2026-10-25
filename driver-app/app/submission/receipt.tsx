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
 * ## Nothing is typed (owner, 25.10.2026)
 *
 * Every field is read-only. The driver photographs; OCR reads; a photo that
 * does not yield every required field is refused with a reason and retaken
 * (`scan-quality.ts`). There is no manual entry and no send-anyway. Chips and
 * the confirm tap are taps, not typing, and stay.
 *
 * ## The OCR is given the best image we have
 *
 * It used to read a 1600px-WIDE, JPEG-0.7 copy: downscaled, lossy, and
 * upscaled when the source was narrower. See `ocr-image.ts` for the rule now
 * (never enlarge, cap the true long edge at 4096, quality 0.95). The
 * re-encode stays because it drops the EXIF of the cached copy, which would
 * otherwise carry the driver's home GPS.
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
import { ocrResizeFor, OCR_QUALITY } from "@/lib/ocr-image";
import { evaluateScan, evaluateOdometer, type ImageSize, type RequiredField } from "@/lib/scan-quality";
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

/** The picker's own idea of the shot's size, for the "too far away" test. */
function odoSize(asset: { width?: number; height?: number }): ImageSize | null {
  return asset.width && asset.height ? { width: asset.width, height: asset.height } : null;
}

/** What to tell the driver: the likely cause, then which fields were missed. */
function retakeMessage(messageKey: string, missing: RequiredField[]): string {
  const names = missing.map((f) => t(`receipt.${f}`)).join(", ");
  return `${t(messageKey)}\n${t("receipt.retakeMissing", { fields: names })}`;
}

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
  // Defaults to required: only an explicit false drops the odometer step, so an
  // older server that sends nothing keeps today's flow.
  const odometerRequired = driver?.odometer_required !== false;

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
  // The last scan did not yield every required field. Blocks the photo step.
  const [needsRetake, setNeedsRetake] = useState(false);

  // One description of the form, asked by the step gate AND by the send, so
  // the two can never disagree about what a valid receipt is.
  const formState = {
    photo: { hasPhoto: photo !== null, scanning, needsRetake },
    details: {
      amount, category, description, merchant, city, plz,
      receiptTime,
      unconfirmed: checkDate || checkAmount,
    },
    fuel: { litres, pricePerLitre },
    odometer: { hasOdoPhoto: odoPhoto !== null, odometerKm },
  };

  const steps = stepsFor(category, odometerRequired);
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

  /**
   * Re-encode for OCR at near-lossless quality, shrinking only a source whose
   * true long edge exceeds the cap. The re-encode also strips the EXIF.
   */
  const prepare = async (asset: { uri: string; width?: number; height?: number }): Promise<PickedPhoto> => {
    const resize = ocrResizeFor(asset.width, asset.height);
    const out = await ImageManipulator.manipulateAsync(
      asset.uri,
      resize ? [{ resize }] : [],
      { compress: OCR_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
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
  const scan = async (uri: string, size: ImageSize | null) => {
    setScanNote(null);
    setCheckDate(false);
    setCheckAmount(false);
    setNeedsRetake(false);
    // A previous photo's answers must not survive into this one: nothing can
    // be typed, so a stale field would reach the company as if it were read.
    setDate(today());
    setAmount("");
    setMerchant("");
    setCity("");
    setPlz("");
    setReceiptTime("");
    setLitres("");
    setPricePerLitre("");
    setScanning(true);
    try {
      // The engine's lines are NOT the receipt's rows: on a two-column till
      // roll a label and its figure come back as separate lines, and every
      // "same line" rule in the parser then sees nothing. `rowsFromLines` puts
      // them back by where they sit on the page.
      const result = await TextRecognition.recognize(uri);
      const lines = result.blocks.flatMap((b) => b.lines);
      const text = rowsFromLines(lines).join("\n");
      const r: OcrResult = text.trim() === "" ? {} : parseReceiptText(text);

      // The PLZ is read with a score and the city beside it is a guess at a
      // line of text; the server's table is authoritative and wins whenever
      // it knows the PLZ. Offline or unknown, the OCR's own city stands.
      const authoritative = r.postalCode ? await api.postalCity(r.postalCode) : null;
      const resolvedCity = authoritative ?? r.city ?? "";

      // A category this build does not offer is dropped rather than shown. With
      // none read, fuel figures still say it is a refuel; with neither, the
      // category is left for the driver's tap and the fuel fields are not
      // demanded here (a car wash must not loop on "litres not read").
      const parsed = (CATEGORIES as readonly string[]).includes(r.category ?? "") ? (r.category as string) : null;
      const sawFuelFigures = r.litres !== undefined || r.pricePerLitre !== undefined;
      const effective = parsed ?? (sawFuelFigures ? "Tanken" : null);
      if (effective !== null) setCategory(effective);

      if (r.date) {
        setDate(r.date);
        setCheckDate(r.dateReason?.startsWith("Unsicher") === true);
      }
      if (r.amount !== undefined) {
        setAmount(formatAmountDE(r.amount));
        setCheckAmount(r.amountReason?.startsWith("Unsicher") === true);
      }
      if (r.postalCode) setPlz(r.postalCode);
      if (r.merchantName) setMerchant(r.merchantName);
      if (resolvedCity) setCity(resolvedCity);
      if (r.time) setReceiptTime(r.time);
      // German decimals on screen, converted once on the way out.
      if (r.litres !== undefined) setLitres(r.litres.toFixed(2).replace(".", ","));
      if (r.pricePerLitre !== undefined) {
        setPricePerLitre(r.pricePerLitre.toFixed(3).replace(".", ","));
      }

      // The gate. Every field the send requires must have been READ; a photo
      // that missed any is retaken, and the message names what was missed and
      // the most likely reason, so the next photo is not the same one.
      const verdict = evaluateScan(
        lines,
        {
          date: r.date,
          amount: r.amount,
          merchant: r.merchantName,
          time: r.time,
          city: resolvedCity,
          litres: r.litres,
          pricePerLitre: r.pricePerLitre,
          fuel: effective === "Tanken",
        },
        size,
      );
      if (!verdict.ok) {
        setNeedsRetake(true);
        setScanNote(retakeMessage(verdict.messageKey, verdict.missing));
      }
    } catch {
      setNeedsRetake(true);
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
    // A new photo starts from nothing: the previous reading must not outlive it.
    setOdometerKm("");
    setRangeKm("");
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t("receipt.permTitle"), t("receipt.permBody"));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 1, exif: false });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const prepared = await prepare(result.assets[0]);
      setOdoPhoto(prepared);
      setOdoShot(prepared.uri);

      setOdoScanning(true);
      try {
        const recognised = await TextRecognition.recognize(prepared.uri);
        const odoLines = recognised.blocks.flatMap((b) => b.lines);
        const reading = readOdometer(odoLines);
        const verdict = evaluateOdometer(odoLines, reading.odometerKm, odoSize(result.assets[0]));
        if (reading.odometerKm !== null) {
          setOdometerKm(String(reading.odometerKm));
        } else {
          // The rule abstained, and nothing can be typed, so abstaining means
          // RETAKE: the photo is dropped, which makes the step refuse to
          // advance (`odoPhotoRequired`) until a readable one is taken.
          setOdoNote(verdict.ok ? t("receipt.odoNotRead") : `${t(verdict.messageKey)}\n${t("receipt.odoNotRead")}`);
          setOdoPhoto(null);
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
      const prepared = await prepare(result.assets[0]);
      setPhoto(prepared);
      await scan(prepared.uri, odoSize(result.assets[0]));
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
    const problem = submitProblem(formState, odometerRequired);
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
        // Both null when the company switched the step off: the range is only
        // ever collected inside it.
        odometer_km: category === "Tanken" && odometerRequired ? odometerKm.trim() : null,
        range_km:
          category === "Tanken" && odometerRequired && rangeKm.trim() !== "" ? rangeKm.trim() : null,
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
              onPress={() => { setPhoto(null); setScanNote(null); setCheckDate(false); setCheckAmount(false); setNeedsRetake(false); }}
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
        {photo !== null && !scanning && !needsRetake && (
          <Text style={{ color: c.inkSubtle, fontSize: 12.5, textAlign: "center" }}>
            {t("receipt.photoRead")}
          </Text>
        )}
        </>
        )}

        {step === "details" && (
        <>
        {/* Read-only: the values come from the photo. A flagged field is
            cleared only by the confirm tap below it. */}
        <Field
          label={t("receipt.date")}
          value={date}
          editable={false}
          placeholder="2026-10-07"
          autoCapitalize="none"
        />
        {checkDate && <NeedsCheck c={c} row={row} onConfirm={() => setCheckDate(false)} />}

        <Field
          label={t("receipt.amount")}
          value={amount}
          editable={false}
          placeholder="41,47"
        />
        {checkAmount && <NeedsCheck c={c} row={row} onConfirm={() => setCheckAmount(false)} />}

        <SectionLabel>{t("receipt.category")}</SectionLabel>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {CATEGORIES.map((item) => (
            <Chip key={item} c={c} label={item} active={category === item} onPress={() => { setCategory(item); }} />
          ))}
          {/* No "Other": it needs a typed subject, and nothing is typed. */}
        </View>

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
          editable={false}
          placeholder={t("receipt.merchantHint")}
        />

        <Field
          label={t("receipt.time")}
          value={receiptTime}
          editable={false}
          placeholder="14:32"
        />

        <Field
          label={t("receipt.plz")}
          value={plz}
          editable={false}
          placeholder="10179"
        />

        <Field
          label={t("receipt.city")}
          value={city}
          editable={false}
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
              editable={false}
              placeholder="41,47"
            />
            <Field
              label={t("receipt.pricePerLitre")}
              value={pricePerLitre}
              editable={false}
              placeholder="1,789"
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
              editable={false}
              placeholder="25382"
            />
            {/* The range, not a gauge position: it is the only fuel figure on
                the panel that is text, and it says something actionable. */}
            <Field
              label={t("receipt.range")}
              value={rangeKm}
              editable={false}
              placeholder="277"
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
                  {odometerRequired && (
                    <>
                      <SummaryRow c={c} row={row} label={t("receipt.odometer")} value={odometerKm} />
                      <SummaryRow c={c} row={row} label={t("receipt.range")} value={rangeKm} />
                    </>
                  )}
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
                  editable={false}
                  placeholder="25382"
                />
                <Field
                  label={t("receipt.range")}
                  value={rangeKm}
                  editable={false}
                  placeholder="277"
                />
                {/* Nothing read means nothing to keep: with no typing, the only
                    way forward is the retake below. */}
                {odometerKm !== "" && <PrimaryButton label={t("receipt.odoKeep")} onPress={() => setOdoShot(null)} />}
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
