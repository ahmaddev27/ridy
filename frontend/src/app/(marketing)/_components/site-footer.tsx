import Link from "next/link";
import { Container } from "./ui";

const NAV = [
  { href: "/#problem", label: "Problem" },
  { href: "/#funktionen", label: "Funktionen" },
  { href: "/#ablauf", label: "Ablauf" },
  { href: "/#app", label: "App" },
  { href: "/#faq", label: "FAQ" },
];

const LEGAL = [
  { href: "/impressum", label: "Impressum" },
  { href: "/datenschutz", label: "Datenschutz" },
  { href: "/faq", label: "Alle Fragen" },
];

const colLink = "text-[14px] text-ink-muted transition-colors hover:text-primary";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-[clamp(58px,8vw,88px)]">
      <Container className="pb-11 pt-[clamp(52px,7vw,72px)]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-[clamp(24px,3vw,40px)] border-b border-[var(--m-rule)] pb-[clamp(26px,4vw,36px)]">
          <div className="flex flex-col gap-3.5">
            <Link href="/#top" className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/reidey-logo.jpeg"
                alt="Reidey"
                className="h-[38px] w-[38px] object-contain mix-blend-multiply dark:mix-blend-screen dark:invert"
              />
              <span className="text-[17px] font-semibold">Reidey</span>
            </Link>
            <p className="max-w-[24em] text-[13.5px] leading-relaxed text-ink-subtle">
              Fahrtbewertung für Flotten. Jedes Angebot klar bewertet, bevor dein Fahrer zusagt.
            </p>
          </div>

          <div className="flex flex-col gap-2.5">
            <span className="mkt-eyebrow">Produkt</span>
            {NAV.map((l) => (
              <Link key={l.href} href={l.href} className={colLink}>
                {l.label}
              </Link>
            ))}
          </div>

          <div className="flex flex-col gap-2.5">
            <span className="mkt-eyebrow">Kontakt</span>
            <a href="mailto:info@reidey.de" className={colLink}>
              info@reidey.de
            </a>
            <p className="text-[14px] text-ink-muted">Server in der EU · DSGVO-konform</p>
          </div>

          <div className="flex flex-col gap-2.5">
            <span className="mkt-eyebrow">Rechtliches</span>
            {LEGAL.map((l) => (
              <Link key={l.href} href={l.href} className={colLink}>
                {l.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-[22px]">
          <span className="mkt-eyebrow normal-case tracking-normal">
            © {year} REIDEY · Alle Rechte vorbehalten
          </span>
          <span className="text-[12.5px] text-ink-subtle">Gebaut für Ride-Hailing-Flotten in Deutschland</span>
        </div>
      </Container>
    </footer>
  );
}
