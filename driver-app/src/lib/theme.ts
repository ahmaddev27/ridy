import { Platform, useColorScheme, type ViewStyle } from "react-native";

/** Semantic palette — calibrated to the Reidey Driver design (light-first). */
export type Palette = {
  canvas: string;
  surface: string;
  surface2: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  line: string;
  primary: string;
  primaryInk: string;
  accent: string;
  // status hues (offer lifecycle)
  pending: string; // Offen — orange
  accepted: string; // Angenommen — blue
  started: string; // Auf Fahrt — violet
  completed: string; // Fertig — green
  rejected: string; // Abgelehnt — grey
  canceled: string; // Storniert — red
  // soft badge backgrounds
  completedBg: string;
  startedBg: string;
  pendingBg: string;
  canceledBg: string;
  rejectedBg: string;
  danger: string;
};

const light: Palette = {
  canvas: "#f3f3f1",
  surface: "#ffffff",
  surface2: "#eeedeb",
  ink: "#14161b",
  inkMuted: "#7c828c",
  inkSubtle: "#a7abb2",
  line: "#ececea",
  primary: "#14161b",
  primaryInk: "#ffffff",
  accent: "#12a06a",
  pending: "#d9871c",
  accepted: "#3b82f6",
  started: "#7c5cff",
  completed: "#12a06a",
  rejected: "#9aa0a8",
  canceled: "#e5484d",
  completedBg: "#dff3e9",
  startedBg: "#ece7ff",
  pendingBg: "#fbebd2",
  canceledBg: "#fbe3e4",
  rejectedBg: "#eceded",
  danger: "#e5484d",
};

const dark: Palette = {
  canvas: "#090b0f",
  surface: "#14171d",
  surface2: "#1d222b",
  ink: "#f0f2f4",
  inkMuted: "#969ca6",
  inkSubtle: "#616772",
  line: "#242a33",
  primary: "#f0f2f4",
  primaryInk: "#14161b",
  accent: "#34d399",
  pending: "#e0982f",
  accepted: "#5a9bff",
  started: "#9d84ff",
  completed: "#34d399",
  rejected: "#7b828d",
  canceled: "#ff6b70",
  completedBg: "#12352a",
  startedBg: "#241f3d",
  pendingBg: "#3a2c14",
  canceledBg: "#3a1e20",
  rejectedBg: "#20242c",
  danger: "#ff6b70",
};

/** Colors for the device's current light/dark setting. */
export function useColors(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const radius = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 };

/** True when the given palette is the dark scheme (shadows barely read there). */
export function isDarkPalette(c: Palette): boolean {
  return c.canvas === dark.canvas;
}

/**
 * Soft, theme-aware card elevation. On light we lean on a low-opacity, wide
 * shadow; on dark a shadow is nearly invisible, so we skip it and let the
 * lighter `surface` separate the card from the canvas (with a hairline for
 * extra definition, applied by `cardStyle`).
 */
export function softShadow(c: Palette): ViewStyle {
  if (isDarkPalette(c)) return {};
  return Platform.select({
    android: { elevation: 2 },
    default: {
      shadowColor: "#000000",
      shadowOpacity: 0.07,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
    },
  }) as ViewStyle;
}

/**
 * The one card look used everywhere: borderless soft-shadowed surface on light,
 * a lighter surface with an ultra-subtle hairline on dark. Keeps every screen's
 * cards visually identical (DRY).
 */
export function cardStyle(c: Palette): ViewStyle {
  const d = isDarkPalette(c);
  return {
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    ...(d ? { borderWidth: 1, borderColor: c.line } : softShadow(c)),
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
      return { fg: c.accepted, bg: c.startedBg };
    case "pending":
      return { fg: c.pending, bg: c.pendingBg };
    case "canceled":
      return { fg: c.canceled, bg: c.canceledBg };
    default: // rejected
      return { fg: c.rejected, bg: c.rejectedBg };
  }
}
