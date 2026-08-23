"use client";

import { useEffect, useState } from "react";
import { Truck, Euro, ShieldCheck, Phone } from "lucide-react";
import { SCREENS, SCREEN_INFO } from "./phone-screens";
import { StoreButtons } from "./store-buttons";

const CHIPS = [
  { icon: Truck, label: "Unbegrenzte Flotte" },
  { icon: Euro, label: "€/km Bewertung" },
  { icon: ShieldCheck, label: "DSGVO-konform" },
];

const SLIDE_TRANSITION =
  "transform 2600ms cubic-bezier(0.22,1,0.36,1), opacity 2600ms cubic-bezier(0.22,1,0.36,1)";

/**
 * Auto-cycling phone that slides the app screens vertically, mirroring the
 * reference HeroPhone: a new screen every 2000ms, easing over 2600ms so the
 * previous screen scrolls up and out while the next scrolls in from below.
 */
function HeroPhone() {
  const [{ active, prev }, setState] = useState({ active: 1, prev: 0 });
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const id = setInterval(
      () =>
        setState((s) => ({
          prev: s.active,
          active: (s.active + 1) % SCREENS.length,
        })),
      2000,
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative" style={{ perspective: 1500 }}>
      <div
        className="bg-gradient-accent pointer-events-none absolute -inset-10 rounded-full opacity-25"
        style={{ filter: "blur(90px)" }}
        aria-hidden
      />
      <div
        className="relative mx-auto w-[280px] transition-transform duration-700 sm:w-[300px]"
        style={{
          transform: isDesktop
            ? "rotateY(-14deg) rotateX(6deg)"
            : "rotateY(0deg) rotateX(0deg)",
          transformStyle: "preserve-3d",
        }}
      >
        <div className="relative overflow-hidden rounded-[2.4rem] border border-white/10 bg-[#0f1116] p-2.5 shadow-2xl">
          <div className="absolute left-1/2 top-3 z-10 h-6 w-24 -translate-x-1/2 rounded-full bg-[#0a0b10]" />
          <div
            className="relative w-full overflow-hidden rounded-[2rem]"
            style={{ aspectRatio: "512 / 1044" }}
          >
            {SCREENS.map((Screen, i) => {
              const pos =
                i === active ? "active" : i === prev ? "prev" : "next";
              const transform =
                pos === "active"
                  ? "translateY(0) scale(1)"
                  : pos === "prev"
                    ? "translateY(-100%) scale(0.95)"
                    : "translateY(100%) scale(0.95)";
              return (
                <div
                  key={i}
                  className="absolute inset-0 h-full w-full overflow-hidden rounded-[2rem]"
                  style={{
                    transform,
                    opacity: pos === "active" ? 1 : 0,
                    transition: SLIDE_TRANSITION,
                    willChange: "transform, opacity",
                  }}
                >
                  <Screen />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-center gap-2">
        {SCREENS.map((_, i) => (
          <span
            key={i}
            className="h-1.5 rounded-full transition-all duration-700"
            style={{
              width: i === active ? 28 : 6,
              background: i === active
                ? "linear-gradient(100deg,#10b981,#059669)"
                : "rgba(255,255,255,0.15)",
            }}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <Phone className="h-3 w-3 text-primary" />
        <span>{SCREEN_INFO[active].label}</span>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden pb-16 pt-36 lg:pb-28 lg:pt-44"
    >
      <div
        className="bg-gradient-accent pointer-events-none absolute left-1/2 top-0 h-[400px] w-[800px] -translate-x-1/2 rounded-full"
        style={{ opacity: 0.08, filter: "blur(120px)" }}
      />

      <div className="relative mx-auto max-w-6xl px-5 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-8">
          <div className="text-center lg:text-left">
            <h1 className="font-heading text-[2rem] font-bold leading-[1.05] tracking-[-0.03em] text-balance text-white sm:text-5xl lg:text-[3.4rem]">
              Jedes Fahrtangebot{" "}
              <span className="text-gradient">klar bewertet</span>, bevor dein
              Fahrer zusagt.
            </h1>

            <p className="mx-auto mt-6 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0">
              Reidey ersetzt das Rechnen im Kopf durch eine einzige App:
              Fahrpreis, €/km, Distanz und Route auf einen Blick — in den fünf
              Sekunden, bevor das Angebot abläuft.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <StoreButtons />
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5 lg:justify-start">
              {CHIPS.map((chip) => (
                <span
                  key={chip.label}
                  className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground"
                >
                  <chip.icon className="h-3.5 w-3.5 text-primary" />
                  {chip.label}
                </span>
              ))}
            </div>
          </div>

          <div className="relative mt-4 hidden lg:mt-0 lg:block">
            <HeroPhone />
          </div>
        </div>
      </div>
    </section>
  );
}
