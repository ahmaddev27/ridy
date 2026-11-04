import { Mail } from "lucide-react";

export function Cta() {
  return (
    <section id="kontakt" className="mx-auto mt-[clamp(58px,8vw,88px)] max-w-[1240px] px-[clamp(20px,5vw,40px)]">
      <div className="mkt-card grid grid-cols-[repeat(auto-fit,minmax(min(258px,100%),1fr))] items-center gap-[clamp(24px,3vw,44px)] !rounded-[20px] !p-[clamp(28px,4vw,52px)_clamp(22px,4vw,44px)]">
        <div className="flex flex-col gap-3">
          <h2 className="text-[clamp(25px,3.4vw,34px)] font-semibold leading-[1.18] tracking-[-0.02em]">
            Zeig uns deine Flotte, wir zeigen dir die Zahlen.
          </h2>
          <p className="max-w-[44em] text-[clamp(15px,1.5vw,16.5px)] leading-[1.6] text-ink-muted">
            15 Minuten am Telefon reichen, um zu sehen, welche Fahrten deine Fahrer aktuell unter Wert annehmen.
          </p>
        </div>
        <div className="flex min-w-[min(258px,100%)] flex-col gap-2.5">
          <a href="mailto:info@reidey.de" className="mkt-btn">
            Termin vereinbaren
          </a>
          <a
            href="mailto:info@reidey.de"
            className="inline-flex items-center justify-center gap-2 py-1.5 text-[14.5px] font-medium text-ink-muted transition-colors hover:text-primary"
          >
            <Mail size={15} aria-hidden />
            info@reidey.de
          </a>
        </div>
      </div>
    </section>
  );
}
