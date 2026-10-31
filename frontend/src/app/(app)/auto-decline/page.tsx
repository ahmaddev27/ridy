"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, ChevronLeft, ChevronRight, MapPin, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { useI18n } from "@/lib/i18n/context";
import { formatMoney, latnLocale, toLatinDigits } from "@/lib/utils";
import { fareLabel, type PageMeta } from "@/lib/api/offers";
import {
  AUTO_DECLINE_REASONS,
  getAutoDeclineOverview,
  listEarlyDeclined,
  type AutoDeclineDriver,
  type AutoDeclineOverview,
  type AutoDeclineReason,
  type EarlyDeclinedOffer,
} from "@/lib/api/auto-decline";

const PER_PAGE = 25;

const selectClass =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-muted outline-none hover:bg-surface-2";

export default function AutoDeclinePage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.autoDecline.${k}`);
  const num = latnLocale(locale);

  const [overview, setOverview] = useState<AutoDeclineOverview | null>(null);
  const [offers, setOffers] = useState<EarlyDeclinedOffer[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [driverId, setDriverId] = useState("");
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  // Only the newest request may write state, so a slow old filter can't overwrite a newer one.
  const seq = useRef(0);

  useEffect(() => {
    getAutoDeclineOverview()
      .then(setOverview)
      .catch((e) => setError(e instanceof Error ? e.message : "error"));
  }, []);

  useEffect(() => {
    const my = ++seq.current;
    setLoading(true);
    listEarlyDeclined({
      driverId: driverId ? Number(driverId) : undefined,
      reason: (reason || undefined) as AutoDeclineReason | undefined,
      from: from || undefined,
      to: to || undefined,
      page,
      perPage: PER_PAGE,
    })
      .then(({ items, meta: m }) => {
        if (my !== seq.current) return;
        setOffers(items);
        setMeta(m);
        setError(null);
      })
      .catch((e) => {
        if (my === seq.current) setError(e instanceof Error ? e.message : "error");
      })
      .finally(() => {
        if (my === seq.current) setLoading(false);
      });
  }, [driverId, reason, from, to, page]);

  function ruleLines(d: AutoDeclineDriver): string[] {
    const r = d.rules;
    const lines: string[] = [];
    if (r.min_fare.enabled) lines.push(c("ruleMinFare").replace("{v}", formatMoney(r.min_fare.value_e2 / 100, locale)));
    if (r.reject_cities.enabled) lines.push(c("ruleCities").replace("{v}", r.reject_cities.cities.join(", ")));
    if (r.max_pickup_distance.enabled) lines.push(c("rulePickup").replace("{v}", r.max_pickup_distance.km.toLocaleString(num)));
    if (r.max_trip_distance.enabled) lines.push(c("ruleTrip").replace("{v}", r.max_trip_distance.km.toLocaleString(num)));
    return lines;
  }

  function reasonLabel(r: string | null): string {
    return r ? c(`reason_${r}`) : "—";
  }

  return (
    <div className="space-y-6">
      <PageHeader title={c("title")} subtitle={c("subtitle")} />

      {error && (
        <div className="rounded-lg border border-rose-200 bg-danger-bg p-3 text-sm text-danger-fg">
          {c("loadError")} — {error}
        </div>
      )}

      {overview && !overview.feature_enabled && (
        <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink-muted">{c("featureOff")}</div>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3 font-semibold text-ink">{c("driversTitle")}</div>
        {overview && overview.drivers.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-subtle">{c("driversEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-start text-xs text-ink-subtle">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">{c("colDriver")}</th>
                  <th className="px-4 py-2 text-start font-medium">{c("colRules")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(overview?.drivers ?? []).map((d) => {
                  const lines = ruleLines(d);
                  return (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">{d.name}</td>
                      <td className="px-4 py-3">
                        {lines.length === 0 ? (
                          <span className="text-ink-subtle">{c("noRules")}</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {lines.map((l) => (
                              <span key={l} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink">
                                {toLatinDigits(l)}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="me-auto font-semibold text-ink">{c("historyTitle")}</h2>
        <select
          value={driverId}
          onChange={(e) => { setDriverId(e.target.value); setPage(1); }}
          className={selectClass}
          aria-label={c("colDriver")}
        >
          <option value="">{c("allDrivers")}</option>
          {(overview?.drivers ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <select
          value={reason}
          onChange={(e) => { setReason(e.target.value); setPage(1); }}
          className={selectClass}
          aria-label={c("colReason")}
        >
          <option value="">{c("allReasons")}</option>
          {AUTO_DECLINE_REASONS.map((r) => (
            <option key={r} value={r}>{reasonLabel(r)}</option>
          ))}
        </select>
        <DateRangeFilter
          fleetDays
          from={from}
          to={to}
          onChange={(f, t2) => { setFrom(f); setTo(t2); setPage(1); }}
        />
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-surface-2" />
            ))}
          </div>
        ) : offers.length === 0 ? (
          <EmptyState icon={Ban} title={c("historyEmpty")} description={c("historyEmptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-subtle">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">{c("colTime")}</th>
                  <th className="px-4 py-2 text-start font-medium">{c("colDriver")}</th>
                  <th className="px-4 py-2 text-start font-medium">{c("colRoute")}</th>
                  <th className="px-4 py-2 text-start font-medium">{c("colFare")}</th>
                  <th className="px-4 py-2 text-start font-medium">{c("colReason")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {offers.map((o) => (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                      {o.received_at ? new Date(o.received_at).toLocaleString(num) : "—"}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">{o.driver_name ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      <div className="flex items-start gap-1.5">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-fg" />
                        <div className="min-w-0">
                          <div className="truncate">{o.pickup_address ?? "—"}</div>
                          <div className="flex items-center gap-1 truncate text-ink-subtle">
                            <ArrowRight className="h-3 w-3 shrink-0 rtl:rotate-180" />
                            <span className="truncate">{o.dropoff_address ?? "—"}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-ink">{toLatinDigits(fareLabel(o, num))}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">
                        {reasonLabel(o.auto_decline_reason)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta && meta.total > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
            <span className="text-ink-muted">
              {((meta.current_page - 1) * meta.per_page + 1).toLocaleString(num)}–
              {Math.min(meta.current_page * meta.per_page, meta.total).toLocaleString(num)} {c("of")} {meta.total.toLocaleString(num)}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={meta.current_page <= 1}
                className="rounded-lg border border-line p-1.5 text-ink-muted hover:bg-surface-2 disabled:opacity-40"
                aria-label={c("prev")}
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
              </button>
              <span className="px-2 text-ink-muted">
                {meta.current_page.toLocaleString(num)} / {meta.last_page.toLocaleString(num)}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                disabled={meta.current_page >= meta.last_page}
                className="rounded-lg border border-line p-1.5 text-ink-muted hover:bg-surface-2 disabled:opacity-40"
                aria-label={c("next")}
              >
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
