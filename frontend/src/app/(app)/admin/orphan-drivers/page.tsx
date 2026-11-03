"use client";

import { useEffect, useState } from "react";
import { UserX, Phone, Mail, Star, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Pager } from "@/components/ui/pager";
import { useI18n } from "@/lib/i18n/context";
import { latnLocale } from "@/lib/utils";
import { getOrphanDrivers, type OrphanDriver } from "@/lib/api/admin";

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
    <div className="stack-lg">
      <PageHeader title={c("title")} subtitle={c("subtitle")} />

      <div className="toolbar between">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={c("searchPlaceholder")}
          className="max-w-[380px]"
        />
        <span className="muted text-sm num">{c("count").replace("{n}", total.toLocaleString(latnLocale(locale)))}</span>
      </div>

      <Card className="table-card">
        {loading && rows.length === 0 ? (
          <div className="stack-sm p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="skel h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <div className="empty-ico">
              <UserX className="h-6 w-6" />
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
                  <th>{c("colContact")}</th>
                  <th>{c("colUber")}</th>
                  <th>{c("colFormerCompany")}</th>
                  <th>{c("colRemoved")}</th>
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
                      {d.uber_rating == null && d.uber_total_trips == null ? (
                        <span className="subtle">—</span>
                      ) : (
                        <div>
                          {d.uber_rating != null && (
                            <span className="row num" style={{ gap: 4 }}>
                              <Star className="h-[14px] w-[14px] fill-amber-500 text-amber-500" /> {Number(d.uber_rating).toFixed(2)}
                            </span>
                          )}
                          {d.uber_total_trips != null && (
                            <div className="subtle text-xs num">
                              {c("trips").replace("{n}", d.uber_total_trips.toLocaleString(latnLocale(locale)))}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <Building2 className="h-[15px] w-[15px] shrink-0 text-ink-subtle" />
                        {d.former_company ?? "—"}
                      </span>
                    </td>
                    <td className="num">{fmtDate(d.roster_removed_at)}</td>
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
