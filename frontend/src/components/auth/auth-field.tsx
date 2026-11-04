"use client";

import { useId } from "react";
import { PasswordInput } from "@/components/ui/password-input";

/**
 * A labelled `.field` of the remade auth screens: prototype label + `.input` (or the
 * show/hide password input) + optional hint. Controlled; the page owns the value.
 */
export function AuthField({
  label,
  value,
  onChange,
  type = "text",
  hint,
  required,
  minLength,
  autoFocus,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "email" | "tel" | "password";
  hint?: React.ReactNode;
  required?: boolean;
  minLength?: number;
  autoFocus?: boolean;
  className?: string;
}) {
  const id = useId();
  const common = {
    id,
    value,
    required,
    minLength,
    autoFocus,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
  };
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      {type === "password" ? <PasswordInput proto {...common} /> : <input type={type} className="input" {...common} />}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
