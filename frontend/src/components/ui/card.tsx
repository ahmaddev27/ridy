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
        "rounded-xl border border-slate-200 bg-white",
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
      <div className="text-sm text-slate-500">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold", valueTone)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </Card>
  );
}
