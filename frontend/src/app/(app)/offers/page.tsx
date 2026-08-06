"use client";

import { Radio, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { useAsync } from "@/hooks/use-async";
import { listOffers } from "@/lib/api/offers";

export default function OffersPage() {
  const { t, locale } = useI18n();
  const { data, loading, error } = useAsync(listOffers);
  const offers = data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("screens.offers.title")} subtitle={t("screens.offers.subtitle")} />

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {t("screens.offers.loadError")} — {error}
        </div>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : offers.length === 0 ? (
          <EmptyState
            icon={Radio}
            title={t("screens.offers.empty")}
            description={t("screens.offers.emptyDesc")}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("screens.offers.colTime")}</th>
                  <th className="px-4 py-3 font-semibold">{t("screens.offers.colDriver")}</th>
                  <th className="px-4 py-3 font-semibold">{t("screens.offers.colRoute")}</th>
                  <th className="px-4 py-3 font-semibold">{t("screens.offers.colFare")}</th>
                  <th className="px-4 py-3 font-semibold">{t("screens.offers.colStatus")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {offers.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {o.received_at ? new Date(o.received_at).toLocaleTimeString(locale) : "—"}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{o.driver_name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <div className="flex items-start gap-1.5">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        <div className="min-w-0">
                          <div className="truncate">{o.pickup_address ?? "—"}</div>
                          <div className="truncate text-slate-400">→ {o.dropoff_address ?? "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">
                      {o.fare_formatted ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={o.linked ? "connected" : "gap"} dot>
                        {o.linked ? t("screens.offers.linked") : t("screens.offers.unlinked")}
                      </Badge>
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
