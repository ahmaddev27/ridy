"use client";

import { useEffect, useState } from "react";
import { UserX, Phone, Mail, Star, ChevronLeft, ChevronRight, Loader2, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { latnLocale } from "@/lib/utils";
import { getOrphanDrivers, type OrphanDriver } from "@/lib/api/admin";

export default function OrphanDriversPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.orphanDrivers.${k}`);

  const [rows, setRows] = useState<OrphanDriver[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const id = setTimeout(() => {
      getOrphanDrivers(page, search)
        .then((r) => {
          if (!alive) return;
          setRows(r.items);
          setLastPage(r.lastPage);
          setTotal(r.total);
        })
        .catch(() => alive && setRows([]))
        .finally(() => alive && setLoading(false));
    }, search ? 300 : 0); // debounce typing, immediate on page change
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [page, search]);

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(latnLocale(locale)) : "—");

  return (
    <div className="space-y-4">
      <PageHeader title={c("title")} subtitle={c("subtitle")} />

      <div className="flex items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={c("searchPlaceholder")}
        />
        <span className="shrink-0 text-sm text-ink-subtle">{c("count").replace("{n}", total.toLocaleString(latnLocale(locale)))}</span>
      </div>

      <Card className="overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-ink-subtle">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={UserX} title={c("emptyTitle")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-subtle [&_th]:px-4 [&_th]:py-3 [&_th]:text-start [&_th]:font-semibold">
                <tr>
                  <th>{c("colDriver")}</th>
                  <th>{c("colContact")}</th>
                  <th>{c("colUber")}</th>
                  <th>{c("colFormerCompany")}</th>
                  <th>{c("colRemoved")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {d.uber_picture_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={d.uber_picture_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-muted">
                            {(d.name ?? "—").slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink">{d.name ?? "—"}</div>
                          {d.app_registered ? (
                            <Badge status="connected">{c("appRegistered")}</Badge>
                          ) : (
                            <span className="text-[11px] text-ink-subtle">{c("notRegistered")}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1" dir="ltr">
                        {d.phone && (
                          <a href={`tel:${d.phone}`} className="inline-flex items-center gap-1.5 text-ink hover:underline">
                            <Phone className="h-3.5 w-3.5 text-ink-subtle" /> {d.phone}
                          </a>
                        )}
                        {(d.email || d.uber_email) && (
                          <a
                            href={`mailto:${d.email ?? d.uber_email}`}
                            className="inline-flex items-center gap-1.5 text-ink hover:underline"
                          >
                            <Mail className="h-3.5 w-3.5 text-ink-subtle" /> {d.email ?? d.uber_email}
                          </a>
                        )}
                        {!d.phone && !d.email && !d.uber_email && <span className="text-ink-subtle">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5 text-ink-muted">
                        {d.uber_rating != null && (
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 text-amber-500" /> {Number(d.uber_rating).toFixed(2)}
                          </span>
                        )}
                        {d.uber_total_trips != null && (
                          <span className="text-xs text-ink-subtle">
                            {c("trips").replace("{n}", d.uber_total_trips.toLocaleString(latnLocale(locale)))}
                          </span>
                        )}
                        {d.uber_rating == null && d.uber_total_trips == null && <span className="text-ink-subtle">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-ink-muted">
                        <Building2 className="h-3.5 w-3.5 text-ink-subtle" /> {d.former_company ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{fmtDate(d.roster_removed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {lastPage > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-line p-2 text-ink-muted transition hover:bg-surface-2 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-ink-muted">{c("pageOf").replace("{p}", String(page)).replace("{t}", String(lastPage))}</span>
          <button
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage}
            className="rounded-lg border border-line p-2 text-ink-muted transition hover:bg-surface-2 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
