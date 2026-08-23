"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { Container, Eyebrow } from "./ui";

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
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="py-14 lg:py-28">
      <Container>
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <Eyebrow>Häufige Fragen</Eyebrow>
            <h2 className="font-heading mt-3 text-3xl font-bold text-white sm:text-4xl">
              Alles, was du wissen musst.
            </h2>
          </div>

          <div className="mt-12 flex flex-col gap-3">
            {FAQS.map((item, i) => {
              const isOpen = i === open;
              return (
                <div key={item.q} className="card-modern rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? -1 : i)}
                    className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                  >
                    <span className="text-base font-semibold text-white">{item.q}</span>
                    {isOpen ? (
                      <Minus size={20} className="shrink-0 text-[#10b981]" />
                    ) : (
                      <Plus size={20} className="shrink-0 text-[#10b981]" />
                    )}
                  </button>
                  <div className={`mkt-acc-body ${isOpen ? "open" : ""}`}>
                    <div>
                      <p className="px-6 pb-5 text-sm leading-relaxed text-[#9ca3af]">
                        {item.a}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Container>
    </section>
  );
}
