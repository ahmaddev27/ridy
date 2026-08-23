import Link from "next/link";
import { Container } from "./ui";

const NAV = [
  { href: "/#problem", label: "Problem" },
  { href: "/#funktionen", label: "Funktionen" },
  { href: "/#ablauf", label: "Ablauf" },
  { href: "/#app", label: "App" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative py-12 lg:py-14">
      <Container>
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 lg:gap-10">
          <div className="text-center sm:text-left">
            <Link href="/#top" className="flex items-center justify-center gap-2.5 text-white sm:justify-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/reidey-logo.jpeg"
                alt="Reidey"
                className="h-10 w-10 rounded-xl object-contain mix-blend-screen invert"
              />
              <span className="font-heading font-bold tracking-tight">REIDEY</span>
            </Link>
            <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground sm:mx-0">
              Fahrtbewertung für Flotten. Jedes Angebot klar bewertet, bevor dein
              Fahrer zusagt.
            </p>
          </div>

          <div className="text-center sm:text-left">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Navigation
            </p>
            <ul className="mx-auto mt-4 grid max-w-[16rem] grid-cols-2 gap-x-6 gap-y-2.5 justify-items-center sm:mx-0 sm:justify-items-start">
              {NAV.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-white"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="text-center sm:text-left">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Kontakt
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <a
                href="mailto:info@reidey.de"
                className="text-sm text-white transition-colors hover:text-primary"
              >
                info@reidey.de
              </a>
              <p className="text-sm text-muted-foreground">
                Server in der EU · DSGVO-konform
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            © {year} REIDEY · Alle Rechte vorbehalten
          </p>
          <p className="text-xs text-muted-foreground">
            Gebaut für Ride-Hailing-Flotten in Deutschland
          </p>
        </div>
      </Container>
    </footer>
  );
}
