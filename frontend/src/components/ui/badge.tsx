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
  matched: "bg-success-bg text-success-fg ring-success-ring/20",
  personal: "bg-danger-bg text-danger-fg ring-danger-ring/20",
  ambiguous: "bg-warning-bg text-warning-fg ring-warning-ring/20",
  gap: "bg-surface-2 text-ink-muted ring-line",
  private: "bg-accent-bg text-accent-fg ring-accent-ring/20",
  connected: "bg-success-bg text-success-fg ring-success-ring/20",
  expiring: "bg-warning-bg text-warning-fg ring-warning-ring/20",
  error: "bg-danger-bg text-danger-fg ring-danger-ring/20",
  neutral: "bg-surface-2 text-ink-muted ring-line",
};

const dotColors: Partial<Record<Status, string>> = {
  connected: "bg-success-ring",
  expiring: "bg-warning-ring",
  error: "bg-danger-ring",
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
            dotColors[status] ?? "bg-ink-subtle",
          )}
        />
      )}
      {children}
    </span>
  );
}
