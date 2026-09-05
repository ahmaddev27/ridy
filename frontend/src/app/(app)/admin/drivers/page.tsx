"use client";

import { useEffect, useState } from "react";
import { Users, Phone, Mail, Star, ChevronLeft, ChevronRight, Loader2, Building2, Navigation } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { latnLocale } from "@/lib/utils";
import { getAdminDrivers, listCompanies, type AdminDriver, type DriverDirectoryStats, type Company } from "@/lib/api/admin";

type StatusFilter = "" | "online" | "available" | "en_route" | "on_trip" | "offline";

/**
 * Driver thumbnail that falls back to an initials placeholder — the Uber picture
 * URLs are often expired/blocked, so a broken <img> degrades to initials.
 */
function DriverAvatar({ name, picture }: { name: string | null; picture: string | null }) {
  const [broken, setBroken] = useState(false);
  const initials = (name ?? "—").slice(0, 2).toUpperCase();
  if (!picture || broken) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-muted">
        {initials}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-9 w-9 shrink-0 rounded-full object-cover" />
  );
}

/** Live status chip: offline (grey), available (green), en route (amber), on trip (blue). */
function StatusChip({ online, engagement, c }: { online: boolean; engagement: number; c: (k: string) => string }) {
  const m = !online
    ? { key: "stOffline", color: "#94a3b8" }
    : engagement === 2
      ? { key: "stOnTrip", color: "#2563eb" }
      : engagement === 1
        ? { key: "stEnRoute", color: "#d97706" }
        : { key: "stAvailable", color: "#059669" };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-muted">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
      {c(m.key)}
    </span>
  );
}

export default function AdminDriversPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.adminDrivers.${k}`);

  const [rows, setRows] = useState<AdminDriver[]>([]);
  const [stats, setStats] = useState<DriverDirectoryStats>({ total: 0, online: 0, rate: 0 });
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [companyId, setCompanyId] = useState<number | "">("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listCompanies()
      .then((c) => setCompanies([...c].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const id = setTimeout(() => {
      getAdminDrivers(page, search, status, companyId || undefined)
        .then((r) => {
          if (!alive) return;
          setRows(r.items);
          setStats(r.stats);
          setLastPage(r.lastPage);
          setTotal(r.total);
        })
        .catch(() => alive && setRows([]))
        .finally(() => alive && setLoading(false));
    }, search ? 300 : 0);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [page, search, status, companyId]);

  const num = (n: number) => n.toLocaleString(latnLocale(locale));

  const statCards = [
    { label: c("statOnline"), value: num(stats.online), color: "text-success-fg" },
    { label: c("statRate"), value: `${stats.rate}%`, color: "text-ink" },
    { label: c("statTotal"), value: num(stats.total), color: "text-ink" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={c("title")} subtitle={c("subtitle")} />

      {/* Fleet stats — online / rate / total */}
      <div className="grid grid-cols-3 gap-3">
        {statCards.map((x) => (
          <Card key={x.label} className="p-4 text-center">
            <div className={`text-2xl font-bold tabular-nums ${x.color}`}>{x.value}</div>
            <div className="mt-0.5 text-xs text-ink-subtle">{x.label}</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={c("searchPlaceholder")}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value ? Number(e.target.value) : "");
              setPage(1);
            }}
            className="max-w-[180px] rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
          >
            <option value="">{c("allCompanies")}</option>
            {companies.map((co) => (
              <option key={co.id} value={co.id}>
                {co.name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setPage(1);
            }}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
          >
            <option value="">{c("filterAll")}</option>
            <option value="online">{c("filterOnline")}</option>
            <option value="available">{c("filterAvailable")}</option>
            <option value="en_route">{c("filterEnRoute")}</option>
            <option value="on_trip">{c("filterOnTrip")}</option>
            <option value="offline">{c("filterOffline")}</option>
          </select>
          <span className="shrink-0 text-sm text-ink-subtle">{c("count").replace("{n}", num(total))}</span>
        </div>
      </div>

      <Card className="overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-ink-subtle">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title={c("emptyTitle")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-subtle [&_th]:px-4 [&_th]:py-3 [&_th]:text-start [&_th]:font-semibold">
                <tr>
                  <th>{c("colDriver")}</th>
                  <th>{c("colStatus")}</th>
                  <th>{c("colOffer")}</th>
                  <th>{c("colContact")}</th>
                  <th>{c("colCompany")}</th>
                  <th>{c("colUber")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <DriverAvatar name={d.name} picture={d.uber_picture_url} />
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
                      <StatusChip online={d.online} engagement={d.engagement} c={c} />
                    </td>
                    <td className="max-w-[220px] px-4 py-3">
                      {d.active_offer ? (
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-ink">
                            <Navigation className="h-3.5 w-3.5 shrink-0 text-primary" />
                            <span className="truncate">{d.active_offer.dropoff ?? "—"}</span>
                            {d.active_offer.stops_count >= 2 && (
                              <span className="shrink-0 rounded bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
                                🟦×{d.active_offer.stops_count}
                              </span>
                            )}
                          </div>
                          {d.active_offer.fare && <div className="mt-0.5 text-xs text-ink-subtle">{d.active_offer.fare}</div>}
                        </div>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        {d.phone && (
                          <a href={`tel:${d.phone}`} dir="ltr" className="inline-flex items-center gap-1.5 text-ink hover:underline">
                            <Phone className="h-3.5 w-3.5 text-ink-subtle" /> {d.phone}
                          </a>
                        )}
                        {(d.email || d.uber_email) && (
                          <a href={`mailto:${d.email ?? d.uber_email}`} dir="ltr" className="inline-flex items-center gap-1.5 text-ink hover:underline">
                            <Mail className="h-3.5 w-3.5 text-ink-subtle" /> {d.email ?? d.uber_email}
                          </a>
                        )}
                        {!d.phone && !d.email && !d.uber_email && <span className="text-ink-subtle">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-ink-muted">
                        <Building2 className="h-3.5 w-3.5 text-ink-subtle" /> {d.company ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5 text-ink-muted">
                        {d.uber_rating != null && (
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 text-amber-500" /> {Number(d.uber_rating).toFixed(2)}
                          </span>
                        )}
                        {d.uber_total_trips != null && <span className="text-xs text-ink-subtle">{c("trips").replace("{n}", num(d.uber_total_trips))}</span>}
                        {d.uber_rating == null && d.uber_total_trips == null && <span className="text-ink-subtle">—</span>}
                      </div>
                    </td>
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
