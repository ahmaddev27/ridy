import Link from "next/link";
import { Logo } from "@/components/brand/logo";
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
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <Link href="/#top" className="flex items-center gap-2.5 text-white">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "#0f1116", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <Logo size={28} className="text-white" />
              </span>
              <span className="font-heading font-bold tracking-tight">REIDEY</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Fahrtbewertung für Flotten. Jedes Angebot klar bewertet, bevor dein
              Fahrer zusagt.
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Navigation
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3">
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

          <div>
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

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center">
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
