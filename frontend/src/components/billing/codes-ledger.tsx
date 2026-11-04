"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, RefreshCw, Loader2, RotateCcw, Ticket } from "lucide-react";
import { PagerBar } from "@/components/ui/rd";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { useI18n } from "@/lib/i18n/context";
import { latnLocale, toLatinDigits } from "@/lib/utils";
import { paymentMethodLabel } from "@/lib/api/payments";
import type { CodeFilters, CodeRow, CodeStatus, CodesPage } from "@/lib/api/reseller";

type Props = {
  fetchCodes: (filters: CodeFilters) => Promise<CodesPage>;
  exportCodes?: (filters: CodeFilters) => Promise<Blob>;
  /** Admin view shows who issued the code; a reseller's own list doesn't. */
  showCollector?: boolean;
  /** When set, expired codes get a "regenerate" button that issues a fresh one. */
  onRegenerate?: (row: CodeRow) => Promise<void>;
  /** Optional card heading (prototype `.card-head`). */
  title?: string;
  sub?: string;
};

const STATUS_TONE: Record<CodeStatus, "success" | "warning" | "danger"> = {
  activated: "success",
  pending: "warning",
  expired: "danger",
};

/**
 * Filterable, paginated table of issued activation codes with lifecycle status.
 * Shared by the reseller's own list and the admin-wide ledger — the only
 * difference is the data source and whether the collector column shows.
 */
export function CodesLedger({ fetchCodes, exportCodes, showCollector = false, onRegenerate, title, sub }: Props) {
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

  const lastPage = Math.max(1, meta.last_page);
  const colCount = (showCollector ? 10 : 9) + (onRegenerate ? 1 : 0);

  return (
    <div className="card table-card">
      {title && (
        <div className="card-head" style={{ paddingBottom: 12 }}>
          <div>
            <h2 className="row" style={{ gap: 8 }}><Ticket className="ico-sm" />{title}</h2>
            {sub && <p className="sub">{sub}</p>}
          </div>
        </div>
      )}
      {/* Filters */}
      <div className="toolbar" style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
        <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <label htmlFor="codes-status" className="text-sm muted">{c("filterStatus")}</label>
          <select
            id="codes-status"
            value={status}
            onChange={(e) => onFilterChange(setStatus)(e.target.value as CodeStatus | "")}
            className="select input-sm"
            style={{ width: "auto" }}
          >
            <option value="">{c("allStatuses")}</option>
            <option value="pending">{c("st_pending")}</option>
            <option value="activated">{c("st_activated")}</option>
            <option value="expired">{c("st_expired")}</option>
          </select>
        </div>
        <DateRangeFilter
          from={from}
          to={to}
          onChange={(f, t2) => {
            setPage(1);
            setFrom(f);
            setTo(t2);
          }}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>
          <RotateCcw />
          {c("clearFilters")}
        </button>
        {exportCodes && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={doExport} style={{ marginInlineStart: "auto" }}>
            <Download />
            {c("exportExcel")}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>{c("colCode")}</th>
              <th>{c("colRef")}</th>
              <th>{c("method")}</th>
              <th>{c("colPlan")}</th>
              <th>{c("colCompany")}</th>
              {showCollector && <th>{c("colCollector")}</th>}
              <th className="r">{c("colAmount")}</th>
              <th>{c("colStatus")}</th>
              <th>{c("colCreated")}</th>
              <th>{c("colExpires")}</th>
              {onRegenerate && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono strong" style={{ letterSpacing: ".08em" }} dir="ltr">{r.code}</td>
                <td className="mono text-xs" dir="ltr">{r.payment_ref ?? c("none")}</td>
                <td>{paymentMethodLabel(r.payment_method, t)}</td>
                <td>{r.plan ?? c("none")}</td>
                <td><span className="truncate" style={{ display: "block", maxWidth: 190 }}>{r.company ?? c("none")}</span></td>
                {showCollector && <td>{r.collector ?? c("none")}</td>}
                <td className="r nowrap num">
                  {money(r.amount)}
                  <span className="text-xs" style={{ marginInlineStart: 6, color: r.paid ? "var(--success-fg)" : "var(--ink-subtle)" }}>
                    · {r.paid ? c("paid") : c("unpaid")}
                  </span>
                </td>
                <td><span className={`badge ${STATUS_TONE[r.status]}`}><span className="dot" />{c(`st_${r.status}`)}</span></td>
                <td className="num nowrap" dir="ltr">{date(r.created_at)}</td>
                <td className="num nowrap" dir="ltr">{date(r.expires_at)}</td>
                {onRegenerate && (
                  <td className="r">
                    {r.status === "expired" && r.plan_id !== null && (
                      <button
                        type="button"
                        onClick={() => regenerate(r)}
                        disabled={regenId !== null}
                        className="btn btn-secondary btn-sm"
                        title={c("regenerate")}
                      >
                        {regenId === r.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        {c("regenerate")}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={colCount}>
                <div className="empty">
                  <div className="empty-ico"><Ticket /></div>
                  <h3>{c("empty")}</h3>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <PagerBar
        range={c("totalN").replace("{n}", toLatinDigits(String(meta.total)))}
        page={meta.current_page}
        lastPage={lastPage}
        onPage={setPage}
      />
    </div>
  );
}
