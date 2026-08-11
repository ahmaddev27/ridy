"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Users, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/context";
import { listDrivers, type Driver } from "@/lib/api/drivers";
import { fetchDriverStatusesViaExtension } from "@/lib/extension";

/** A driver on a trip vs. merely online — Uber's MONITORING_SUPPLY_STATUS_*. */
function presence(d: Driver): "on_trip" | "online" {
  return (d.online_status ?? "").includes("ON_TRIP") ? "on_trip" : "online";
}

/**
 * Live panel of the company's online drivers. Uber does not expose real GPS to
 * us (coordinates come back as 0,0), so instead of a map this lists who is
 * online / on a trip. It refreshes presence from Uber (via the extension) on a
 * timer so the list stays current.
 */
export function OnlineDrivers() {
  const { t } = useI18n();
  const k = (key: string) => t(`screens.dashboard.${key}`);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      const list = await listDrivers();
      const uuids = list.map((d) => d.uber_driver_uuid).filter((u): u is string => Boolean(u));
      // Best-effort live presence pull via the extension, then reload.
      const res = await fetchDriverStatusesViaExtension(uuids).catch(() => null);
      setDrivers(res?.ok ? await listDrivers() : list);
    } catch {
      /* keep the last snapshot */
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 45000); // keep presence fresh
    return () => clearInterval(id);
  }, [refresh]);

  const online = drivers.filter((d) => d.online);

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-800">{k("onlineTitle")}</h3>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            {online.length}
          </span>
        </div>
        <button
          onClick={refresh}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          title={k("refresh")}
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {online.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
          <Users className="h-6 w-6" />
          <p className="text-sm">{k("onlineNone")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {online.map((d) => {
            const p = presence(d);
            return (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                <div className="relative">
                  {d.picture_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.picture_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                      {d.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <span
                    className={`absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-white ${p === "on_trip" ? "bg-sky-500" : "bg-emerald-500"}`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">{d.name}</div>
                  {d.phone && <div className="truncate text-xs text-slate-400" dir="ltr">{d.phone}</div>}
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p === "on_trip" ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"}`}
                >
                  {p === "on_trip" ? k("onTrip") : k("online")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
