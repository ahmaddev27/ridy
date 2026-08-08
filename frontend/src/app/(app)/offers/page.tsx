"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Radio, MapPin, Search, Trash2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { listOffers, deleteOffer, bulkDeleteOffers, type DispatchOffer } from "@/lib/api/offers";

export default function OffersPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.offers.${k}`);

  const [offers, setOffers] = useState<DispatchOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [driverUuid, setDriverUuid] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setOffers(await listOffers({ search: search.trim(), driverUuid: driverUuid || undefined }));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setLoading(false);
    }
  }

  // Debounce search + react to the driver filter.
  useEffect(() => {
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, driverUuid]);

  // Distinct drivers present in the current feed, for the filter dropdown.
  const driverOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of offers) {
      if (o.driver_uuid) map.set(o.driver_uuid, o.driver_name ?? o.driver_uuid);
    }
    return [...map.entries()];
  }, [offers]);

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((s) => (s.size === offers.length ? new Set() : new Set(offers.map((o) => o.id))));
  }

  async function removeOne(id: number) {
    setBusy(true);
    try {
      await deleteOffer(id);
      toast.success(c("deletedToast"));
      await load();
    } catch (e) {
      toast.error(c("deleteFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const n = await bulkDeleteOffers([...selected]);
      toast.success(c("deletedToast"), { description: `${n}` });
      await load();
    } catch (e) {
      toast.error(c("deleteFailed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  const allSelected = offers.length > 0 && selected.size === offers.length;

  return (
    <div className="space-y-6">
      <PageHeader title={c("title")} subtitle={c("subtitle")} />

      {/* Toolbar: search + driver filter + bulk delete */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={c("searchPlaceholder")}
            className="w-full rounded-lg border border-slate-300 py-2 ps-9 pe-3 text-sm outline-none focus:border-black focus:ring-2 focus:ring-slate-200"
          />
        </div>
        <select
          value={driverUuid}
          onChange={(e) => setDriverUuid(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-2 focus:ring-slate-200"
        >
          <option value="">{c("filterAll")}</option>
          {driverOptions.map(([uuid, name]) => (
            <option key={uuid} value={uuid}>
              {name}
            </option>
          ))}
        </select>
        {selected.size > 0 && (
          <Button variant="secondary" onClick={removeSelected} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {c("deleteSelected")} ({selected.size})
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {c("loadError")} — {error}
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
          <EmptyState icon={Radio} title={c("empty")} description={c("emptyDesc")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  </th>
                  <th className="px-4 py-3 font-semibold">{c("colTime")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colDriver")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colRoute")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colFare")}</th>
                  <th className="px-4 py-3 font-semibold">{c("colStatus")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {offers.map((o) => (
                  <tr key={o.id} className={selected.has(o.id) ? "bg-slate-50" : "hover:bg-slate-50"}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggle(o.id)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {o.received_at ? new Date(o.received_at).toLocaleTimeString(locale) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{o.driver_name ?? "—"}</div>
                      <div className="font-mono text-[10px] text-slate-400">{o.driver_uuid}</div>
                    </td>
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
                        {o.linked ? c("linked") : c("unlinked")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => removeOne(o.id)}
                        disabled={busy}
                        className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title={c("delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
