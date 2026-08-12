"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/lib/theme/context";

/** Sonner toaster that follows the app theme, so toasts are dark in dark mode. */
export function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster position="bottom-right" richColors closeButton theme={theme} />;
}
