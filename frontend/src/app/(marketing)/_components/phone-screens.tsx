import { Home, FileText, List, BarChart2 } from "lucide-react";

/**
 * Four static, styled app screens rendered inside the phone mockups
 * (Hero + AppShowcase). Pure presentational components — no canvas, no images.
 */

const GREEN = "#10b981";
const DEEP = "#059669";

function TabBar({ active, dark }: { active: number; dark: boolean }) {
  const icons = [Home, FileText, List, BarChart2];
  const inactive = dark ? "#4b5563" : "#9ca3af";
  const barBg = dark ? "#0f0f12" : "#ffffff";
  const barBorder = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  return (
    <div
      className="mt-auto flex items-center justify-around px-2 py-3"
      style={{ background: barBg, borderTop: `1px solid ${barBorder}` }}
    >
      {icons.map((Icon, i) => (
        <Icon
          key={i}
          size={20}
          strokeWidth={2}
          color={i === active ? GREEN : inactive}
        />
      ))}
    </div>
  );
}

function ScreenFrame({
  dark,
  children,
}: {
  dark: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex h-full w-full flex-col"
      style={{
        background: dark ? "#0a0b0f" : "#f6f7f9",
        color: dark ? "#e5e7eb" : "#111827",
      }}
    >
      {children}
    </div>
  );
}

