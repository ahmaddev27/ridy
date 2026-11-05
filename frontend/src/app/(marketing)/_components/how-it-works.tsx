import { Container, SectionHeading } from "./ui";
import { TiltCard } from "./tilt-card";

const STEPS = [
  {
    n: "01",
    title: "Angebot trifft ein",
    body: "Reidey erkennt das Angebot und meldet es mit hoher Priorität — auf dem Sperrbildschirm, mit Ton, auch wenn die App geschlossen ist.",
  },
  {
    n: "02",
    title: "In einem Blick bewerten",
    body: "Großer Fahrpreis, €/km, Distanz und Route. Ein ruhiger Countdown zeigt, wie viel Zeit bleibt: grün, amber, rot.",
  },
  {
    n: "03",
    title: "Fahrt bestätigen",
    body: "Die Annahme erfolgt in der Fahr-App des Fahrers. Reidey greift nie in den Auftrag ein — es zeigt das Angebot und protokolliert.",
  },
];

export function HowItWorks() {
  return (
    <section id="ablauf" className="py-14 lg:py-28">
      <Container>
        <SectionHeading
          eyebrow="So funktioniert es"
          eyebrowColor="#67e8f9"
          title="Drei Schritte. Keine Einlernphase."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((step) => (
            <TiltCard
              key={step.n}
              className="card-modern relative overflow-hidden rounded-3xl p-7"
            >
              <span className="font-heading pointer-events-none absolute -right-2 -top-2 text-7xl font-bold text-white/[0.05]">
                {step.n}
              </span>
              <div className="relative">
                <div className="bg-gradient-accent font-heading mb-5 inline-flex h-10 w-10 items-center justify-center rounded-xl font-bold text-white">
                  {step.n}
                </div>
                <h3 className="font-heading mb-3 text-xl font-semibold text-white">
                  {step.title}
                </h3>
                <p className="leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            </TiltCard>
          ))}
        </div>
      </Container>
    </section>
  );
}
