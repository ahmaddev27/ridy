"use client";

/**
 * The dashboard's switch, in one place.
 *
 * The same markup had been copied three times — admin settings, the profile's
 * notification settings, and the company detail modal — and the copies had
 * already drifted (one paints `bg-emerald-500` and nudges the knob with
 * `translate-x-0.5`, the others `bg-primary` and a margin). This is the shape
 * the two settings screens share; the detail modal keeps its own for now.
 *
 * RTL is handled by hand, like everywhere else in this app: the native RTL flip
 * is off, so the knob's travel is mirrored with `rtl:` rather than inherited.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  id,
}: {
  checked: boolean;
  onChange?: () => void;
  disabled?: boolean;
  /** Accessible name. A switch with no visible text of its own needs one. */
  label: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onChange}
      disabled={disabled}
      className={
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40 " +
        (checked ? "bg-primary" : "bg-line-strong") +
        (disabled ? " cursor-not-allowed opacity-60" : " cursor-pointer")
      }
    >
      <span
        className={
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ltr:ml-1 rtl:mr-1 " +
          (checked ? "ltr:translate-x-5 rtl:-translate-x-5" : "translate-x-0")
        }
      />
    </button>
  );
}
