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
    <footer className="border-t border-white/10 py-14">
      <Container>
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <Link href="/#top" className="flex items-center gap-2 text-white">
              <Logo size={26} className="text-[#10b981]" />
              <span className="text-base font-semibold tracking-tight">REIDEY</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-[#9ca3af]">
              Fahrtbewertung für Flotten. Jedes Angebot klar bewertet, bevor dein
              Fahrer zusagt.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-white">Navigation</p>
            <ul className="mt-4 flex flex-col gap-3">
              {NAV.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-sm text-[#9ca3af] transition-colors hover:text-white"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold text-white">Kontakt</p>
            <div className="mt-4 flex flex-col gap-3">
              <a
                href="mailto:vertrieb@reidey.de"
                className="text-sm text-[#9ca3af] transition-colors hover:text-white"
              >
                vertrieb@reidey.de
              </a>
              <p className="text-sm text-[#9ca3af]">
                Server in der EU · DSGVO-konform
              </p>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-[#9ca3af]">
            © {year} REIDEY · Alle Rechte vorbehalten
          </p>
          <p className="text-xs text-[#9ca3af]">
            Gebaut für Ride-Hailing-Flotten in Deutschland
          </p>
        </div>
      </Container>
    </footer>
  );
}
