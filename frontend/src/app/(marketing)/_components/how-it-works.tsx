import { Bell, Clock, ExternalLink } from "lucide-react";
import { Container, SectionHead } from "./ui";

const STEPS = [
  {
    n: "01",
    icon: Bell,
    title: "Angebot trifft ein",
    body: "Reidey erkennt das Angebot und meldet es mit hoher Priorität — auf dem Sperrbildschirm, mit Ton, auch wenn die App geschlossen ist.",
  },
  {
    n: "02",
    icon: Clock,
    title: "In einem Blick bewerten",
    body: "Großer Fahrpreis, €/km, Distanz und Route. Ein ruhiger Countdown zeigt, wie viel Zeit bleibt: grün, amber, rot.",
  },
  {
    n: "03",
    icon: ExternalLink,
    title: "Fahrt bestätigen",
    body: "Die Annahme erfolgt in der Fahr-App des Fahrers. Reidey greift nie in den Auftrag ein — es zeigt das Angebot und protokolliert.",
  },
];

export function HowItWorks() {
  return (
    <section id="ablauf" className="mkt-section">
      <Container>
        <SectionHead title="Drei Schritte. Keine Einlernphase." meta="So funktioniert es" />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-[clamp(14px,2vw,20px)]">
          {STEPS.map((step) => (
            <article key={step.n} className="mkt-card flex flex-col gap-3.5">
              <span className="mkt-mono text-[12px] tracking-[0.06em] text-primary" style={{ fontFamily: "var(--font-mono)" }}>
                {step.n}
              </span>
              <step.icon size={26} strokeWidth={1.4} aria-hidden />
              <h3 className="text-[19px] font-semibold tracking-[-0.01em]">{step.title}</h3>
              <p className="mkt-body">{step.body}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
