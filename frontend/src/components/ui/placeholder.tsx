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
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-500">
          <Construction className="h-6 w-6" />
        </div>
        <p className="mt-3 text-sm font-medium text-slate-700">
          Screen scaffolded — wiring in {phase ?? "an upcoming phase"}
        </p>
        <p className="text-xs text-slate-400">
          Design adopted. Data and interactions come with the backend.
        </p>
      </div>
    </div>
  );
}
