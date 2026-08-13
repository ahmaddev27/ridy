"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, RefreshCw, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, type Status } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import { latnLocale, toLatinDigits } from "@/lib/utils";
import type { CodeFilters, CodeRow, CodeStatus, CodesPage } from "@/lib/api/reseller";

type Props = {
  fetchCodes: (filters: CodeFilters) => Promise<CodesPage>;
  exportCodes?: (filters: CodeFilters) => Promise<Blob>;
  /** Admin view shows who issued the code; a reseller's own list doesn't. */
  showCollector?: boolean;
  /** When set, expired codes get a "regenerate" button that issues a fresh one. */
  onRegenerate?: (row: CodeRow) => Promise<void>;
};

const STATUS_TONE: Record<CodeStatus, Status> = {
  activated: "matched",
  pending: "expiring",
  expired: "error",
};

/**
 * Filterable, paginated table of issued activation codes with lifecycle status.
 * Shared by the reseller's own list and the admin-wide ledger — the only
 * difference is the data source and whether the collector column shows.
 */
export function CodesLedger({ fetchCodes, exportCodes, showCollector = false, onRegenerate }: Props) {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.codes.${k}`);

  const [status, setStatus] = useState<CodeStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CodeRow[]>([]);
  const [meta, setMeta] = useState<CodesPage["meta"]>({ current_page: 1, last_page: 1, total: 0 });
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [regenId, setRegenId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchCodes({ status, from, to, page })
      .then((res) => {
        if (!active) return;
        setRows(res.data);
        setMeta(res.meta);
      })
      .catch(() => active && setRows([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, from, to, page, refreshKey]);

  async function regenerate(row: CodeRow) {
    if (!onRegenerate) return;
    setRegenId(row.id);
    try {
      await onRegenerate(row);
      setRefreshKey((k) => k + 1); // reflect the fresh code in the list
    } finally {
      setRegenId(null);
    }
  }

  const money = (n: number | null) =>
    n === null ? c("none") : new Intl.NumberFormat(latnLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const date = (iso: string | null) => (iso ? toLatinDigits(new Date(iso).toLocaleDateString(latnLocale(locale))) : c("none"));

  function resetFilters() {
    setStatus("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  async function doExport() {
    if (!exportCodes) return;
    try {
      const blob = await exportCodes({ status, from, to });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "subscription-codes.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(c("exportFailed"), { description: e instanceof Error ? e.message : undefined });
    }
  }

  const onFilterChange = <T,>(setter: (v: T) => void) => (v: T) => {
    setPage(1);
    setter(v);
  };

  return (
    <Card className="space-y-4 p-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">{c("filterStatus")}</span>
          <select
            value={status}
            onChange={(e) => onFilterChange(setStatus)(e.target.value as CodeStatus | "")}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
          >
            <option value="">{c("allStatuses")}</option>
            <option value="pending">{c("st_pending")}</option>
            <option value="activated">{c("st_activated")}</option>
            <option value="expired">{c("st_expired")}</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">{c("from")}</span>
          <input type="date" value={from} onChange={(e) => onFilterChange(setFrom)(e.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm text-ink-muted outline-none focus:border-ink" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">{c("to")}</span>
          <input type="date" value={to} onChange={(e) => onFilterChange(setTo)(e.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm text-ink-muted outline-none focus:border-ink" />
        </label>
        <Button variant="ghost" onClick={resetFilters} className="text-sm">{c("clearFilters")}</Button>
        {exportCodes && (
          <Button variant="secondary" onClick={doExport} className="ms-auto text-sm">
            <Download className="h-4 w-4" />
            {c("exportExcel")}
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-line text-start text-xs uppercase text-ink-subtle">
              <th className="px-2 py-2 text-start font-medium">{c("colCode")}</th>
              <th className="px-2 py-2 text-start font-medium">{c("colPlan")}</th>
              <th className="px-2 py-2 text-start font-medium">{c("colCompany")}</th>
              {showCollector && <th className="px-2 py-2 text-start font-medium">{c("colCollector")}</th>}
              <th className="px-2 py-2 text-start font-medium">{c("colAmount")}</th>
              <th className="px-2 py-2 text-start font-medium">{c("colStatus")}</th>
              <th className="px-2 py-2 text-start font-medium">{c("colCreated")}</th>
              <th className="px-2 py-2 text-start font-medium">{c("colExpires")}</th>
              {onRegenerate && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-2 py-2 font-mono font-semibold tracking-wider text-ink" dir="ltr">{r.code}</td>
                <td className="px-2 py-2 text-ink-muted">{r.plan ?? c("none")}</td>
                <td className="px-2 py-2 text-ink-muted">{r.company ?? c("none")}</td>
                {showCollector && <td className="px-2 py-2 text-ink-muted">{r.collector ?? c("none")}</td>}
                <td className="px-2 py-2 text-ink-muted">
                  {money(r.amount)}
                  <span className={`ms-1.5 text-xs ${r.paid ? "text-success-fg" : "text-ink-subtle"}`}>· {r.paid ? c("paid") : c("unpaid")}</span>
                </td>
                <td className="px-2 py-2"><Badge status={STATUS_TONE[r.status]}>{c(`st_${r.status}`)}</Badge></td>
                <td className="px-2 py-2 text-ink-muted" dir="ltr">{date(r.created_at)}</td>
                <td className="px-2 py-2 text-ink-muted" dir="ltr">{date(r.expires_at)}</td>
                {onRegenerate && (
                  <td className="px-2 py-2 text-end">
                    {r.status === "expired" && r.plan_id !== null && (
                      <button
                        onClick={() => regenerate(r)}
                        disabled={regenId !== null}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                        title={c("regenerate")}
                      >
                        {regenId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {c("regenerate")}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={(showCollector ? 8 : 7) + (onRegenerate ? 1 : 0)} className="px-2 py-8 text-center text-ink-subtle">{c("empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-ink-muted">
        <span>{c("totalN").replace("{n}", toLatinDigits(String(meta.total)))}</span>
        <div className="flex items-center gap-2">
          <span>{c("pageOf").replace("{n}", toLatinDigits(String(meta.current_page))).replace("{m}", toLatinDigits(String(meta.last_page)))}</span>
          <Button variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={meta.current_page <= 1} className="px-2">
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
          </Button>
          <Button variant="ghost" onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))} disabled={meta.current_page >= meta.last_page} className="px-2">
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
