"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PhoneMockup } from "./phone-mockup";
import { SCREENS, SCREEN_INFO } from "./phone-screens";
import { Container, SectionHeading } from "./ui";

export function AppShowcase() {
  const [active, setActive] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);
  const Screen = SCREENS[active];

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const go = (dir: number) =>
    setActive((i) => (i + dir + SCREENS.length) % SCREENS.length);

  return (
    <section id="app" className="relative overflow-hidden py-14 lg:py-28">
      <div
        className="bg-gradient-accent pointer-events-none absolute left-1/2 top-40 h-[300px] w-[600px] -translate-x-1/2 rounded-full"
        style={{ opacity: 0.06, filter: "blur(120px)" }}
      />
      <Container className="relative">
        <SectionHeading
          eyebrow="Ein Blick ins Produkt"
          eyebrowColor="#67e8f9"
          align="left"
          title="Bildschirme, die wirklich benutzt werden."
          sub="Echte Module, die deine Fahrer jeden Tag nutzen. Tippe durch die Screens."
        />

        <div className="mt-12 grid items-center gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          <div className="relative" style={{ perspective: 1500 }}>
            <div className="relative mx-auto w-[280px] sm:w-[300px]">
              <div
                className="bg-gradient-accent pointer-events-none absolute -inset-10 rounded-full opacity-20"
                style={{ filter: "blur(48px)" }}
              />
              <PhoneMockup
                width={isDesktop ? 300 : 280}
                style={{
                  transform: isDesktop
                    ? "rotateY(-14deg) rotateX(6deg)"
                    : "rotateY(0deg) rotateX(0deg)",
                  transformStyle: "preserve-3d",
                  transition: "transform 500ms ease",
                }}
              >
                <Screen />
              </PhoneMockup>
            </div>

            <div className="mt-8 flex items-center justify-center gap-3">
              <button
                type="button"
                aria-label="Zurück"
                onClick={() => go(-1)}
                className="glass flex h-11 w-11 items-center justify-center rounded-xl text-white transition-colors hover:border-white/10"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-2">
                {SCREENS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={SCREEN_INFO[i].label}
                    onClick={() => setActive(i)}
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: i === active ? 32 : 8,
                      background: i === active
                        ? "linear-gradient(100deg,#10b981,#059669)"
                        : "rgba(255,255,255,0.15)",
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                aria-label="Weiter"
                onClick={() => go(1)}
                className="glass flex h-11 w-11 items-center justify-center rounded-xl text-white transition-colors hover:border-white/10"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {SCREEN_INFO.map((row, i) => {
              const on = i === active;
              return (
                <button
                  key={row.label}
                  type="button"
                  onClick={() => setActive(i)}
                  className={`card-modern flex w-full items-center gap-4 rounded-3xl p-5 text-left transition-all ${
                    on ? "" : "opacity-80 hover:opacity-100"
                  }`}
                >
                  <span
                    className={`font-heading flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition-colors ${
                      on ? "text-white" : "text-muted-foreground"
                    }`}
                    style={
                      on
                        ? { background: "linear-gradient(100deg,#10b981,#059669)" }
                        : { background: "rgba(255,255,255,0.05)" }
                    }
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex-1">
                    <div className="font-heading text-lg font-semibold text-white">
                      {row.label}
                    </div>
                    <div className="text-sm text-muted-foreground">{row.note}</div>
                  </div>
                  <ChevronRight
                    className="h-5 w-5 transition-opacity"
                    style={{ color: "#67e8f9", opacity: on ? 1 : 0 }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </Container>
    </section>
  );
}
