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
        "rounded-2xl border border-line bg-surface shadow-[0_2px_10px_-2px_rgba(30,34,43,0.06)]",
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
    default: "text-ink",
    positive: "text-success-fg",
    negative: "text-danger-fg",
    warning: "text-warning-fg",
  }[tone];

  const iconTone = {
    default: "bg-surface-2 text-ink-muted",
    positive: "bg-success-bg text-success-fg",
    negative: "bg-danger-bg text-danger-fg",
    warning: "bg-warning-bg text-warning-fg",
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
          <div className="truncate text-sm font-medium text-ink-muted">{label}</div>
          <div className={cn("mt-0.5 text-2xl font-bold tabular-nums tracking-tight", valueTone)}>{value}</div>
          {hint && <div className="mt-1 text-xs text-ink-subtle">{hint}</div>}
        </div>
      </div>
    </Card>
  );
}
