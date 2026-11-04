import Link from "next/link";
import { Truck, Euro, ShieldCheck } from "lucide-react";
import { HomeScreen, OfferScreen } from "./phone-screens";
import { StoreButtons } from "./store-buttons";

const CHIPS = [
  { icon: Truck, label: "Unbegrenzte Flotte" },
  { icon: Euro, label: "€/km Bewertung" },
  { icon: ShieldCheck, label: "DSGVO-konform" },
];

/** Phone frame around a JSX app screen (aspect matches the screens' 512x1044). */
function Phone({ width, children, className = "" }: { width: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`mkt-phone ${className}`} style={{ width }}>
      <div
        className="overflow-hidden"
        style={{ aspectRatio: "512 / 1044", borderRadius: "clamp(20px, 4vw, 32px)" }}
      >
        {children}
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section id="top" className="mkt-band">
    <div className="mkt-wrap grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-center gap-[clamp(30px,5vw,56px)] pt-[clamp(44px,7vw,64px)]">
      <div className="flex flex-col gap-[clamp(20px,3vw,26px)] pb-[clamp(40px,7vw,96px)]">
        <h1 className="text-[clamp(33px,5.4vw,60px)] font-semibold leading-[1.05] tracking-[-0.03em]">
          Jedes Fahrtangebot <span className="text-[#34d399]">klar bewertet</span>, bevor dein Fahrer zusagt.
        </h1>
        <p className="max-w-[30em] text-[clamp(16px,1.6vw,19px)] leading-[1.55] text-[var(--m-band-mut)]">
          Reidey ersetzt das Rechnen im Kopf durch eine einzige App: Fahrpreis, €/km, Distanz und Route auf einen
          Blick — in den fünf Sekunden, bevor das Angebot abläuft.
        </p>

        <div className="flex flex-wrap items-center gap-3.5">
          <a href="#kontakt" className="mkt-btn mkt-btn--band">
            Vertrieb kontaktieren
          </a>
          <Link href="/register" className="mkt-btn-ghost mkt-btn-ghost--band">
            Kostenlos testen
          </Link>
        </div>

        <div className="pt-1.5">
          <StoreButtons />
        </div>

        <ul className="flex flex-wrap items-center gap-2.5" aria-label="Eckdaten">
          {CHIPS.map((chip) => (
            <li
              key={chip.label}
              className="mkt-eyebrow mkt-eyebrow--band inline-flex items-center gap-1.5 rounded-full border border-[var(--m-band-line)] px-3 py-1.5"
            >
              <chip.icon size={13} className="text-[#34d399]" aria-hidden />
              {chip.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative flex items-end justify-center pt-5" aria-hidden>
        <Phone width="min(300px, 62vw)">
          <HomeScreen />
        </Phone>
        <Phone width="min(220px, 44vw)" className="absolute bottom-[clamp(-40px,-4vw,-16px)] start-0 hidden sm:block">
          <OfferScreen />
        </Phone>
      </div>
    </div>
    </section>
  );
}
