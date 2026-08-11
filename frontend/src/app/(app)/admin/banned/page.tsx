"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Ban, Phone, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listBannedCompanies, reactivateCompany } from "@/lib/api/admin";

export default function BannedCompaniesPage() {
  const { t } = useI18n();
  const b = (k: string) => t(`screens.banned.${k}`);
  const { data, loading, refetch } = useAsync(listBannedCompanies, { refetchInterval: 15000 });
  const rows = data ?? [];
  const [busyId, setBusyId] = useState<number | null>(null);

  async function reactivate(id: number) {
    setBusyId(id);
    try {
      await reactivateCompany(id);
      toast.success(b("reactivated"));
      await refetch();
    } catch (e) {
      toast.error(b("failed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader tkey="banned" />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ShieldCheck} title={b("emptyTitle")} description={b("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400 [&_th]:text-start">
                <tr>
                  <th className="px-4 py-3 font-semibold">{b("colCompany")}</th>
                  <th className="px-4 py-3 font-semibold">{b("colOwner")}</th>
                  <th className="px-4 py-3 font-semibold">{b("colPhone")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-800">
                        <Ban className="h-4 w-4 text-rose-500" /> {r.name}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{r.owner_name ?? "—"}</div>
                      <div className="text-xs text-slate-400">{r.owner_email ?? ""}</div>
                    </td>
                    <td className="px-4 py-3">
                      {r.owner_phone ? (
                        <a
                          href={`tel:${r.owner_phone}`}
                          className="inline-flex items-center gap-1.5 font-mono text-slate-700 hover:text-slate-900"
                          dir="ltr"
                        >
                          <Phone className="h-3.5 w-3.5" /> {r.owner_phone}
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <button
                        onClick={() => reactivate(r.id)}
                        disabled={busyId === r.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {busyId === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        )}
                        {b("reactivate")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
