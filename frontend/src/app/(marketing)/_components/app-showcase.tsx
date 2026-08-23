"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PhoneMockup } from "./phone-mockup";
import { SCREENS } from "./phone-screens";
import { Container, SectionHeading } from "./ui";

const ROWS = [
  { n: "01", label: "Start", note: "DE · Hell" },
  { n: "02", label: "Angebot", note: "Countdown" },
  { n: "03", label: "Liste", note: "DE · Dunkel" },
  { n: "04", label: "Statistik", note: "Kennzahlen" },
];

export function AppShowcase() {
  const [active, setActive] = useState(0);
  const Screen = SCREENS[active];
  const go = (dir: number) =>
    setActive((i) => (i + dir + SCREENS.length) % SCREENS.length);

  return (
    <section id="app" className="relative overflow-hidden py-14 lg:py-28">
      <div className="mkt-glow" style={{ top: 80, left: -120, width: 500, height: 500 }} />
      <Container className="relative">
        <SectionHeading
          eyebrow="Ein Blick ins Produkt"
          title="Bildschirme, die wirklich benutzt werden."
          sub="Echte Module, die deine Fahrer jeden Tag nutzen. Tippe durch die Screens."
        />

        <div className="mt-12 grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col items-center gap-6">
            <PhoneMockup width={280}>
              <Screen />
            </PhoneMockup>
            <div className="flex items-center gap-5">
              <button
                type="button"
                aria-label="Vorheriger Screen"
                onClick={() => go(-1)}
                className="glass flex h-10 w-10 items-center justify-center rounded-full text-white"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="flex gap-2">
                {SCREENS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Screen ${i + 1}`}
                    onClick={() => setActive(i)}
                    className="h-2 w-2 rounded-full transition-all"
                    style={{
                      background: i === active ? "#10b981" : "rgba(255,255,255,0.2)",
                      width: i === active ? 20 : 8,
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                aria-label="Nächster Screen"
                onClick={() => go(1)}
                className="glass flex h-10 w-10 items-center justify-center rounded-full text-white"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {ROWS.map((row, i) => {
              const on = i === active;
              return (
                <button
                  key={row.n}
                  type="button"
                  onClick={() => setActive(i)}
                  className="card-modern flex items-center justify-between rounded-2xl px-5 py-4 text-left transition-colors"
                  style={on ? { borderColor: "rgba(16,185,129,0.5)" } : undefined}
                >
                  <div className="flex items-center gap-4">
                    <span
                      className="font-mono-mkt text-sm"
                      style={{ color: on ? "#10b981" : "#6b7280" }}
                    >
                      {row.n}
                    </span>
                    <div>
                      <p
                        className="text-base font-semibold"
                        style={{ color: on ? "#10b981" : "#ffffff" }}
                      >
                        {row.label}
                      </p>
                      <p className="text-xs text-[#9ca3af]">{row.note}</p>
                    </div>
                  </div>
                  {on ? <ChevronRight size={18} className="text-[#10b981]" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </Container>
    </section>
  );
}
