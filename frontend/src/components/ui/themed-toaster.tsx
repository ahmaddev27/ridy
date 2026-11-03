"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/lib/theme/context";

/** Sonner toaster that follows the app theme, so toasts are dark in dark mode. */
export function ThemedToaster() {
  const { theme } = useTheme();

  // Glass design (epic #276): a single dark glass toast with an emerald icon,
  // so richColors (per-type coloured fills) is off and `.app-toast` applies.

  return (
    <Toaster
      position="bottom-right"
      richColors={false}
      closeButton
      theme={theme}
      toastOptions={{ classNames: { toast: "app-toast" } }}
    />
  );
}