export function HomeScreen() {
  const offers = [
    { tier: "€€€", route: "Hbf → Flughafen", fare: "€18.40", km: "€1.29/km" },
    { tier: "€€", route: "Südstadt → Mitte", fare: "€9.20", km: "€1.12/km" },
    { tier: "€", route: "West → Hafen", fare: "€6.10", km: "€0.94/km" },
  ];
  return (
    <ScreenFrame dark={false}>
      <div className="flex flex-1 flex-col gap-4 overflow-hidden px-4 pt-8">
        <div>
          <p className="text-lg font-semibold" style={{ color: "#111827" }}>
            Hallo, Ahmed
          </p>
          <p className="text-xs" style={{ color: "#6b7280" }}>
            Bereit für die Schicht
          </p>
        </div>

        <div
          className="rounded-2xl p-4 text-white"
          style={{ background: `linear-gradient(100deg, ${GREEN}, ${DEEP})` }}
        >
          <p className="text-[10px] uppercase tracking-widest opacity-80">Heute</p>
          <p className="mt-1 text-2xl font-bold">€84</p>
          <p className="text-[11px] opacity-90">+12% vs Gestern</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <p className="text-[9px] uppercase tracking-widest" style={{ color: "#9ca3af" }}>
              Angebote
            </p>
            <p className="mt-1 text-lg font-bold" style={{ color: "#111827" }}>
              142
            </p>
          </div>
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <p className="text-[9px] uppercase tracking-widest" style={{ color: "#9ca3af" }}>
              Annahme
            </p>
            <p className="mt-1 text-lg font-bold" style={{ color: "#111827" }}>
              84%
            </p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold" style={{ color: "#374151" }}>
            Letzte Angebote
          </p>
          <div className="flex flex-col gap-2">
            {offers.map((o) => (
              <div
                key={o.route}
                className="flex items-center justify-between rounded-xl bg-white px-3 py-2 shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="rounded-md px-1.5 py-0.5 text-[9px] font-bold"
                    style={{ background: "#ecfdf5", color: DEEP }}
                  >
                    {o.tier}
                  </span>
                  <div>
                    <p className="text-[11px] font-medium" style={{ color: "#111827" }}>
                      {o.route}
                    </p>
                    <p className="text-[9px]" style={{ color: "#9ca3af" }}>
                      {o.km}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-bold" style={{ color: "#111827" }}>
                  {o.fare}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <TabBar active={0} dark={false} />
    </ScreenFrame>
  );
}

export function OfferScreen() {
  return (
    <ScreenFrame dark>
      <div className="flex flex-1 flex-col items-center gap-4 px-5 pt-8">
        <div className="flex w-full items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: "#9ca3af" }}>
            Angebot
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-bold"
            style={{ background: "rgba(16,185,129,0.15)", color: GREEN }}
          >
            5s
          </span>
        </div>

        <div className="relative flex h-28 w-28 items-center justify-center">
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke={GREEN}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray="276"
              strokeDashoffset="70"
              transform="rotate(-90 50 50)"
            />
          </svg>
          <span className="text-2xl font-bold text-white">€18.40</span>
        </div>

        <p className="text-sm font-semibold" style={{ color: GREEN }}>
          €1.29/km · €€€
        </p>

        <div className="w-full rounded-2xl p-4" style={{ background: "#14161c" }}>
          <p className="text-sm font-medium text-white">Hauptbahnhof → Flughafen</p>
          <p className="mt-1 text-xs" style={{ color: "#9ca3af" }}>
            14.2 km
          </p>
        </div>

        <button
          className="mt-auto mb-4 w-full rounded-2xl py-3 text-sm font-bold text-white"
          style={{ background: `linear-gradient(100deg, ${GREEN}, ${DEEP})` }}
        >
          Annehmen
        </button>
      </div>
      <TabBar active={1} dark />
    </ScreenFrame>
  );
}

export function ListScreen() {
  const rows = [
    { t: "14:02", r: "Hbf → Flughafen", f: "€18.40", km: "1.29", rej: false },
    { t: "13:48", r: "Südstadt → Mitte", f: "€9.20", km: "1.12", rej: false },
    { t: "13:21", r: "Messe → Hotel", f: "€14.60", km: "1.31", rej: false },
    { t: "12:55", r: "West → Hafen", f: "€6.10", km: "0.94", rej: true },
    { t: "12:30", r: "Ost → Bahnhof", f: "€8.40", km: "1.18", rej: false },
    { t: "12:02", r: "Nord → Industrie", f: "€5.20", km: "0.88", rej: true },
  ];
  return (
    <ScreenFrame dark>
      <div className="flex flex-1 flex-col gap-2 overflow-hidden px-4 pt-8">
        <p className="mb-1 text-lg font-semibold text-white">Angebote</p>
        {rows.map((row) => (
          <div
            key={row.t}
            className="flex items-center justify-between rounded-xl px-3 py-2"
            style={{ background: "#14161c", opacity: row.rej ? 0.55 : 1 }}
          >
            <div>
              <p className="text-[11px] font-medium text-white">
                <span style={{ color: "#6b7280" }}>{row.t}</span> {row.r}
              </p>
              <p className="text-[9px]" style={{ color: row.rej ? "#f87171" : "#9ca3af" }}>
                {row.km} €/km{row.rej ? " · abgelehnt" : ""}
              </p>
            </div>
            <span className="text-[11px] font-bold text-white">{row.f}</span>
          </div>
        ))}
      </div>
      <TabBar active={2} dark />
    </ScreenFrame>
  );
}

export function StatsScreen() {
  const bars = [
    { d: "M", h: 40 },
    { d: "D", h: 55 },
    { d: "M", h: 48 },
    { d: "D", h: 62 },
    { d: "F", h: 90, hot: true },
    { d: "S", h: 70 },
    { d: "S", h: 35 },
  ];
  return (
    <ScreenFrame dark={false}>
      <div className="flex flex-1 flex-col gap-4 px-4 pt-8">
        <div>
          <p className="text-lg font-semibold" style={{ color: "#111827" }}>
            Statistik
          </p>
          <p className="text-xs" style={{ color: "#6b7280" }}>
            Diese Woche
          </p>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-2xl font-bold" style={{ color: "#111827" }}>
            €1.260
          </p>
          <p className="text-[11px]" style={{ color: DEEP }}>
            +8% vs Vorwoche
          </p>
          <div className="mt-4 flex h-24 items-end justify-between gap-1.5">
            {bars.map((b, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-md"
                  style={{
                    height: `${b.h}%`,
                    background: b.hot ? GREEN : "#d1fae5",
                  }}
                />
                <span className="text-[8px]" style={{ color: "#9ca3af" }}>
                  {b.d}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <p className="text-[9px] uppercase tracking-widest" style={{ color: "#9ca3af" }}>
              Annahme
            </p>
            <p className="mt-1 text-lg font-bold" style={{ color: "#111827" }}>
              84%
            </p>
          </div>
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <p className="text-[9px] uppercase tracking-widest" style={{ color: "#9ca3af" }}>
              Ø €/km
            </p>
            <p className="mt-1 text-lg font-bold" style={{ color: "#111827" }}>
              1.26
            </p>
          </div>
        </div>
      </div>
      <TabBar active={3} dark={false} />
    </ScreenFrame>
  );
}

export const SCREENS = [HomeScreen, OfferScreen, ListScreen, StatsScreen];
