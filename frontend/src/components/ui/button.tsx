import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

// The `ui-btn--*` hook classes are additive: the Tailwind token utilities here
// supply the flag-off look, while html[data-glass="on"] rules (globals.css,
// Phase 2) override hover/shadow/focus-ring onto the prototype's .btn recipe.
const variants: Record<Variant, string> = {
  primary: "ui-btn ui-btn--primary bg-primary text-primary-ink shadow-sm hover:opacity-90 focus-visible:ring-line-strong",
  secondary:
    "ui-btn ui-btn--secondary border border-line bg-surface text-ink hover:bg-surface-2 focus-visible:ring-line",
  ghost: "ui-btn ui-btn--ghost text-ink-muted hover:bg-surface-2 focus-visible:ring-line",
  danger: "ui-btn ui-btn--danger bg-danger-ring text-white shadow-sm hover:opacity-90 focus-visible:ring-danger-ring/50",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold outline-none transition-all focus-visible:ring-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
