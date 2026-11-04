import { Timer, Calculator, Wallet, TrendingDown } from "lucide-react";
import { Container, Eyebrow } from "./ui";

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
    <section id="problem" className="mkt-section">
      <Container>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-start gap-[clamp(28px,4vw,56px)]">
          <div className="flex flex-col gap-4">
            <Eyebrow>Das Problem</Eyebrow>
            <h2 className="mkt-h2">Jedes Angebot kostet dich Sekunden — und oft Geld.</h2>
            <p className="mkt-lead">
              Ride-Hailing-Flotten verlieren Zeit und Umsatz mit manuellen Entscheidungen, die längst automatisch
              bewertet gehören.
            </p>
          </div>

          <div className="mkt-rule-grid sm:grid-cols-2">
            {ITEMS.map((item) => (
              <div key={item.title} className="mkt-cell flex flex-col gap-2">
                <item.icon size={22} strokeWidth={1.5} className="mb-1 text-primary" aria-hidden />
                <h3 className="text-[16.5px] font-semibold tracking-[-0.01em]">{item.title}</h3>
                <p className="text-[13.5px] leading-[1.5] text-ink-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
