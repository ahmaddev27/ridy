import { forwardRef } from "react";
import {
  Text as RNText,
  TextInput as RNTextInput,
  StyleSheet,
  type TextProps,
  type TextInputProps,
  type TextStyle,
} from "react-native";

/**
 * Both Tajawal and Manrope ship one file per weight with no synthetic bolding on
 * native, so a plain `fontWeight` never picks the heavier cut. These thin wrappers
 * replace react-native's <Text>/<TextInput> and inject the matching family for the
 * flattened style's weight — preserving any explicit `fontFamily`.
 *
 * React Native can't fall back per-glyph within one Text, so we pick the family
 * from the CONTENT: text containing Arabic letters renders in Tajawal; everything
 * else (Latin text AND all digits — fares, distances, times, €/km) renders in
 * Manrope, the Uber-Move-like face. So numbers match the Uber look even in Arabic.
 */
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** Collect the visible text of (possibly nested) children to sniff its script. */
function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const el = node as { props?: { children?: React.ReactNode } };
  return el?.props?.children != null ? textOf(el.props.children) : "";
}

function familyForWeight(weight: TextStyle["fontWeight"], arabic: boolean): string {
  const w = String(weight);
  if (arabic) {
    switch (w) {
      case "800":
      case "900":
        return "Tajawal_800ExtraBold";
      case "600":
      case "700":
      case "bold":
        return "Tajawal_700Bold";
      case "500":
        return "Tajawal_500Medium";
      default:
        return "Tajawal_400Regular";
    }
  }
  switch (w) {
    case "800":
    case "900":
      return "Manrope_800ExtraBold";
    case "700":
    case "bold":
      return "Manrope_700Bold";
    case "600":
      return "Manrope_600SemiBold";
    case "500":
      return "Manrope_500Medium";
    default:
      return "Manrope_400Regular";
  }
}

// The weight is encoded in the family name, so we must NOT also pass fontWeight:
// on Android a weighted custom family + a fontWeight (e.g. "700") makes the font
// resolver look for that weight inside the already-weighted family, fail, and
// fall back to the system font (why bold titles/buttons/badges lost Tajawal).
// Forcing "normal" here lets the picked Tajawal face render as-is on both platforms.
const NORMAL_WEIGHT = { fontWeight: "normal" } as const;

export const Text = forwardRef<React.ElementRef<typeof RNText>, TextProps>(
  function Text({ style, ...props }, ref) {
    const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
    const arabic = ARABIC.test(textOf(props.children));
    const fontFamily = flat.fontFamily ?? familyForWeight(flat.fontWeight, arabic);
    return <RNText ref={ref} {...props} style={[{ fontFamily }, style, NORMAL_WEIGHT]} />;
  },
);

export const TextInput = forwardRef<React.ElementRef<typeof RNTextInput>, TextInputProps>(
  function TextInput({ style, value, ...props }, ref) {
    const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
    const arabic = ARABIC.test(String(value ?? props.placeholder ?? ""));
    const fontFamily = flat.fontFamily ?? familyForWeight(flat.fontWeight, arabic);
    return <RNTextInput ref={ref} {...props} value={value} style={[{ fontFamily }, style, NORMAL_WEIGHT]} />;
  },
);
