import { cn } from "@/lib/utils";

export type Status =
  | "matched"
  | "personal"
  | "ambiguous"
  | "gap"
  | "private"
  | "connected"
  | "expiring"
  | "error"
  | "neutral";

const styles: Record<Status, string> = {
  matched: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  personal: "bg-rose-50 text-rose-700 ring-rose-600/20",
  ambiguous: "bg-amber-50 text-amber-700 ring-amber-600/20",
  gap: "bg-slate-100 text-slate-600 ring-slate-500/20",
  private: "bg-violet-50 text-violet-700 ring-violet-600/20",
  connected: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  expiring: "bg-amber-50 text-amber-700 ring-amber-600/20",
  error: "bg-rose-50 text-rose-700 ring-rose-600/20",
  neutral: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const dotColors: Partial<Record<Status, string>> = {
  connected: "bg-emerald-500",
  expiring: "bg-amber-500",
  error: "bg-rose-500",
};

export function Badge({
  status = "neutral",
  dot = false,
  children,
  className,
}: {
  status?: Status;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        styles[status],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            dotColors[status] ?? "bg-slate-400",
          )}
        />
      )}
      {children}
    </span>
  );
}
