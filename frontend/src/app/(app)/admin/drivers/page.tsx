"use client";

import { useEffect, useState } from "react";
import { Users, Phone, Mail, Star, Building2, Navigation } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Pager } from "@/components/ui/pager";
import { useI18n } from "@/lib/i18n/context";
import { latnLocale } from "@/lib/utils";
import { getAdminDrivers, listCompanies, type AdminDriver, type DriverDirectoryStats, type Company } from "@/lib/api/admin";

type StatusFilter = "" | "online" | "available" | "en_route" | "on_trip" | "offline";

/** Deterministic tint (.av.t0-t5) so a driver keeps the same avatar colour. */
function avTone(name: string | null): number {
  let h = 0;
  for (const ch of name ?? "") h = (h * 31 + ch.charCodeAt(0)) % 6;
  return h;
}

/**
 * Driver thumbnail that falls back to an initials placeholder — the Uber picture
 * URLs are often expired/blocked, so a broken <img> degrades to initials.
 */
function DriverAvatar({ name, picture }: { name: string | null; picture: string | null }) {
  const [broken, setBroken] = useState(false);
  const initials = (name ?? "—").slice(0, 2).toUpperCase();
  if (!picture || broken) {
    return <span className={`av t${avTone(name)}`}>{initials}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="av object-cover" />
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
    <span className="badge" style={{ gap: 7 }}>
      <span className="dot" style={{ background: m.color }} />
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
    { label: c("statOnline"), value: num(stats.online), tone: "pos" },
    { label: c("statRate"), value: `${stats.rate}%`, tone: "" },
    { label: c("statTotal"), value: num(stats.total), tone: "" },
  ];

  return (
    <div className="stack-lg">
      <PageHeader title={c("title")} subtitle={c("subtitle")} />

      {/* Fleet stats — online / rate / total */}
      <div className="grid g-3">
        {statCards.map((x) => (
          <div key={x.label} className="stat text-center">
            <div className="stat-top justify-center">
              <span className="truncate">{x.label}</span>
            </div>
            <div className={`stat-value ${x.tone}`} dir="ltr">
              {x.value}
            </div>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={c("searchPlaceholder")}
          className="max-w-[380px]"
        />
        <select
          value={companyId}
          onChange={(e) => {
            setCompanyId(e.target.value ? Number(e.target.value) : "");
            setPage(1);
          }}
          aria-label={c("colCompany")}
          className="select min-w-[200px] !w-auto"
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
          aria-label={c("colStatus")}
          className="select min-w-[150px] !w-auto"
        >
          <option value="">{c("filterAll")}</option>
          <option value="online">{c("filterOnline")}</option>
          <option value="available">{c("filterAvailable")}</option>
          <option value="en_route">{c("filterEnRoute")}</option>
          <option value="on_trip">{c("filterOnTrip")}</option>
          <option value="offline">{c("filterOffline")}</option>
        </select>
        <span className="muted text-sm num ms-auto">{c("count").replace("{n}", num(total))}</span>
      </div>

      <Card className="table-card">
        {loading && rows.length === 0 ? (
          <div className="stack-sm p-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skel h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <div className="empty-ico">
              <Users className="h-6 w-6" />
            </div>
            <h3>{c("emptyTitle")}</h3>
            <p>{c("emptyDesc")}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{c("colDriver")}</th>
                  <th>{c("colStatus")}</th>
                  <th>{c("colOffer")}</th>
                  <th>{c("colContact")}</th>
                  <th>{c("colCompany")}</th>
                  <th>{c("colUber")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div className="who">
                        <DriverAvatar name={d.name} picture={d.uber_picture_url} />
                        <div className="min-w-0">
                          <div className="n truncate">{d.name ?? "—"}</div>
                          <div className="s">
                            {d.app_registered ? (
                              <span className="badge success">
                                <span className="dot" />
                                {c("appRegistered")}
                              </span>
                            ) : (
                              <span className="subtle text-xs">{c("notRegistered")}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <StatusChip online={d.online} engagement={d.engagement} c={c} />
                    </td>
                    <td className="max-w-[280px]">
                      {d.active_offer ? (
                        <div className="min-w-0">
                          <div className="row" style={{ gap: 6 }}>
                            <Navigation className="h-[15px] w-[15px] shrink-0 text-primary" />
                            <span className="truncate">{d.active_offer.dropoff ?? "—"}</span>
                            {d.active_offer.stops_count >= 2 && <span className="badge square warning">×{num(d.active_offer.stops_count)}</span>}
                          </div>
                          {d.active_offer.fare && <div className="subtle text-xs num">{d.active_offer.fare}</div>}
                        </div>
                      ) : (
                        <span className="subtle">—</span>
                      )}
                    </td>
                    <td>
                      <div className="stack-sm" style={{ gap: 2, fontSize: 13 }}>
                        {d.phone && (
                          <a href={`tel:${d.phone}`} dir="ltr" className="row num" style={{ gap: 6 }}>
                            <Phone className="h-[15px] w-[15px] shrink-0 text-ink-subtle" /> {d.phone}
                          </a>
                        )}
                        {(d.email || d.uber_email) && (
                          <a href={`mailto:${d.email ?? d.uber_email}`} dir="ltr" className="row" style={{ gap: 6 }}>
                            <Mail className="h-[15px] w-[15px] shrink-0 text-ink-subtle" />
                            <span className="truncate max-w-[220px]">{d.email ?? d.uber_email}</span>
                          </a>
                        )}
                        {!d.phone && !d.email && !d.uber_email && <span className="subtle">—</span>}
                      </div>
                    </td>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <Building2 className="h-[15px] w-[15px] shrink-0 text-ink-subtle" />
                        <span className="truncate max-w-[190px]">{d.company ?? "—"}</span>
                      </span>
                    </td>
                    <td>
                      {d.uber_rating == null && d.uber_total_trips == null ? (
                        <span className="subtle">—</span>
                      ) : (
                        <div>
                          {d.uber_rating != null && (
                            <span className="row num" style={{ gap: 4 }}>
                              <Star className="h-[14px] w-[14px] fill-amber-500 text-amber-500" /> {Number(d.uber_rating).toFixed(2)}
                            </span>
                          )}
                          {d.uber_total_trips != null && <div className="subtle text-xs num">{c("trips").replace("{n}", num(d.uber_total_trips))}</div>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {lastPage > 1 && (
          <div className="tbl-foot">
            <Pager className="w-full" page={page} lastPage={lastPage} total={total} onPage={setPage} />
          </div>
        )}
      </Card>
    </div>
  );
}
