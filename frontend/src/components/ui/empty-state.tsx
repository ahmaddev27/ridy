import { LucideIcon, Inbox } from "lucide-react";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-subtle">
        <Icon className="h-6 w-6" />
      </div>
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      {description && <p className="text-xs text-ink-subtle">{description}</p>}
    </div>
  );
}
