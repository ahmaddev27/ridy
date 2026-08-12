import { PageHeader } from "./page-header";
import { Construction } from "lucide-react";

export function Placeholder({
  title,
  subtitle,
  phase,
}: {
  title: string;
  subtitle?: string;
  phase?: string;
}) {
  return (
    <div className="space-y-5">
      <PageHeader title={title} subtitle={subtitle} />
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink">
          <Construction className="h-6 w-6" />
        </div>
        <p className="mt-3 text-sm font-medium text-ink">
          Screen scaffolded — wiring in {phase ?? "an upcoming phase"}
        </p>
        <p className="text-xs text-ink-subtle">
          Design adopted. Data and interactions come with the backend.
        </p>
      </div>
    </div>
  );
}
