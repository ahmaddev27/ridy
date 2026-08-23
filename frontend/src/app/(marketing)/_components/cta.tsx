import { ArrowRight, Mail } from "lucide-react";
import { Container } from "./ui";

export function Cta() {
  return (
    <section id="kontakt" className="py-14 lg:py-28">
      <Container>
        <div
          className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] border border-white/10 p-8 text-center sm:p-16 lg:p-20"
          style={{
            background:
              "radial-gradient(100% 100% at 50% 0%, rgba(16,185,129,0.22) 0%, rgba(10,10,10,0) 50%), #0a0b0f",
          }}
        >
          <div
            className="absolute left-1/2 top-0 h-px w-2/3 -translate-x-1/2"
            style={{
              background:
                "linear-gradient(90deg,transparent,rgba(52,211,153,0.4),transparent)",
            }}
          />
          <div
            className="bg-gradient-accent pointer-events-none absolute left-1/2 h-[360px] w-[700px] -translate-x-1/2 rounded-full"
            style={{ top: -128, opacity: 0.25, filter: "blur(130px)" }}
          />

          <div className="relative">
            <span className="glass mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />
              Demo anfragen
            </span>

            <h2 className="font-heading text-3xl font-bold leading-[1.04] tracking-[-0.03em] text-balance text-white sm:text-5xl lg:text-6xl">
              Zeig uns deine Flotte, <br className="hidden sm:block" />
              <span className="text-gradient">wir zeigen dir die Zahlen.</span>
            </h2>

            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              15 Minuten am Telefon reichen, um zu sehen, welche Fahrten deine Fahrer
              aktuell unter Wert annehmen.
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="mailto:vertrieb@reidey.de"
                className="bg-gradient-accent group inline-flex items-center gap-2 rounded-2xl px-7 py-4 font-semibold text-white transition-opacity hover:opacity-90"
              >
                Termin vereinbaren
                <ArrowRight
                  size={16}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </a>
              <a
                href="mailto:vertrieb@reidey.de"
                className="glass inline-flex items-center gap-2 rounded-2xl px-7 py-4 font-semibold text-white transition-colors hover:border-white/20"
              >
                <Mail size={16} className="text-primary" />
                vertrieb@reidey.de
              </a>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
