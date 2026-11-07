import { useCallback, useEffect, useState } from "react";
import { View, Pressable, TextInput, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Text } from "@/components/typography";
import { PrimaryButton } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { t, isRTL } from "@/lib/i18n";
import { useColors, cardStyle } from "@/lib/theme";

/**
 * Our own star rating card (Home). Apple/Google never let an app read the user's
 * store rating, so we capture the stars ourselves and only hand HAPPY drivers
 * (>= 4) to the native store prompt. Low scores get a feedback box that goes to
 * our backend only, never to a store.
 *
 * Trigger (all must hold): driver mode (not owner), the driver has opened Home on
 * >= MIN_DAYS distinct days, has at least one finished ride (`positive`), has not
 * submitted a rating, and was not shown the card within SNOOZE_DAYS. Showing the
 * card itself starts the snooze, so a dismiss or a force-quit never re-asks soon.
 */
const MIN_DAYS = 3;
const SNOOZE_DAYS = 90;
const DAY_MS = 86_400_000;

interface RatingState {
  days: string[];
  lastPromptAt: number | null;
  submitted: boolean;
}

const EMPTY: RatingState = { days: [], lastPromptAt: null, submitted: false };

// Per driver, not per device: a shared phone asks each driver separately.
const stateKey = (driverId: number) => `rating_state_${driverId}`;

async function loadState(driverId: number): Promise<RatingState> {
  try {
    const raw = await SecureStore.getItemAsync(stateKey(driverId));
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<RatingState>) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

function saveState(driverId: number, state: RatingState): void {
  SecureStore.setItemAsync(stateKey(driverId), JSON.stringify(state)).catch(() => {});
}

/** Local calendar day, Latin digits (YYYY-MM-DD). */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isDue(state: RatingState, now: number): boolean {
  if (state.submitted || state.days.length < MIN_DAYS) return false;
  return state.lastPromptAt === null || now - state.lastPromptAt >= SNOOZE_DAYS * DAY_MS;
}

/** The native store prompt — only where the OS offers it; never throws. */
async function askStore(): Promise<boolean> {
  try {
    const StoreReview = await import("expo-store-review");
    if (!(await StoreReview.isAvailableAsync())) return false;
    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  }
}

type Step = "ask" | "feedback" | "thanks";

export function RatingPrompt({ positive }: { positive: boolean }) {
  const c = useColors();
  const { driver, isOwner } = useAuth();
  const driverId = driver?.id;
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>("ask");
  const [stars, setStars] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const row = isRTL() ? "row-reverse" : "row";
  const align = isRTL() ? "right" : "left";

  // Count today as an active day; once due, show the card and start the snooze.
  useEffect(() => {
    if (isOwner || driverId == null || !positive) return;
    let alive = true;
    (async () => {
      const state = await loadState(driverId);
      const day = today();
      const days = state.days.includes(day) ? state.days : [...state.days, day].slice(-10);
      const due = isDue({ ...state, days }, Date.now());
      saveState(driverId, { ...state, days, lastPromptAt: due ? Date.now() : state.lastPromptAt });
      if (alive && due) setVisible(true);
    })();
    return () => {
      alive = false;
    };
  }, [isOwner, driverId, positive]);

  const send = useCallback(
    (value: number, text?: string) =>
      api
        .submitAppRating({
          stars: value,
          feedback: text?.trim() ? text.trim() : undefined,
          platform: Platform.OS === "ios" ? "ios" : "android",
          app_version: Constants.expoConfig?.version,
        })
        .then(() => true)
        .catch(() => false),
    [],
  );

  const markSubmitted = useCallback(async () => {
    if (driverId == null) return;
    saveState(driverId, { ...(await loadState(driverId)), submitted: true });
  }, [driverId]);

  async function pick(value: number) {
    if (busy) return;
    setBusy(true);
    setStars(value);
    if (await send(value)) await markSubmitted();
    setBusy(false);
    if (value >= 4) {
      setStep("thanks");
      void askStore();
    } else {
      setStep("feedback");
    }
  }

  async function sendFeedback() {
    setBusy(true);
    if (feedback.trim()) await send(stars, feedback);
    setBusy(false);
    setStep("thanks");
  }

  if (!visible) return null;

  return (
    <View style={[cardStyle(c), { padding: 16, gap: 12 }]}>
      <View style={{ flexDirection: row, alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <Text style={{ flex: 1, color: c.ink, fontSize: 16, fontWeight: "700", textAlign: align }}>
          {step === "thanks" ? t("rating.thanks") : step === "feedback" ? t("rating.feedbackPrompt") : t("rating.title")}
        </Text>
        <Pressable onPress={() => setVisible(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("rating.dismiss")}>
          <Text style={{ color: c.inkSubtle, fontSize: 18 }}>×</Text>
        </Pressable>
      </View>

      {step === "ask" && (
        <>
          <Text style={{ color: c.inkMuted, fontSize: 13.5, textAlign: align }}>{t("rating.sub")}</Text>
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 8 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => void pick(n)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${n} / 5`}>
                <Text style={{ fontSize: 36, color: n <= stars ? c.accent : c.inkFaint }}>{n <= stars ? "★" : "☆"}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {step === "feedback" && (
        <>
          <TextInput
            value={feedback}
            onChangeText={setFeedback}
            placeholder={t("rating.placeholder")}
            placeholderTextColor={c.inkFaint}
            multiline
            maxLength={1000}
            style={{
              ...cardStyle(c, true),
              minHeight: 90,
              paddingHorizontal: 12,
              paddingVertical: 10,
              textAlignVertical: "top",
              color: c.ink,
              fontSize: 14.5,
              textAlign: align,
            }}
          />
          <View style={{ flexDirection: row, gap: 10, alignItems: "center" }}>
            <PrimaryButton label={t("rating.send")} onPress={() => void sendFeedback()} loading={busy} style={{ flex: 1 }} />
            <Pressable onPress={() => setVisible(false)} hitSlop={8}>
              <Text style={{ color: c.inkMuted, fontSize: 14, fontWeight: "600" }}>{t("rating.skip")}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}
