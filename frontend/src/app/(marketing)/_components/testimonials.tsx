import { Container, Eyebrow } from "./ui";

const QUOTES = [
  {
    label: "Aus dem Betrieb",
    quote:
      "Vorher haben meine Fahrer jede Fahrt genommen, die kam. Heute sehen sie den €/km-Wert, bevor sie zusagen, und die Abende sind deutlich ruhiger geworden.",
    name: "Murat R.",
    role: "Rheinfahrt GmbH, Solingen · 14 Fahrer",
    initials: "MR",
  },
  {
    label: "Aus dem Fahrzeug",
    quote: "Ich höre den Ton, schaue einmal hin und weiß, ob es sich lohnt. Kein Suchen, kein Rechnen im Kopf.",
    name: "Peter K.",
    role: "Fahrer in Wuppertal · seit 2024 dabei",
    initials: "PK",
  },
];

/** Always-dark quote block (prototype): two voices side by side. */
export function Testimonials() {
  return (
    <section className="mx-auto mt-[clamp(44px,7vw,64px)] max-w-[1240px] px-[clamp(20px,5vw,40px)]">
      <div className="mkt-band grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] items-start gap-[clamp(28px,4vw,48px)] rounded-[20px] p-[clamp(26px,4vw,48px)_clamp(22px,4vw,44px)]">
        {QUOTES.map((q) => (
          <figure key={q.name} className="m-0 flex flex-col gap-3.5">
            <Eyebrow band>{q.label}</Eyebrow>
            <blockquote className="m-0 text-[clamp(17.5px,2vw,22px)] font-medium leading-[1.5] tracking-[-0.01em]">
              „{q.quote}“
            </blockquote>
            <figcaption className="flex items-center gap-3 pt-1.5">
              <span
                aria-hidden
                className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[rgb(230_236_233/0.12)] text-[13px] font-semibold"
              >
                {q.initials}
              </span>
              <span className="flex flex-col leading-[1.35]">
                <span className="text-[14.5px] font-semibold">{q.name}</span>
                <span className="text-[13px] text-[rgb(230_236_233/0.62)]">{q.role}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
