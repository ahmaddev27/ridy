"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, Phone, Mail, Star, Car, UserCheck, Loader2, Wallet, Clock, MapPin, Gauge } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/context";
import { getDriver, getDriverStats, type Driver, type DriverStats } from "@/lib/api/drivers";
import { fetchDriverMetricsViaExtension, type DriverMetrics } from "@/lib/extension";

type RangeKey = "today" | "yesterday" | "7" | "30" | "custom";

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function pct(v: number | string | null | undefined): string {
  const n = num(v);
  if (n == null) return "—";
  return `${(n <= 1 ? n * 100 : n).toFixed(0)}%`;
}
function eur(n: number | null): string {
  return n != null ? `€${n.toFixed(2)}` : "—";
}

/** Local-day window [from,to) in ms for the selected range. */
function rangeMs(key: RangeKey): { from: number; to: number } {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  if (key === "today") return { from: midnight, to: now.getTime() };
  if (key === "yesterday") return { from: midnight - day, to: midnight };
  return { from: now.getTime() - Number(key) * day, to: now.getTime() };
}

/** Uber's earnings_label is already formatted (e.g. "€2,478.75"); prefer it. */
function earningsDisplay(m: DriverMetrics): string {
  const label = typeof m.earnings_label === "string" ? m.earnings_label.trim() : "";
  if (label && /\d/.test(label)) return label;
  return eur(num(m.earnings));
}

function statusLabel(driver: Driver, d: (k: string) => string): { text: string; tone: string } {
  const s = (driver.online_status ?? "").toUpperCase();
  if (s.includes("ON_TRIP")) return { text: d("onTrip"), tone: "text-success-fg" };
  if (s.includes("EN_ROUTE")) return { text: d("enRoute"), tone: "text-warning-fg" };
  if (driver.online) return { text: d("online"), tone: "text-success-fg" };
  return { text: d("offline"), tone: "text-ink-subtle" };
}

