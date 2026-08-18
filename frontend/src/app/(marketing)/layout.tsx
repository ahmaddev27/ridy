import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

const mono = "var(--font-plex-mono), monospace";

// The shell follows the active theme via semantic tokens (canvas/surface/ink…),
// exactly like the dashboard. No light pinning here — the whole marketing area
// switches with the app's light/dark preference.
const shell: CSSProperties = {
  background: "var(--canvas)",
  color: "var(--ink)",
  fontFamily: "var(--font-instrument), system-ui, sans-serif",
  fontVariantNumeric: "tabular-nums",
  overflowX: "hidden",
};

const HEADER_NAV = [
  { href: "/#problem", label: "Warum Reidey" },
  { href: "/#ablauf", label: "Ablauf" },
  { href: "/#funktionen", label: "Funktionen" },
  { href: "/#faq", label: "FAQ" },
];

const FOOTER_PRODUCT = [
  { href: "/#funktionen", label: "Funktionen" },
  { href: "/#app", label: "App laden" },
  { href: "/login", label: "Anmelden" },
];
const FOOTER_COMPANY = [
  { href: "/#kontakt", label: "Kontakt" },
  { href: "/faq", label: "FAQ" },
  { href: "mailto:support@reidey.de", label: "Support" },
];
const FOOTER_LEGAL = [
  { href: "/impressum", label: "Impressum" },
  { href: "/datenschutz", label: "Datenschutz" },
  { href: "/#agb", label: "AGB" },
  { href: "/#cookies", label: "Cookie-Einstellungen" },
];

function MonoLabel({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        font: `500 11px ${mono}`,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        color: "var(--ink-subtle)",
      }}
    >
      {children}
    </span>
  );
}

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${instrumentSans.variable} ${ibmPlexMono.variable}`}
      style={shell}
    >
      {/* Header — theme-aware, sticky, subtle bottom line */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "color-mix(in srgb, var(--canvas) 88%, transparent)",
          backdropFilter: "saturate(140%) blur(10px)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div
          style={{
            maxWidth: 1240,
            margin: "0 auto",
            padding: "14px clamp(20px,5vw,40px)",
            display: "flex",
            alignItems: "center",
            gap: "clamp(14px,2.5vw,38px)",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "var(--ink)",
            }}
          >
            <Logo size={38} className="text-ink" />
            <span
              style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-.01em" }}
            >
              Reidey
            </span>
          </Link>
          <nav
            style={{
              flex: "1 1 260px",
              display: "flex",
              gap: "clamp(14px,2vw,24px)",
              alignItems: "center",
              minWidth: 0,
              whiteSpace: "nowrap",
              overflowX: "auto",
            }}
          >
            {HEADER_NAV.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hover:text-ink!"
                style={{ fontSize: 14, color: "var(--ink-muted)" }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flex: "none",
              whiteSpace: "nowrap",
            }}
          >
            <ThemeToggle />
            <Link
              href="/login"
              className="hover:text-ink!"
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "var(--ink-muted)",
                padding: "10px 4px",
              }}
            >
              Anmelden
            </Link>
            <Link
              href="/#kontakt"
              className="hover:opacity-90!"
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--primary-ink)",
                background: "var(--primary)",
                borderRadius: 12,
                padding: "11px 18px",
              }}
            >
              Vertrieb kontaktieren
            </Link>
          </div>
        </div>
      </header>

      <main>{children}</main>

      {/* Footer */}
      <footer
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "clamp(52px,7vw,72px) clamp(20px,5vw,40px) 44px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(168px,1fr))",
            gap: "clamp(24px,3vw,40px)",
            paddingBottom: "clamp(26px,4vw,36px)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Logo size={36} className="text-ink" />
              <span style={{ fontSize: 17, fontWeight: 600 }}>Reidey</span>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                lineHeight: 1.6,
                color: "var(--ink-subtle)",
                maxWidth: "24em",
              }}
            >
              Flottenmanagement für professionelle Fahrdienst-Flotten. Gebaut in
              Nordrhein-Westfalen.
            </p>
          </div>

          <FooterColumn title="Produkt" links={FOOTER_PRODUCT} />
          <FooterColumn title="Unternehmen" links={FOOTER_COMPANY} />
          <FooterColumn title="Rechtliches" links={FOOTER_LEGAL} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            paddingTop: 22,
          }}
        >
          <span style={{ font: `400 12px ${mono}`, color: "var(--ink-subtle)" }}>
            © 2026 Reidey GmbH · Solingen
          </span>
          <span style={{ fontSize: 12.5, color: "var(--ink-subtle)" }}>
            Reidey ist ein eigenständiges Flottenmanagement-Produkt.
          </span>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <MonoLabel>{title}</MonoLabel>
      {links.map((link) => (
        <Link
          key={link.href + link.label}
          href={link.href}
          className="hover:text-[#059669]!"
          style={{ fontSize: 14, color: "var(--ink-muted)" }}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
