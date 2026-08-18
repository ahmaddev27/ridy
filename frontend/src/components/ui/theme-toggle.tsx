"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/theme/context";

/**
 * Small light/dark switch. Mirrors the dashboard topbar toggle but standalone,
 * so marketing (and any other surface) can reuse it. Uses semantic tokens so it
 * reads correctly in both themes.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const label = theme === "dark" ? "Zum hellen Design wechseln" : "Zum dunklen Design wechseln";

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={
        "inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink" +
        (className ? ` ${className}` : "")
      }
    >
      {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
