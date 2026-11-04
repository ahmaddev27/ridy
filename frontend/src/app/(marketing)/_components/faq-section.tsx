import Link from "next/link";
import { Container } from "./ui";

const FAQS = [
  {
    q: "Nimmt Reidey Fahrten automatisch an?",
    a: "Nein. Die Annahme erfolgt ausschließlich in der Fahr-App des Fahrers. Reidey macht das Angebot sichtbar und bewertet es, entschieden wird vom Fahrer.",
  },
  {
    q: "Funktioniert es bei geschlossener App?",
    a: "Ja. Reidey meldet sich per Push mit hoher Priorität auf dem Sperrbildschirm, mit Ton auch im Stumm-Modus.",
  },
  {
    q: "Welche Daten werden gespeichert?",
    a: "Fahrpreis, Distanz, Adressen und Status je Angebot, auf Servern in der EU, DSGVO-konform. Keine Weitergabe an Dritte.",
  },
  {
    q: "Wie kommen meine Fahrer an den Zugang?",
    a: "Du lädst sie im Flottenkonto per E-Mail ein. Sie laden die App, melden sich an und sind sofort aktiv.",
  },
  {
    q: "Welche Sprachen unterstützt die App?",
    a: "Deutsch, Englisch und Arabisch mit vollständig gespiegelter Oberfläche. Beträge, Distanzen und Zeiten bleiben immer in lateinischen Zahlen.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" className="mkt-section">
      <Container>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] items-start gap-[clamp(24px,4vw,56px)]">
          <div className="flex flex-col gap-4">
            <h2 className="mkt-h3">Häufige Fragen</h2>
            <Link href="/faq" className="text-[14.5px] font-medium text-primary hover:underline">
              Alle Fragen ansehen →
            </Link>
          </div>
          <div className="mkt-rule-grid">
            {FAQS.map((item) => (
              <div key={item.q} className="mkt-cell flex flex-col gap-2 !py-[clamp(18px,3vw,22px)]">
                <h3 className="text-[16px] font-semibold">{item.q}</h3>
                <p className="text-[14px] leading-[1.6] text-ink-muted">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
