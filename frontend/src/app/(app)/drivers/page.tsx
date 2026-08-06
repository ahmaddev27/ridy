"use client";

import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listDrivers } from "@/lib/api/drivers";

export default function DriversPage() {
  const { t } = useI18n();
  const { data, loading, error } = useAsync(listDrivers);
  const drivers = data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        tkey="drivers"
      />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-600">{t("screens.drivers.loadError")} — {error}</div>
        ) : drivers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("screens.drivers.emptyTitle")}
            description={t("screens.drivers.emptyDesc")}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("screens.drivers.colName")}</th>
                <th className="px-4 py-3 font-semibold">{t("screens.drivers.colPhone")}</th>
                <th className="px-4 py-3 font-semibold">Uber E-Mail</th>
                <th className="px-4 py-3 font-semibold">Uber UUID</th>
                <th className="px-4 py-3 font-semibold">{t("screens.drivers.colLinked")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {drivers.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{d.name}</td>
                  <td className="px-4 py-3 text-slate-600">{d.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{d.uber_email ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {d.uber_driver_uuid ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                        d.uber_linked ? "bg-black text-white" : "bg-slate-200 text-slate-400"
                      }`}
                    >
                      {d.uber_linked ? t("screens.drivers.linked") : t("screens.drivers.notLinked")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
