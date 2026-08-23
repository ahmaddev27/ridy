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
        <div className="mb-10 mt-12 grid gap-4 md:grid-cols-2">
          {QUOTES.map((q) => (
            <div key={q.name} className="card-modern flex flex-col gap-5 rounded-3xl p-7">
              <div className="flex items-center gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={16} fill="#f59e0b" className="text-[#f59e0b]" />
                ))}
              </div>
              <blockquote className="font-heading text-lg font-medium leading-relaxed text-balance text-white">
                “{q.quote}”
              </blockquote>
              <div className="mt-auto flex items-center gap-3 border-t border-white/10 pt-4">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: "linear-gradient(100deg,#10b981,#059669)" }}
                >
                  {q.initials}
                </div>
                <div>
                  <p className="font-heading text-sm font-semibold text-white">
                    {q.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{q.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BADGES.map((b) => (
            <div key={b.title} className="card-modern flex items-center gap-3 rounded-3xl p-5">
              <div className="bg-gradient-accent-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <b.icon size={20} className="text-primary" />
              </div>
              <div>
                <p className="font-heading text-sm font-semibold text-white">
                  {b.title}
                </p>
                <p className="text-xs text-muted-foreground">{b.note}</p>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
