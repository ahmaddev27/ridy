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
 * Tajawal ships one file per weight and has no synthetic bolding on native, so a
 * plain `fontWeight` never picks the heavier cut. These thin wrappers replace
 * react-native's <Text>/<TextInput> in our screens and inject the matching
 * Tajawal family for the flattened style's weight — while preserving any explicit
 * `fontFamily` (so glyph fonts like Ionicons are never overridden).
 */
function familyForWeight(weight?: TextStyle["fontWeight"]): string {
  switch (String(weight)) {
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

export const Text = forwardRef<React.ElementRef<typeof RNText>, TextProps>(
  function Text({ style, ...props }, ref) {
    const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
    const fontFamily = flat.fontFamily ?? familyForWeight(flat.fontWeight);
    return <RNText ref={ref} {...props} style={[{ fontFamily }, style]} />;
  },
);

export const TextInput = forwardRef<React.ElementRef<typeof RNTextInput>, TextInputProps>(
  function TextInput({ style, ...props }, ref) {
    const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
    const fontFamily = flat.fontFamily ?? familyForWeight(flat.fontWeight);
    return <RNTextInput ref={ref} {...props} style={[{ fontFamily }, style]} />;
  },
);
