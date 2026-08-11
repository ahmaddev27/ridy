import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        // Softer radius + a very subtle tinted shadow so cards feel elevated on
        // the warm canvas without a hard border (Metronic-style surfaces).
        "rounded-2xl border border-slate-200/70 bg-white shadow-[0_2px_10px_-2px_rgba(30,34,43,0.06)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "warning";
}) {
  const valueTone = {
    default: "text-slate-900",
    positive: "text-emerald-600",
    negative: "text-rose-700",
    warning: "text-amber-600",
  }[tone];

  return (
    <Card className="p-4">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums tracking-tight", valueTone)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </Card>
  );
}
