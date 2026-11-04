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
  | "info"
  | "neutral";

const tone: Record<Status, string> = {
  matched: "success",
  personal: "danger",
  ambiguous: "warning",
  gap: "",
  private: "accent",
  connected: "success",
  expiring: "warning",
  error: "danger",
  info: "info",
  neutral: "",
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
    <span className={cn("badge", tone[status], className)}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}
