import { Container, SectionHeading } from "./ui";

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
          title="Drei Schritte. Keine Einlernphase."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n} className="card-modern relative overflow-hidden rounded-3xl p-7">
              <span className="pointer-events-none absolute right-4 top-2 text-7xl font-bold text-white/[0.05]">
                {step.n}
              </span>
              <div
                className="flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold text-white"
                style={{ background: "linear-gradient(100deg,#10b981,#059669)" }}
              >
                {step.n}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#9ca3af]">{step.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
