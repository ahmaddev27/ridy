import { memo, useEffect, useState } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Text } from "@/components/typography";
import { useColors, type Palette } from "@/lib/theme";

/**
 * The accept-window countdown, in ONE place.
 *
 * Two surfaces race the same five seconds — the offer detail screen and the
 * instant offer pop-up — and they must never show a driver two different
 * "seconds left" for the same offer. So the clock, the colour ramp, the ring and
 * the label all live here; a surface only decides the size and where to put them.
 */

/** Geometry of the hero ring on the offer detail screen (also the default size). */
export const RING = 216;
export const STROKE = 10;
export const RING_R = (RING - STROKE) / 2;
export const RING_CIRC = 2 * Math.PI * RING_R;

/** Accept-window fallback (seconds) when the offer carries no real window. */
export const COUNTDOWN_FALLBACK_SECONDS = 10;

/** The offer's real accept window in seconds, falling back to the default. */
export function acceptWindow(offer: { accept_window_seconds?: number | null } | null | undefined): number {
  return offer?.accept_window_seconds ?? COUNTDOWN_FALLBACK_SECONDS;
}

/** First of the given times that parses, as epoch ms (a number is already one). */
function firstTime(...values: (string | number | null | undefined)[]): number | null {
  for (const value of values) {
    const ms = typeof value === "number" ? value : value ? Date.parse(value) : NaN;
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/**
 * Deadline of the accept window (ms epoch), or null without a usable start time.
 *
 * Counts from Uber's OWN `offer_generated_at` whenever the payload carries it,
 * and only falls back to when we received the offer. The two differ by our
 * ingest latency, and counting from `received_at` would quietly hand the driver
 * that latency back as time they do not have — the ring would still read 5,0 s
 * on an offer Uber is about to expire. The real remaining window is the honest
 * number to decide on, even when it is already short.
 */
export function deadlineOf(
  receivedAt: string | null | undefined,
  windowSeconds: number,
  generatedAt?: string | number | null,
): number | null {
  const start = firstTime(generatedAt, receivedAt);
  return start === null ? null : start + windowSeconds * 1000;
}

/**
 * Seconds left in the accept window, re-rendering ONLY the component that uses
 * it, and only when the shown tenth changes (100 ms ticks) — the rest of the
 * offer screen no longer re-renders every animation frame.
 */
export function useSecondsLeft(deadline: number | null, active: boolean): number | null {
  const compute = () => (deadline === null ? null : Math.max(0, Math.round((deadline - Date.now()) / 100) / 10));
  const [left, setLeft] = useState(compute);
  useEffect(() => {
    setLeft(compute());
    if (deadline === null || !active || Date.now() >= deadline) return;
    const id = setInterval(() => {
      const next = compute();
      setLeft((prev) => (prev === next ? prev : next));
      if (Date.now() >= deadline) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [deadline, active]);
  return left;
}

/** True until the deadline passes — flips once (a single timeout, no ticking). */
export function useWindowOpen(deadline: number | null, active: boolean): boolean {
  const [open, setOpen] = useState(() => deadline !== null && active && Date.now() < deadline);
  useEffect(() => {
    const isOpen = deadline !== null && active && Date.now() < deadline;
    setOpen(isOpen);
    if (!isOpen || deadline === null) return;
    const id = setTimeout(() => setOpen(false), deadline - Date.now());
    return () => clearTimeout(id);
  }, [deadline, active]);
  return open;
}

export function ringColorFor(pct: number, c: Palette): string {
  return pct > 0.5 ? c.completed : pct > 0.25 ? c.pending : c.canceled;
}

/** Share of the window still left, clamped to 0…1. */
function fractionLeft(left: number, windowSeconds: number): number {
  return windowSeconds > 0 ? Math.max(0, Math.min(1, left / windowSeconds)) : 0;
}

/** The depleting countdown arc, drawn over the static track. */
export const CountdownArc = memo(function CountdownArc({
  deadline,
  windowSeconds,
  size = RING,
  stroke = STROKE,
}: {
  deadline: number | null;
  windowSeconds: number;
  size?: number;
  stroke?: number;
}) {
  const c = useColors();
  const left = useSecondsLeft(deadline, true);
  if (left === null) return null;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = fractionLeft(left, windowSeconds);
  return (
    <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
      <Circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={ringColorFor(pct, c)} strokeWidth={stroke} fill="none" strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
      />
    </Svg>
  );
});

/** The live "4.2s" label under the fare. */
export const CountdownLabel = memo(function CountdownLabel({
  deadline,
  windowSeconds,
  fontSize = 16,
}: {
  deadline: number | null;
  windowSeconds: number;
  fontSize?: number;
}) {
  const c = useColors();
  const left = useSecondsLeft(deadline, true);
  if (left === null) return null;
  const pct = fractionLeft(left, windowSeconds);
  return (
    <Text style={{ color: ringColorFor(pct, c), fontSize, fontWeight: "600", marginTop: 6, writingDirection: "ltr" }}>
      {`${left.toFixed(1)}s`}
    </Text>
  );
});

/**
 * Static track + depleting arc with the hero centred inside — the whole ring in
 * one element, for a surface that has nothing else to layer into it. The detail
 * screen composes its own Svg instead, because it draws a SECOND ring (the trip
 * lifecycle progress) into the same track.
 */
export function CountdownRing({
  deadline,
  windowSeconds,
  size = RING,
  stroke = STROKE,
  children,
}: {
  deadline: number | null;
  windowSeconds: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const c = useColors();
  const r = (size - stroke) / 2;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.line} strokeWidth={stroke} fill="none" />
      </Svg>
      <CountdownArc deadline={deadline} windowSeconds={windowSeconds} size={size} stroke={stroke} />
      {children}
    </View>
  );
}
