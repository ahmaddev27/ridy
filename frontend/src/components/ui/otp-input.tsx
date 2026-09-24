"use client";

import { useRef } from "react";
import { useI18n } from "@/lib/i18n/context";
import { digitsOnly } from "@/lib/utils";

/**
 * A segmented one-time-password input: `length` separate boxes that behave as a
 * single field. Handles typing, backspace, arrow keys, and pasting a full code.
 * The value is the concatenated digits; the parent owns it.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  autoFocus = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.split("").slice(0, length);

  function focusAt(index: number) {
    const clamped = Math.max(0, Math.min(length - 1, index));
    refs.current[clamped]?.focus();
    refs.current[clamped]?.select();
  }

  function setDigit(index: number, digit: string) {
    const next = value.padEnd(length, " ").split("");
    next[index] = digit;
    onChange(next.join("").replace(/\s/g, "").slice(0, length));
  }

  function handleChange(index: number, raw: string) {
    // Arabic keyboards type ٠-٩ — normalise to Latin before filtering.
    const typed = digitsOnly(raw);
    if (index === 0 && typed.length >= length) {
      // One-time-code autofill drops the whole code into the first box.
      onChange(typed.slice(0, length));
      focusAt(Math.min(typed.length, length) - 1);
      return;
    }
    const digit = typed.slice(-1);
    if (!digit) return;
    setDigit(index, digit);
    if (index < length - 1) focusAt(index + 1);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[index]) {
        setDigit(index, "");
      } else {
        focusAt(index - 1);
        setDigit(index - 1, "");
      }
    } else if (e.key === "ArrowLeft") {
      focusAt(index - 1);
    } else if (e.key === "ArrowRight") {
      focusAt(index + 1);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = digitsOnly(e.clipboardData.getData("text")).slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    focusAt(pasted.length - 1);
  }

  return (
    <div className="flex justify-center gap-2" dir="ltr">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digits[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={i === 0 ? length : 1}
          autoFocus={autoFocus && i === 0}
          disabled={disabled}
          aria-label={t("common.otpDigit").replace("{n}", String(i + 1))}
          className="h-12 w-11 rounded-lg border border-line-strong text-center font-mono text-xl font-semibold text-ink outline-none transition-colors focus:border-ink focus:ring-2 focus:ring-line disabled:opacity-50"
        />
      ))}
    </div>
  );
}
