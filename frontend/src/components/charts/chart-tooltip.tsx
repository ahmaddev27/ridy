"use client";

/** Theme-aware Recharts tooltip: a surface card with a hairline and ink text. */
export function ChartTooltip({
  active,
  payload,
  label,
  valueFormat,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  valueFormat?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="text-ink-subtle">{label}</div>
      <div className="mt-0.5 font-semibold text-ink">{valueFormat ? valueFormat(v) : v.toLocaleString()}</div>
    </div>
  );
}
