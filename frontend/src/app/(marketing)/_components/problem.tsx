import { Timer, Calculator, Wallet, TrendingDown } from "lucide-react";
import { Container, SectionHeading } from "./ui";
import { TiltCard } from "./tilt-card";

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
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((item) => (
            <TiltCard key={item.title} className="card-modern rounded-3xl p-6">
              <div className="bg-gradient-accent-soft mb-4 flex h-11 w-11 items-center justify-center rounded-xl">
                <item.icon size={20} className="text-primary" />
              </div>
              <h3 className="font-heading mb-2 text-lg font-semibold text-white">
                {item.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </TiltCard>
          ))}
        </div>
      </Container>
    </section>
  );
}
