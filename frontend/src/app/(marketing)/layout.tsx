import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import { Logo } from "@/components/brand/logo";

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

// The design commits to ONE light look. We pin the semantic tokens to their
// light values on the wrapper so the shared legal/FAQ pages (which use
// bg-canvas / text-ink etc.) stay readable even when the app is in dark mode.
const lightShell: CSSProperties = {
  ["--canvas" as string]: "#f6f6f4",
  ["--surface" as string]: "#ffffff",
  ["--surface-2" as string]: "#f1f1ef",
  ["--ink" as string]: "#1e222b",
  ["--ink-muted" as string]: "#5a616e",
  ["--ink-subtle" as string]: "#8b909b",
  ["--line" as string]: "#e4e4e1",
  ["--line-strong" as string]: "#d6d3cd",
  ["--primary" as string]: "#1e222b",
  ["--primary-ink" as string]: "#ffffff",
  colorScheme: "light",
  background: "#f6f6f4",
  color: "#1e222b",
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

function MonoLabel({
  children,
  color = "#8b909b",
}: {
  children: ReactNode;
  color?: string;
}) {
  return (
    <span
      style={{
        font: `500 11px ${mono}`,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        color,
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
      style={lightShell}
    >
      {/* Dark top header */}
      <header style={{ background: "#12151a", color: "#e6e8ec" }}>
        <div
          style={{
            maxWidth: 1240,
            margin: "0 auto",
            padding: "18px clamp(20px,5vw,40px)",
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
              color: "#e6e8ec",
            }}
          >
            <Logo size={40} className="text-[#e6e8ec]" />
            <span
              style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-.01em" }}
            >
              Reidey Driver
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
                className="hover:text-[#e6e8ec]!"
                style={{ fontSize: 14, color: "rgba(230,232,236,.7)" }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flex: "none",
              whiteSpace: "nowrap",
            }}
          >
            <Link
              href="/login"
              className="hover:text-[#e6e8ec]!"
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "rgba(230,232,236,.8)",
                padding: "10px 4px",
              }}
            >
              Anmelden
            </Link>
            <Link
              href="/#kontakt"
              className="hover:bg-white!"
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#12151a",
                background: "#e6e8ec",
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
            borderBottom: "1px solid #e4e4e1",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Logo size={38} className="text-[#1e222b]" />
              <span style={{ fontSize: 17, fontWeight: 600 }}>Reidey Driver</span>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                lineHeight: 1.6,
                color: "#8b909b",
                maxWidth: "24em",
              }}
            >
              Dispatch-Assistent für professionelle Fahrdienst-Flotten. Gebaut in
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
          <span style={{ font: `400 12px ${mono}`, color: "#8b909b" }}>
            © 2026 Reidey GmbH · Solingen
          </span>
          <span style={{ fontSize: 12.5, color: "#8b909b" }}>
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
          style={{ fontSize: 14, color: "#5a616e" }}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
