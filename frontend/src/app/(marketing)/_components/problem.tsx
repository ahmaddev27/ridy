import { Timer, Calculator, Wallet, TrendingDown } from "lucide-react";
import { Container, SectionHeading } from "./ui";

const ITEMS = [
  {
    icon: Timer,
    title: "Fünf Sekunden Druck",
    body: "Das Zeitfenster pro Angebot ist winzig — zu langsam und die Fahrt ist weg.",
  },
  {
    icon: Calculator,
    title: "Rechnen im Kopf",
    body: "Fahrpreis gegen Distanz gegen Anfahrt — im Verkehr, oft ohne Blick aufs Display.",
  },
  {
    icon: Wallet,
    title: "Fahrten unter Kosten",
    body: "Wer zu schnell zusagt, akzeptiert oft Raten, die sich nicht rechnen.",
  },
  {
    icon: TrendingDown,
    title: "Kein €/km-Überblick",
    body: "Welche Fahrten tragen, welche nicht — bleibt im Bauchgefühl, nicht in Zahlen.",
  },
];

export function Problem() {
  return (
    <section id="problem" className="py-14 lg:py-28">
      <Container>
        <SectionHeading
          eyebrow="Das Problem"
          title="Jedes Angebot kostet dich Sekunden — und oft Geld."
          sub="Ride-Hailing-Flotten verlieren Zeit und Umsatz mit manuellen Entscheidungen, die längst automatisch bewertet gehören."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((item) => (
            <div key={item.title} className="card-modern rounded-3xl p-6">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-2xl"
                style={{ background: "rgba(16,185,129,0.12)" }}
              >
                <item.icon size={20} className="text-[#10b981]" />
              </div>
              <h3 className="mt-5 text-base font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#9ca3af]">{item.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
