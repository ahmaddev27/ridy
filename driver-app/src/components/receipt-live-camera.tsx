/**
 * Live, guided receipt capture (docs/26, Option B).
 *
 * Full-screen camera preview. Every `FRAME_INTERVAL_MS` it snaps a SMALL frame,
 * runs the same on-device ML Kit OCR + `parseReceiptText` the still-photo flow
 * uses, and feeds the result to the pure decisions in `@/lib/receipt-live`
 * (coverage %, one guidance hint, auto-capture). When the read is complete and
 * steady - or the driver taps the shutter - ONE full-resolution photo is taken
 * and handed to the caller, which runs it through the existing parse / vision
 * fallback / confirm flow unchanged.
 *
 * DSGVO: the preview frames never leave the phone and are deleted as soon as
 * they have been read. Only the final photo continues, exactly as today.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, Modal, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { File } from "expo-file-system";
import TextRecognition from "@react-native-ml-kit/text-recognition";
import { X } from "@/components/icons";
import { Text } from "@/components/typography";
import { t, isRTL } from "@/lib/i18n";
import { rowsFromLines } from "@/lib/ocr-lines";
import { ocrResizeFor } from "@/lib/ocr-image";
import { parseReceiptText } from "@/lib/receipt-text-parse";
import {
  INITIAL_HINT,
  INITIAL_STABILITY,
  advanceStability,
  coverageScore,
  debounceHint,
  rawHint,
  shouldAutoCapture,
  signalsFrom,
  type HintState,
  type StabilityState,
} from "@/lib/receipt-live";

/** Pause between the end of one frame's read and the next snapshot. */
const FRAME_INTERVAL_MS = 400;
/** Long edge of a preview frame: plenty for line positions, cheap to read. */
const FRAME_EDGE = 1280;
const FRAME_QUALITY = 0.5;
/** The still photo, same as the picker flow (`quality: 1`). */
const FINAL_QUALITY = 1;

export interface LiveCapture {
  uri: string;
  width: number;
  height: number;
  exif?: Record<string, unknown>;
}

interface Props {
  visible: boolean;
  onCaptured: (shot: LiveCapture) => void;
  onClose: () => void;
}

function discard(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    // Cache files are cleared by the OS anyway; a failed delete is harmless.
  }
}

