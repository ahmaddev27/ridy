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
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "warning";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const valueTone = {
    default: "text-slate-900",
    positive: "text-emerald-600",
    negative: "text-rose-700",
    warning: "text-amber-600",
  }[tone];

  const iconTone = {
    default: "bg-slate-100 text-slate-500",
    positive: "bg-emerald-50 text-emerald-600",
    negative: "bg-rose-50 text-rose-600",
    warning: "bg-amber-50 text-amber-600",
  }[tone];

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        {Icon && (
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", iconTone)}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-500">{label}</div>
          <div className={cn("mt-0.5 text-2xl font-bold tabular-nums tracking-tight", valueTone)}>{value}</div>
          {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
        </div>
      </div>
    </Card>
  );
}
