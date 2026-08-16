import { Text, TextInput, StyleSheet, type TextStyle } from "react-native";
import {
  useFonts,
  Tajawal_400Regular,
  Tajawal_500Medium,
  Tajawal_700Bold,
  Tajawal_800ExtraBold,
} from "@expo-google-fonts/tajawal";

/**
 * Tajawal has no synthetic bolding on native, so a plain `fontWeight` won't pick
 * the heavier cut. We map each weight to its dedicated family, then patch the
 * default render of <Text>/<TextInput> so every screen inherits Tajawal without
 * threading a font family through hundreds of styles.
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

let patched = false;

/** Load Tajawal and route every Text/TextInput through the right weighted cut. */
export function useAppFonts(): boolean {
  const [loaded] = useFonts({
    Tajawal_400Regular,
    Tajawal_500Medium,
    Tajawal_700Bold,
    Tajawal_800ExtraBold,
  });

  if (loaded && !patched) {
    patched = true;
    for (const Comp of [Text, TextInput] as const) {
      const proto = Comp as unknown as { render?: (...args: unknown[]) => unknown };
      const original = proto.render;
      if (!original) continue;
      proto.render = function patchedRender(...args: unknown[]) {
        const el = original.apply(this, args) as {
          props: { style?: unknown };
        } & Record<string, unknown>;
        const flat = (StyleSheet.flatten(el.props.style) ?? {}) as TextStyle;
        const family = flat.fontFamily ?? familyForWeight(flat.fontWeight);
        return {
          ...el,
          props: { ...el.props, style: [{ fontFamily: family }, el.props.style] },
        };
      };
    }
  }

  return loaded;
}
