import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { MobileNav } from "./_components/mobile-nav";

const NAV_LINKS = [
  { href: "/#funktionen", label: "Funktionen" },
  { href: "/#preise", label: "Preise" },
  { href: "/faq", label: "FAQ" },
  { href: "/datenschutz", label: "Datenschutz" },
];

const FOOTER_COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Produkt",
    links: [
      { href: "/#funktionen", label: "Funktionen" },
      { href: "/#preise", label: "Preise" },
      { href: "/#ablauf", label: "Ablauf" },
      { href: "/faq", label: "FAQ" },
      { href: "/login", label: "Anmelden" },
    ],
  },
  {
    title: "Rechtliches",
    links: [
      { href: "/datenschutz", label: "Datenschutz" },
      { href: "/impressum", label: "Impressum" },
    ],
  },
  {
    title: "Kontakt",
    links: [
      { href: "mailto:[E-Mail]", label: "[E-Mail]" },
      { href: "/faq", label: "Support & Hilfe" },
    ],
  },
];

export default function MarketingLayout({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-50 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="relative mx-auto flex h-[64px] max-w-[1200px] items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 text-ink" aria-label="Reidey Startseite">
            <Logo size={28} className="text-ink" />
            <span className="text-lg font-semibold tracking-tight">Reidey</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-full px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-ink transition-opacity hover:opacity-90 md:inline-flex"
            >
              Anmelden
            </Link>
            <MobileNav links={NAV_LINKS} />
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1200px] px-4 py-14">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-4">
            <div className="max-w-xs">
              <Link href="/" className="flex items-center gap-2 text-ink" aria-label="Reidey Startseite">
                <Logo size={26} className="text-ink" />
                <span className="text-base font-semibold tracking-tight">Reidey</span>
              </Link>
              <p className="mt-4 text-sm leading-relaxed text-ink-muted">
                Die Flottenmanagement-Plattform für moderne Fahrdienst-Flotten. Fahrer, Abläufe und Abrechnung an einem Ort.
              </p>
            </div>

            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <h3 className="text-sm font-semibold text-ink">{col.title}</h3>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.href + link.label}>
                      <Link
                        href={link.href}
                        className="text-sm text-ink-muted transition-colors hover:text-ink"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-sm text-ink-subtle sm:flex-row sm:items-center sm:justify-between">
            <p>&copy; {year} Reidey. Alle Rechte vorbehalten.</p>
            <p>DSGVO-konform. Daten in der EU verarbeitet.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
