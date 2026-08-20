import { useSyncExternalStore } from "react";
import { Platform, useColorScheme, type ViewStyle } from "react-native";

/**
 * Semantic palette — calibrated to the REIDEY Driver hi-fi design: a dark,
 * monochrome system (black / white / grey) with emerald kept only as a small,
 * subordinate accent for active/accept states. A matching monochrome light
 * scheme mirrors it (inverted primary button, warm neutral surfaces).
 */
export type Palette = {
  canvas: string; // screen background (bg/base)
  surface: string; // standard card (surface/card)
  surface2: string; // inset lists, inputs, tertiary (bg/tertiary)
  surfaceRaised: string; // live card, secondary buttons, badges, pills (surface/raised)
  overlay: string; // toast / push mock / hairline inside cards (surface/overlay)
  ink: string; // primary text/values
  inkMuted: string; // secondary text (text/secondary)
  inkSubtle: string; // labels, captions, inactive tabs (text/muted)
  inkFaint: string; // footnotes, chevrons, section meta (text/faint)
  line: string; // 1px card + control borders (border/default)
  borderStrong: string; // emphasized borders — live card, active chip
  primary: string; // primary button background
  primaryInk: string; // primary button label
  accent: string; // subtle emerald — online dot, accept/active touches
  // status hues (offer lifecycle) — kept monochrome-leaning per the design
  pending: string; // Offen — warning amber
  accepted: string; // Angenommen — subtle emerald
  started: string; // Auf Fahrt — neutral
  completed: string; // Fertig — subtle emerald
  rejected: string; // Abgelehnt — muted grey
  canceled: string; // Storniert — error red
  // soft badge backgrounds
  completedBg: string;
  startedBg: string;
  pendingBg: string;
  canceledBg: string;
  rejectedBg: string;
  danger: string;
  warning: string;
};

const light: Palette = {
  canvas: "#f4f4f3",
  surface: "#ffffff",
  surface2: "#efefed",
  surfaceRaised: "#fafaf9",
  overlay: "#ffffff",
  ink: "#0a0b0b",
  inkMuted: "#45484a",
  inkSubtle: "#74777a",
  inkFaint: "#a2a5a8",
  line: "#e6e6e3",
  borderStrong: "#d2d3d1",
  primary: "#0a0b0b",
  primaryInk: "#ffffff",
  accent: "#0e9d63",
  pending: "#b8860b",
  accepted: "#0e9d63",
  started: "#45484a",
  completed: "#0e9d63",
  rejected: "#74777a",
  canceled: "#c4413d",
  completedBg: "#e2f2ea",
  startedBg: "#eceded",
  pendingBg: "#f7edd6",
  canceledBg: "#f7e2e1",
  rejectedBg: "#eceded",
  danger: "#c4413d",
  warning: "#b8860b",
};

const dark: Palette = {
  // Softer than a near-black base: a lifted charcoal that keeps the monochrome
  // mood without the heavy, oppressive black. Surfaces step up from it in tone.
  canvas: "#14171a",
  surface: "#1e2226",
  surface2: "#1a1e21",
  surfaceRaised: "#252a2e",
  overlay: "#2d3237",
  ink: "#ffffff",
  inkMuted: "#b5b7b8",
  inkSubtle: "#777a7c",
  inkFaint: "#4e5152",
  line: "#333940",
  borderStrong: "#454b50",
  primary: "#ffffff",
  primaryInk: "#14171a",
  accent: "#35c88f",
  pending: "#e4a11b",
  accepted: "#35c88f",
  started: "#b5b7b8",
  completed: "#35c88f",
  rejected: "#777a7c",
  canceled: "#d9534f",
  completedBg: "#173328",
  startedBg: "#252a2e",
  pendingBg: "#3a3123",
  canceledBg: "#2a2020",
  rejectedBg: "#252a2e",
  danger: "#d9534f",
  warning: "#e4a11b",
};

/**
 * Theme preference: follow the device ("system") or force light/dark. Held in a
 * tiny external store (mirrors the i18n store) so `useColors` stays a plain hook
 * and any screen can flip it live. Persistence lives in the caller (Settings +
 * the root layout loader), like the locale.
 */
export type ThemeMode = "system" | "light" | "dark";
let currentMode: ThemeMode = "system";
const themeListeners = new Set<() => void>();

export function setThemeMode(mode: ThemeMode): void {
  if (mode !== currentMode) {
    currentMode = mode;
    themeListeners.forEach((fn) => fn());
  }
}

export function getThemeMode(): ThemeMode {
  return currentMode;
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(
    (fn) => {
      themeListeners.add(fn);
      return () => themeListeners.delete(fn);
    },
    () => currentMode,
  );
}

/** Colors for the effective scheme: the chosen mode, or the device setting. */
export function useColors(): Palette {
  const mode = useThemeMode();
  const system = useColorScheme();
  const scheme = mode === "system" ? (system ?? "light") : mode;
  return scheme === "dark" ? dark : light;
}

/**
 * Radii from the design: 6 badges · 12 controls/buttons · 14 cards · 16 large
 * cards · 22 bottom sheet · 999 pills.
 */
export const radius = { xs: 6, sm: 10, control: 12, md: 14, lg: 16, xl: 22, pill: 999 };

/** True when the given palette is the dark scheme (shadows barely read there). */
export function isDarkPalette(c: Palette): boolean {
  return c.canvas === dark.canvas;
}

/**
 * Soft, theme-aware card elevation. On light we lean on a low-opacity, wide
 * shadow; on dark a shadow is nearly invisible, so we skip it and let the
 * lighter `surface` + a hairline border separate the card from the canvas.
 */
export function softShadow(c: Palette): ViewStyle {
  if (isDarkPalette(c)) return {};
  return Platform.select({
    android: { elevation: 2 },
    default: {
      shadowColor: "#000000",
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
    },
  }) as ViewStyle;
}

/**
 * The one card look used everywhere: on dark a `surface/card` with a 1px
 * `border/default` hairline (monochrome, no shadow); on light a borderless
 * soft-shadowed white surface. `raised` opts into the emphasized look used by
 * the live/new-offer card (raised surface + strong border).
 */
export function cardStyle(c: Palette, raised = false): ViewStyle {
  const d = isDarkPalette(c);
  return {
    backgroundColor: raised ? c.surfaceRaised : c.surface,
    borderRadius: radius.md,
    ...(d
      ? { borderWidth: 1, borderColor: raised ? c.borderStrong : c.line }
      : raised
        ? { borderWidth: 1, borderColor: c.line }
        : softShadow(c)),
  };
}

/** Offer status → its hue + soft badge background. */
export function statusColors(c: Palette, status: string): { fg: string; bg: string } {
  switch (status) {
    case "completed":
      return { fg: c.completed, bg: c.completedBg };
    case "started":
      return { fg: c.started, bg: c.startedBg };
    case "accepted":
      return { fg: c.accepted, bg: c.completedBg };
    case "pending":
      return { fg: c.pending, bg: c.pendingBg };
    case "canceled":
      return { fg: c.canceled, bg: c.canceledBg };
    default: // rejected
      return { fg: c.rejected, bg: c.rejectedBg };
  }
}