export function ReceiptLiveCamera({ visible, onCaptured, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [coverage, setCoverage] = useState(0);
  const [hintKey, setHintKey] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const stability = useRef<StabilityState>(INITIAL_STABILITY);
  const hint = useRef<HintState>(INITIAL_HINT);
  const active = useRef(false);
  const taking = useRef(false);

  const takeFinal = useCallback(async () => {
    if (taking.current || !camera.current) return;
    taking.current = true;
    setCapturing(true);
    try {
      const shot = await camera.current.takePictureAsync({ quality: FINAL_QUALITY, exif: true, shutterSound: false });
      if (shot?.uri) onCaptured({ uri: shot.uri, width: shot.width, height: shot.height, exif: shot.exif });
    } catch {
      taking.current = false;
      setCapturing(false);
    }
  }, [onCaptured]);

  const readFrame = useCallback(async (): Promise<boolean> => {
    const snap = await camera.current?.takePictureAsync({ quality: FRAME_QUALITY, skipProcessing: true, shutterSound: false });
    if (!snap?.uri) return false;
    let small: ImageManipulator.ImageResult | null = null;
    try {
      const resize = ocrResizeFor(snap.width, snap.height, FRAME_EDGE);
      small = await ImageManipulator.manipulateAsync(snap.uri, resize ? [{ resize }] : [], {
        compress: FRAME_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const result = await TextRecognition.recognize(small.uri);
      const lines = result.blocks.flatMap((b) => b.lines);
      const text = rowsFromLines(lines).join("\n");
      const parsed = text.trim() === "" ? {} : parseReceiptText(text);

      stability.current = advanceStability(stability.current, parsed);
      const score = coverageScore(parsed, stability.current.streak);
      const ready = shouldAutoCapture(score, stability.current.streak);
      const signals = { ...signalsFrom(lines, small.width, small.height), ready };
      hint.current = debounceHint(hint.current, rawHint(signals));
      setCoverage(score);
      setHintKey(hint.current.shown);
      return ready;
    } finally {
      discard(snap.uri);
      if (small) discard(small.uri);
    }
  }, []);

  useEffect(() => {
    if (!visible || !permission?.granted) return;
    active.current = true;
    taking.current = false;
    stability.current = INITIAL_STABILITY;
    hint.current = INITIAL_HINT;
    setCoverage(0);
    setHintKey(null);
    setCapturing(false);
    const loop = async () => {
      // Let the preview start before the first snapshot.
      await new Promise((r) => setTimeout(r, 800));
      while (active.current && !taking.current) {
        try {
          if (await readFrame()) {
            if (active.current) await takeFinal();
            return;
          }
        } catch {
          // One bad frame (camera busy, OCR hiccup) must not end the scan.
        }
        await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
      }
    };
    void loop();
    return () => {
      active.current = false;
    };
  }, [visible, permission?.granted, readFrame, takeFinal]);

  const rtl = isRTL();
  const message = hintKey ? t(hintKey) : t("receipt.live.hintNoText");

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        {permission?.granted ? (
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" animateShutter={false} />
        ) : (
          <PermissionGate onRequest={() => void requestPermission()} onClose={onClose} />
        )}
        <SafeAreaView style={styles.overlay} pointerEvents="box-none">
          <View style={[styles.header, { flexDirection: rtl ? "row-reverse" : "row" }]}>
            <Meter coverage={coverage} rtl={rtl} />
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("receipt.live.close")}
              hitSlop={12}
              style={styles.close}
            >
              <X size={20} color="#fff" strokeWidth={2} />
            </Pressable>
          </View>
          <View style={styles.footer} pointerEvents="box-none">
            <View style={styles.chip} accessibilityLiveRegion="polite">
              <Text style={styles.chipText}>{message}</Text>
            </View>
            <Pressable
              onPress={() => void takeFinal()}
              disabled={capturing}
              accessibilityRole="button"
              accessibilityLabel={t("receipt.live.shutter")}
              style={styles.shutterOuter}
            >
              {capturing ? <ActivityIndicator color="#000" /> : <View style={styles.shutterInner} />}
            </Pressable>
          </View>
        </SafeAreaView>
        {capturing && <View style={styles.flash} pointerEvents="none" />}
      </View>
    </Modal>
  );
}

function Meter({ coverage, rtl }: { coverage: number; rtl: boolean }) {
  return (
    <View style={styles.meter} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: coverage }}>
      <View style={[styles.meterRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
        <Text style={styles.meterLabel}>{t("receipt.live.meter")}</Text>
        {/* String(n) is always Latin digits, also in Arabic. */}
        <Text style={styles.meterValue}>{`${String(coverage)}%`}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${coverage}%`, alignSelf: rtl ? "flex-end" : "flex-start" }]} />
      </View>
    </View>
  );
}

function PermissionGate({ onRequest, onClose }: { onRequest: () => void; onClose: () => void }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.gate]}>
      <Text style={styles.chipText}>{t("receipt.permBody")}</Text>
      <Pressable onPress={onRequest} accessibilityRole="button" style={styles.gateButton}>
        <Text style={styles.gateButtonText}>{t("receipt.live.title")}</Text>
      </Pressable>
      <Pressable onPress={onClose} accessibilityRole="button" hitSlop={10}>
        <Text style={styles.chipText}>{t("receipt.live.close")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  overlay: { flex: 1, justifyContent: "space-between" },
  header: { alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
  meter: { flex: 1, gap: 6, padding: 10, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.55)" },
  meterRow: { justifyContent: "space-between" },
  meterLabel: { color: "#fff", fontSize: 12.5, fontWeight: "600" },
  meterValue: { color: "#fff", fontSize: 12.5, fontWeight: "700" },
  track: { height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.25)" },
  fill: { height: 6, borderRadius: 3, backgroundColor: "#34d399" },
  footer: { alignItems: "center", gap: 16, paddingBottom: 24, paddingHorizontal: 16 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.65)" },
  chipText: { color: "#fff", fontSize: 14.5, fontWeight: "600", textAlign: "center" },
  shutterOuter: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.35)" },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#fff" },
  flash: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(255,255,255,0.6)" },
  gate: { alignItems: "center", justifyContent: "center", gap: 20, padding: 32 },
  gateButton: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: "#fff" },
  gateButtonText: { color: "#000", fontWeight: "700", fontSize: 14.5 },
});
