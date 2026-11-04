"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  /** Prototype `.input` look (the remade auth screens) instead of the legacy utility styling. */
  proto?: boolean;
};

/**
 * Password field with a show/hide eye toggle.
 * Drop-in replacement for `<input type="password" />` — accepts the same
 * standard input props. Each instance owns its own visibility state, so
 * paired new/confirm fields toggle independently. RTL-aware and theme-aware.
 */
export function PasswordInput({ className = "", proto = false, ...props }: PasswordInputProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={show ? "text" : "password"}
        className={
          proto
            ? `input pe-10 ${className}`
            : `ui-field w-full rounded-lg border border-line-strong px-3 py-2 pe-10 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-line ${className}`
        }
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-ink-subtle transition-colors hover:text-ink end-2"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
