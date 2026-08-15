import { useColorScheme } from "react-native";

/** Semantic palette — mirrors the dashboard tokens for a shared identity. */
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
  success: string;
  successBg: string;
  danger: string;
  warning: string;
  accent: string;
};

const dark: Palette = {
  canvas: "#0f1115",
  surface: "#181b21",
  surface2: "#20242b",
  ink: "#e6e8ec",
  inkMuted: "#a2a8b3",
  inkSubtle: "#6b7280",
  line: "#2c313a",
  primary: "#e6e8ec",
  primaryInk: "#12151a",
  success: "#34d399",
  successBg: "#0e2a22",
  danger: "#f87171",
  warning: "#fbbf24",
  accent: "#10b981",
};

const light: Palette = {
  canvas: "#f6f6f4",
  surface: "#ffffff",
  surface2: "#f1f1ef",
  ink: "#1e222b",
  inkMuted: "#5a616e",
  inkSubtle: "#8b909b",
  line: "#e4e4e1",
  primary: "#1e222b",
  primaryInk: "#ffffff",
  success: "#059669",
  successBg: "#e7f6ef",
  danger: "#dc2626",
  warning: "#d97706",
  accent: "#059669",
};

/** Colors for the device's current light/dark setting. */
export function useColors(): Palette {
  return useColorScheme() === "light" ? light : dark;
}

export const radius = { sm: 8, md: 12, lg: 16, xl: 20 };
