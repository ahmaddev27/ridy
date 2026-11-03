"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { useTheme } from "@/lib/theme/context";

/** Sonner toaster that follows the app theme, so toasts are dark in dark mode. */
export function ThemedToaster() {
  const { theme } = useTheme();

  // Glass redesign (epic #276): under the flag the prototype uses a single dark
  // glass toast with an emerald icon, so richColors (per-type coloured fills) is
  // turned off and the `.app-toast` recipe applies. Read once after mount — the
  // flag is set before paint on <html> and is stable for the session. With the
  // flag off this stays false, so the toaster is byte-for-byte the legacy look.
  const [glass, setGlass] = useState(false);
  useEffect(() => {
    setGlass(document.documentElement.dataset.glass === "on");
  }, []);

  return (
    <Toaster
      position="bottom-right"
      richColors={!glass}
      closeButton
      theme={theme}
      toastOptions={glass ? { classNames: { toast: "app-toast" } } : undefined}
    />
  );
}
