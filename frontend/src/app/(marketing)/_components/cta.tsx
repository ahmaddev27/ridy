import { ArrowRight, Mail } from "lucide-react";
import { Container } from "./ui";

export function Cta() {
  return (
    <section id="kontakt" className="py-14 lg:py-28">
      <Container>
        <div
          className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] px-6 py-16 text-center lg:px-16 lg:py-24"
          style={{
            background:
              "radial-gradient(100% 100% at 50% 0%, rgba(16,185,129,0.22) 0%, rgba(10,10,10,0) 50%), #0a0b0f",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div
            className="absolute inset-x-0 top-0 h-px"
            style={{ background: "linear-gradient(90deg,transparent,#10b981,transparent)" }}
          />
          <div
            className="mkt-glow"
            style={{ top: -60, left: "50%", width: 400, height: 300, transform: "translateX(-50%)" }}
          />

          <div className="relative">
            <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-white/85">
              <span className="h-2 w-2 rounded-full bg-[#10b981]" />
              Demo anfragen
            </span>

            <h2 className="font-heading mx-auto mt-6 max-w-2xl text-3xl font-bold leading-tight text-white sm:text-4xl">
              Zeig uns deine Flotte,
              <br />
              <span
                style={{
                  background: "linear-gradient(100deg,#34d399,#059669)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                wir zeigen dir die Zahlen.
              </span>
            </h2>

            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[#9ca3af]">
              15 Minuten am Telefon reichen, um zu sehen, welche Fahrten deine Fahrer
              aktuell unter Wert annehmen.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="mailto:vertrieb@reidey.de"
                className="inline-flex items-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-semibold text-white"
                style={{ background: "linear-gradient(100deg,#10b981,#059669)" }}
              >
                Termin vereinbaren
                <ArrowRight size={16} />
              </a>
              <a
                href="mailto:vertrieb@reidey.de"
                className="glass inline-flex items-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-semibold text-white"
              >
                <Mail size={16} />
                vertrieb@reidey.de
              </a>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
