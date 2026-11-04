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
    <label className="switch" title={label} style={disabled ? { opacity: 0.6, cursor: "not-allowed" } : undefined}>
      <input type="checkbox" role="switch" id={id} checked={checked} onChange={() => onChange?.()} disabled={disabled} aria-label={label} />
      <span />
    </label>
  );
}
