"use client";

import { useMemo, useState } from "react";
import { Lock, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useAsync } from "@/hooks/use-async";
import { useI18n } from "@/lib/i18n/context";
import { listAuditLogs } from "@/lib/api/audit";

export default function AuditLogPage() {
  const { t } = useI18n();
  const { data, loading, error } = useAsync(listAuditLogs);
  const [query, setQuery] = useState("");

  const entries = useMemo(() => {
    const all = data ?? [];
    if (query === "") return all;
    const q = query.toLowerCase();
    return all.filter(
      (e) => `${e.action} ${e.subject ?? ""}`.toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
    <div className="space-y-6">
      <PageHeader
        tkey="auditLog"
      />

      <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p>{t("screens.auditLog.immutableNote")}</p>
      </div>

      <label className="flex max-w-xs items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("screens.auditLog.searchPlaceholder")}
          className="w-full bg-transparent outline-none placeholder:text-slate-400"
        />
      </label>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-600">{t("screens.auditLog.loadError")} {error}</div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={Lock}
            title={t("screens.auditLog.emptyTitle")}
            description={t("screens.auditLog.emptyDesc")}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400 [&_th]:text-start">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("screens.auditLog.colTime")}</th>
                <th className="px-4 py-3 font-semibold">{t("screens.auditLog.colActor")}</th>
                <th className="px-4 py-3 font-semibold">{t("screens.auditLog.colAction")}</th>
                <th className="px-4 py-3 font-semibold">{t("screens.auditLog.colSubject")}</th>
                <th className="px-4 py-3 font-semibold">{t("screens.auditLog.colIp")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">
                    {e.created_at ? new Date(e.created_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {e.actor_id
                      ? t("screens.auditLog.actorUser").replace("{id}", String(e.actor_id))
                      : t("screens.auditLog.actorSystem")}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                      {e.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {e.subject ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{e.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
