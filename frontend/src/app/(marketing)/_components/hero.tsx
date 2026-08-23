"use client";

import { useEffect, useState } from "react";
import { Truck, Euro, ShieldCheck } from "lucide-react";
import { PhoneMockup } from "./phone-mockup";
import { SCREENS } from "./phone-screens";
import { StoreButtons } from "./store-buttons";

const CHIPS = [
  { icon: Truck, label: "Unbegrenzte Flotte" },
  { icon: Euro, label: "€/km Bewertung" },
  { icon: ShieldCheck, label: "DSGVO-konform" },
];

export function Hero() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setActive((i) => (i + 1) % SCREENS.length), 2000);
    return () => clearInterval(id);
  }, []);

  const Screen = SCREENS[active];

  return (
    <section
      id="top"
      className="relative overflow-hidden px-5 pb-16 pt-16 lg:px-8 lg:pb-28 lg:pt-20"
    >
      <div
        className="mkt-glow"
        style={{ top: -120, left: "50%", width: 700, height: 500, transform: "translateX(-50%)" }}
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <div>
          <h1 className="font-heading text-4xl font-bold leading-[1.08] text-white sm:text-5xl lg:text-[3.4rem]">
            Jedes Fahrtangebot{" "}
            <span
              style={{
                background: "linear-gradient(100deg,#34d399,#059669)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              klar bewertet
            </span>
            , bevor dein Fahrer zusagt.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-[#9ca3af] lg:text-lg">
            Reidey ersetzt das Rechnen im Kopf durch eine einzige App: Fahrpreis,
            €/km, Distanz und Route auf einen Blick — in den fünf Sekunden, bevor
            das Angebot abläuft.
          </p>

          <div className="mt-8">
            <StoreButtons />
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {CHIPS.map((chip) => (
              <div
                key={chip.label}
                className="glass flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm text-white/85"
              >
                <chip.icon size={16} className="text-[#10b981]" />
                {chip.label}
              </div>
            ))}
          </div>
        </div>

        <div className="hidden justify-center lg:flex" style={{ perspective: 900 }}>
          <PhoneMockup
            width={300}
            style={{ transform: "rotateY(-14deg) rotateX(6deg)" }}
          >
            <Screen />
          </PhoneMockup>
        </div>
      </div>
    </section>
  );
}