export default function DriverProfilePage() {
  const { t } = useI18n();
  const d = (k: string) => t(`screens.drivers.${k}`);
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [driver, setDriver] = useState<Driver | null>(null);
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [tab, setTab] = useState<"performance" | "details">("performance");
  const [range, setRange] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [metrics, setMetrics] = useState<DriverMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  useEffect(() => {
    getDriver(id).then(setDriver).catch(() => setDriver(null));
  }, [id]);

  // The active window (ms for Uber metrics, Y-M-D for our stats), from a preset
  // or a custom from→to range.
  const win = useMemo(() => {
    if (range === "custom") {
      const fromMs = customFrom ? new Date(customFrom).getTime() : Date.now() - 7 * 86_400_000;
      const toMs = customTo ? new Date(customTo).getTime() + 86_400_000 : Date.now(); // include the "to" day
      return { fromMs, toMs, fromDate: customFrom || undefined, toDate: customTo || undefined };
    }
    const { from, to } = rangeMs(range);
    return { fromMs: from, toMs: to, fromDate: new Date(from).toISOString().slice(0, 10), toDate: new Date(to).toISOString().slice(0, 10) };
  }, [range, customFrom, customTo]);

  // Our own stats respect the same window.
  useEffect(() => {
    getDriverStats(id, win.fromDate, win.toDate).then(setStats).catch(() => setStats(null));
  }, [id, win.fromDate, win.toDate]);

  // Uber performance metrics for the window (via the extension).
  useEffect(() => {
    if (!driver?.uber_driver_uuid) return;
    setLoadingMetrics(true);
    setMetrics(null);
    fetchDriverMetricsViaExtension(driver.uber_driver_uuid, win.fromMs, win.toMs)
      .then(setMetrics)
      .finally(() => setLoadingMetrics(false));
  }, [driver?.uber_driver_uuid, win.fromMs, win.toMs]);

  const derived = useMemo(() => {
    if (!metrics) return null;
    const hoursOnline = num(metrics.hours_online) ?? 0;
    const hoursOnTrip = num(metrics.hours_on_trip) ?? 0;
    const earnings = num(metrics.earnings);
    const trips = num(metrics.trips);
    return {
      hoursOnline,
      utilization: hoursOnline > 0 ? (hoursOnTrip / hoursOnline) * 100 : null,
      earningsPerHour: earnings != null && hoursOnline > 0 ? earnings / hoursOnline : null,
      tripsPerHour: trips != null && hoursOnline > 0 ? trips / hoursOnline : null,
    };
  }, [metrics]);

  const status = driver ? statusLabel(driver, d) : null;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link href="/drivers" className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" /> {d("backToDrivers")}
      </Link>

      {/* Header — grounded in a card */}
      <Card className="flex items-center gap-4 p-5">
        {driver?.picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={driver.picture_url} alt="" className="h-20 w-20 rounded-full object-cover ring-2 ring-white shadow" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-2 text-2xl font-semibold text-ink">
            {driver?.name?.slice(0, 1) ?? "?"}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-ink">{driver?.name ?? "…"}</h1>
          {status && (
            <div className="mt-1 flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-xs font-semibold text-success-fg">
                {driver?.active ? d("active") : d("inactive")}
              </span>
              <span className="text-ink-subtle">·</span>
              <span className={`font-medium ${status.tone}`}>{status.text}</span>
            </div>
          )}
          {driver?.phone && <p className="mt-1 text-sm text-ink-subtle" dir="ltr">{driver.phone}</p>}
        </div>
      </Card>

      {/* Tabs (Uber-style underline) */}
      <div className="flex gap-6 border-b border-line">
        {([
          { k: "performance", label: d("tabPerformance") },
          { k: "details", label: d("tabDetails") },
        ] as const).map(({ k, label }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={
              "-mb-px border-b-2 px-1 pb-3 text-sm font-semibold transition-colors " +
              (tab === k ? "border-ink text-ink" : "border-transparent text-ink-subtle hover:text-ink-muted")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "performance" ? (
        <div className="space-y-5">
          {/* Range toggle */}
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-ink">{d("performanceData")}</h3>
            <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1 text-sm">
              {([
                { k: "today", label: d("today") },
                { k: "yesterday", label: d("yesterday") },
                { k: "7", label: `7${d("daysShort")}` },
                { k: "30", label: `30${d("daysShort")}` },
                { k: "custom", label: d("customRange") },
              ] as const).map(({ k, label }) => (
                <button
                  key={k}
                  onClick={() => setRange(k)}
                  className={"rounded-lg px-3 py-1.5 font-medium transition-colors " + (range === k ? "bg-primary text-primary-ink" : "text-ink-muted hover:text-ink")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom from → to */}
          {range === "custom" && (
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface-2 p-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-ink-muted">{d("from")}</span>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-ink" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-ink-muted">{d("to")}</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-ink" />
              </label>
            </div>
          )}

          {!driver?.uber_driver_uuid ? (
            <Card className="p-6 text-center text-sm text-ink-subtle">{d("notLinkedNoMetrics")}</Card>
          ) : loadingMetrics ? (
            <div className="flex items-center justify-center py-10 text-ink-subtle">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : metrics && derived ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <PerfCard icon={Wallet} title={d("cardEarnings")}
                primary={earningsDisplay(metrics)} primaryLabel={d("totalEarnings")}
                secondary={eur(derived.earningsPerHour)} secondaryLabel={d("earningsPerHour")} />
              <PerfCard icon={Clock} title={d("cardSupply")}
                primary={derived.hoursOnline.toFixed(2)} primaryLabel={d("onlineHours")}
                secondary={derived.utilization != null ? `${derived.utilization.toFixed(0)}%` : "—"} secondaryLabel={d("utilization")} />
              <PerfCard icon={MapPin} title={d("cardTrips")}
                primary={num(metrics.trips) != null ? String(num(metrics.trips)) : "—"} primaryLabel={d("mTrips")}
                secondary={derived.tripsPerHour != null ? derived.tripsPerHour.toFixed(2) : "—"} secondaryLabel={d("tripsPerHour")} />
              <PerfCard icon={Gauge} title={d("cardQuality")}
                primary={pct(metrics.acceptance_rate)} primaryLabel={d("acceptanceRate")}
                secondary={pct(metrics.cancellation_rate)} secondaryLabel={d("cancellationRate")} />
            </div>
          ) : (
            <Card className="p-6 text-center text-sm text-ink-subtle">{d("metricsUnavailable")}</Card>
          )}

          {/* Our own captured data */}
          {stats && (
            <Card className="p-5">
              <h4 className="mb-3 text-sm font-semibold text-ink">{d("ourData")}</h4>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <MiniStat label={d("statEarnings")} value={`€${stats.earnings.toFixed(2)}`} />
                <MiniStat label={d("statTrips")} value={String(stats.trips)} />
                <MiniStat label={d("statAccept")} value={`${stats.acceptance_rate}%`} />
                <MiniStat label={d("statOffers")} value={String(stats.offers)} />
                <MiniStat label={d("statAccepted")} value={String(stats.accepted)} />
                <MiniStat label={d("statKm")} value={`${stats.km} km`} />
              </div>
            </Card>
          )}
        </div>
      ) : (
        /* Details tab */
        <Card className="divide-y divide-line">
          <DetailRow icon={Star} label={d("colRating")}>
            {driver?.rating != null ? (
              <span className="inline-flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {driver.rating.toFixed(2)}
              </span>
            ) : "—"}
          </DetailRow>
          <DetailRow icon={Car} label={d("colTrips")}>{driver?.total_trips != null ? driver.total_trips.toLocaleString() : "—"}</DetailRow>
          <DetailRow icon={Phone} label={d("colPhone")}>{driver?.phone ? <span dir="ltr">{driver.phone}</span> : "—"}</DetailRow>
          <DetailRow icon={Mail} label={d("email")}>{driver?.uber_email ? <span dir="ltr">{driver.uber_email}</span> : "—"}</DetailRow>
          <DetailRow icon={UserCheck} label={d("linkMethod")}>
            {driver?.uber_link_method ? d(`linkMethod_${driver.uber_link_method}`) : "—"}
          </DetailRow>
        </Card>
      )}
    </div>
  );
}

function PerfCard({
  icon: Icon,
  title,
  primary,
  primaryLabel,
  secondary,
  secondaryLabel,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  primary: string;
  primaryLabel: string;
  secondary: string;
  secondaryLabel: string;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2 text-ink">
        <Icon className="h-4 w-4" />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="space-y-3">
        <div>
          <div className="text-2xl font-bold tabular-nums text-ink">{primary}</div>
          <div className="text-xs text-ink-subtle">{primaryLabel}</div>
        </div>
        <div className="border-t border-line pt-3">
          <div className="text-lg font-semibold tabular-nums text-ink">{secondary}</div>
          <div className="text-xs text-ink-subtle">{secondaryLabel}</div>
        </div>
      </div>
    </Card>
  );
}

function DetailRow({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <dt className="flex items-center gap-2 text-sm text-ink-muted">
        <Icon className="h-4 w-4 text-ink-subtle" /> {label}
      </dt>
      <dd className="min-w-0 truncate text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <div className="text-[11px] text-ink-subtle">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}
