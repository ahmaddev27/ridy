import { Star, ShieldCheck, Lock, Server } from "lucide-react";
import { Container, SectionHeading } from "./ui";

const QUOTES = [
  {
    quote:
      "Vorher haben meine Fahrer jede Fahrt genommen, die kam. Heute sehen sie den €/km-Wert, bevor sie zusagen, und die Abende sind deutlich ruhiger geworden.",
    name: "Murat R.",
    role: "Rheinfahrt GmbH, Solingen · 14 Fahrer",
    initials: "MR",
  },
  {
    quote:
      "Ich höre den Ton, schaue einmal hin und weiß, ob es sich lohnt. Kein Suchen, kein Rechnen im Kopf.",
    name: "Peter K.",
    role: "Fahrer in Wuppertal · seit 2024 dabei",
    initials: "PK",
  },
];

const BADGES = [
  { icon: Star, title: "4.9 Bewertung", note: "Flotten in ganz Deutschland" },
  { icon: ShieldCheck, title: "DSGVO-konform", note: "Daten in der EU" },
  { icon: Lock, title: "Ende-zu-Ende", note: "Verschlüsselte Übertragung" },
  { icon: Server, title: "99,9% Verfügbarkeit", note: "Hosting Frankfurt" },
];

export function Testimonials() {
  return (
    <section className="py-14 lg:py-28">
      <Container>
        <SectionHeading
          eyebrow="Aus dem Betrieb"
          title="Stille Abende statt Streit um Löhne."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {QUOTES.map((q) => (
            <div key={q.name} className="card-modern rounded-3xl p-7">
              <div className="flex gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={16} fill="#f59e0b" className="text-[#f59e0b]" />
                ))}
              </div>
              <p className="mt-5 text-base leading-relaxed text-white/90">“{q.quote}”</p>
              <div className="mt-6 flex items-center gap-3">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ background: "linear-gradient(100deg,#10b981,#059669)" }}
                >
                  {q.initials}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{q.name}</p>
                  <p className="text-xs text-[#9ca3af]">{q.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {BADGES.map((b) => (
            <div key={b.title} className="card-modern flex items-center gap-4 rounded-3xl p-5">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
                style={{ background: "rgba(16,185,129,0.12)" }}
              >
                <b.icon size={20} className="text-[#10b981]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{b.title}</p>
                <p className="text-xs text-[#9ca3af]">{b.note}</p>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
