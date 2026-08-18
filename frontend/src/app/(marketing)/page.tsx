import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export const metadata = {
  title: "Reidey · Dispatch für Fahrdienst-Flotten",
  description:
    "Reidey meldet jedes Fahrtangebot in dem Moment, in dem es eintrifft, mit Fahrpreis, €/km und Route auf einen Blick. Deine Fahrer entscheiden schneller, deine Flotte fährt profitabler.",
};

const mono = "var(--font-plex-mono), monospace";
const MAXW = 1240;
const PADX = "clamp(20px,5vw,40px)";
// Brand emerald accent — stable across both themes.
const accent = "#059669";

const monoEyebrow: CSSProperties = {
  font: `500 11px ${mono}`,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-subtle)",
};

const cardWhite: CSSProperties = {
  background: "var(--surface)",
  padding: "clamp(20px,3vw,26px) clamp(18px,3vw,24px)",
  display: "flex",
  flexDirection: "column",
};

const phoneImg: CSSProperties = { display: "block", aspectRatio: "780 / 1688" };

function SectionHead({
  title,
  eyebrow,
}: {
  title: string;
  eyebrow: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
        paddingBottom: "clamp(22px,3vw,30px)",
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: "clamp(25px,3.4vw,32px)",
          fontWeight: 600,
          letterSpacing: "-.02em",
        }}
      >
        {title}
      </h2>
      <span style={monoEyebrow}>{eyebrow}</span>
    </div>
  );
}

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          borderBottom: "1px solid var(--line)",
        }}
      >
        {/* Decorative dotted grid — purely visual, never interactive. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
          }}
        >
          <div
            className="hero-dots"
            style={{
              position: "absolute",
              top: -40,
              right: -30,
              width: "min(46vw,520px)",
              height: "min(46vw,520px)",
              WebkitMaskImage:
                "radial-gradient(closest-side, #000 28%, transparent 78%)",
              maskImage:
                "radial-gradient(closest-side, #000 28%, transparent 78%)",
            }}
          />
          <div
            className="hero-dots"
            style={{
              position: "absolute",
              bottom: -60,
              left: -40,
              width: "min(40vw,440px)",
              height: "min(40vw,440px)",
              WebkitMaskImage:
                "radial-gradient(closest-side, #000 24%, transparent 76%)",
              maskImage:
                "radial-gradient(closest-side, #000 24%, transparent 76%)",
            }}
          />
        </div>

        <div
          id="top"
          style={{
            position: "relative",
            zIndex: 1,
            maxWidth: MAXW,
            margin: "0 auto",
            padding:
              "clamp(40px,6vw,72px) " + PADX + " clamp(48px,7vw,88px)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
            gap: "clamp(32px,5vw,60px)",
            alignItems: "center",
          }}
        >
          {/* Left column */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "clamp(18px,2.6vw,24px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Logo size={34} className="text-ink" />
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: "-.01em",
                }}
              >
                Reidey
              </span>
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(34px,5.2vw,58px)",
                lineHeight: 1.05,
                fontWeight: 600,
                letterSpacing: "-.03em",
              }}
            >
              <span style={{ color: accent }}>Jedes Fahrtangebot</span> klar
              bewertet, bevor dein Fahrer zusagt.
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: "clamp(16px,1.6vw,19px)",
                lineHeight: 1.55,
                color: "var(--ink-muted)",
                maxWidth: "32em",
              }}
            >
              Reidey zeigt Fahrpreis, €/km und Route auf einen Blick. Deine
              Fahrer entscheiden schneller, deine Flotte fährt profitabler.
            </p>

            <div
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <span style={monoEyebrow}>Verfügbar auf:</span>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <StoreBadge kicker="Laden im" name="App Store" href="/#app">
                  <path d="M16.4 12.7c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.3-.1-2.6.8-3.3.8-.7 0-1.7-.8-2.9-.8-1.5 0-2.9.9-3.6 2.3-1.6 2.7-.4 6.7 1.1 8.9.7 1.1 1.6 2.3 2.8 2.2 1.1 0 1.6-.7 3-.7 1.4 0 1.8.7 3 .7 1.2 0 2-1.1 2.7-2.2.5-.8.8-1.5 1-2.3-1.6-.6-2.5-2.1-2.5-3.8Z" />
                  <path d="M14.3 5.6c.6-.7 1-1.7.9-2.7-.9.1-1.9.6-2.5 1.3-.6.6-1 1.6-.9 2.6 1 .1 2-.5 2.5-1.2Z" />
                </StoreBadge>
                <StoreBadge
                  kicker="Jetzt bei"
                  name="Google Play"
                  href="/#app"
                >
                  <path d="M4.3 2.8 15.6 12 4.3 21.2c-.3-.2-.5-.6-.5-1.1V3.9c0-.5.2-.9.5-1.1Z" />
                  <path d="M15.6 12 4.3 21.2l7.6-6.2 3.7-3Z" />
                  <path d="m15.6 12 3.9-2.4c.9-.6.9-1.6 0-2.2L15.6 5" />
                  <path d="m15.6 12 3.9 2.4c.9.6.9 1.6 0 2.2L15.6 19" />
                </StoreBadge>
              </div>
            </div>

            {/* Rating */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                paddingTop: 2,
              }}
            >
              <Stars />
              <span style={{ fontSize: 14.5, color: "var(--ink-muted)" }}>
                <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                  4.9
                </strong>{" "}
                · Von Flotten in ganz Deutschland genutzt
              </span>
            </div>
          </div>

          {/* Right column: two overlapping, angled phones */}
          <div
            style={{
              position: "relative",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              minHeight: "clamp(360px,44vw,540px)",
            }}
          >
            <PhoneMock
              src="/app-screens/1a-offer-detail.png"
              alt="Reidey Angebotsdetail"
              style={{
                position: "absolute",
                width: "min(216px,44vw)",
                transform: "translate(-30%,-3%) rotate(-8deg)",
                zIndex: 1,
              }}
            />
            <PhoneMock
              src="/app-screens/1a-home.png"
              alt="Reidey Startbildschirm"
              style={{
                position: "relative",
                width: "min(240px,48vw)",
                transform: "translate(13%,0) rotate(4deg)",
                zIndex: 2,
              }}
            />
          </div>
        </div>
      </section>

      {/* Das Problem */}
      <div
        id="problem"
        style={{
          scrollMarginTop: 80,
          maxWidth: MAXW,
          margin: "0 auto",
          padding: "clamp(58px,9vw,100px) " + PADX + " 20px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
            gap: "clamp(28px,4vw,56px)",
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <span style={monoEyebrow}>Das Problem</span>
            <h2
              style={{
                margin: 0,
                fontSize: "clamp(27px,3.9vw,38px)",
                lineHeight: 1.14,
                fontWeight: 600,
                letterSpacing: "-.02em",
              }}
            >
              Das Zeitfenster für ein Angebot beträgt oft nur rund fünf Sekunden.
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: 17,
                lineHeight: 1.6,
                color: "var(--ink-muted)",
              }}
            >
              In dieser Zeit müssen sie Fahrpreis, Distanz und Anfahrt
              gegeneinander abwägen, meist im Verkehr, oft ohne den Bildschirm
              richtig zu sehen. Wer zu langsam ist, verliert die Fahrt. Wer zu
              schnell zusagt, fährt sie unter Kosten.
            </p>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              background: "var(--line)",
              border: "1px solid var(--line)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Stat value="~5s" label="Zeitfenster pro Angebot" />
              <Stat
                value="€1.26"
                label="Durchschnitt pro km, an dem sich jede Fahrt messen lässt"
              />
            </div>
            <div style={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Stat
                value="84%"
                label="Annahmequote, ohne die schwachen Fahrten mitzunehmen"
              />
              <Stat
                value="0"
                label="Angebote, die unbemerkt ablaufen, auch bei geschlossener App"
              />
            </div>
          </div>
        </div>
      </div>

      {/* So läuft eine Fahrt */}
      <div
        id="ablauf"
        style={{
          scrollMarginTop: 80,
          maxWidth: MAXW,
          margin: "0 auto",
          padding: "clamp(56px,8vw,80px) " + PADX + " 0",
        }}
      >
        <SectionHead title="So läuft eine Fahrt" eyebrow="Drei Schritte" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))",
            gap: "clamp(14px,2vw,20px)",
          }}
        >
          <Step
            num="01"
            title="Angebot trifft ein"
            body="Reidey erkennt das Angebot und meldet es mit hoher Priorität, auf dem Sperrbildschirm, mit Ton, auch wenn die App geschlossen ist."
          >
            <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
            <path d="M10.5 19a2 2 0 0 0 3 0" />
          </Step>
          <Step
            num="02"
            title="In einem Blick bewerten"
            body="Großer Fahrpreis, €/km, Distanz und Route. Ein ruhiger Countdown zeigt, wie viel Zeit bleibt: grün, amber, rot."
          >
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </Step>
          <Step
            num="03"
            title="Fahrt bestätigen"
            body="Die Annahme erfolgt in der Fahr-App des Fahrers. Reidey greift nie in den Auftrag ein, es zeigt das Angebot und protokolliert."
          >
            <path d="M14 4h6v6" />
            <path d="M20 4 11 13" />
            <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
          </Step>
        </div>
      </div>

      {/* Was die Flotte davon hat */}
      <div
        id="funktionen"
        style={{
          scrollMarginTop: 80,
          maxWidth: MAXW,
          margin: "0 auto",
          padding: "clamp(58px,8vw,88px) " + PADX + " 0",
        }}
      >
        <SectionHead title="Was die Flotte davon hat" eyebrow="Funktionen" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(258px,1fr))",
            gap: 1,
            background: "var(--line)",
            border: "1px solid var(--line)",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <Feature
            title="Qualitätsbewertung"
            body="Jedes Angebot wird als €, €€ oder €€€ eingeordnet, gemessen am €/km-Schnitt deiner Region."
          >
            <path d="M4 18V9" />
            <path d="M10 18V5" />
            <path d="M16 18v-6" />
            <path d="M3 21h18" />
          </Feature>
          <Feature
            title="Vollständiges Protokoll"
            body="Jedes Angebot mit Status, Fahrpreis und Route, durchsuchbar, filterbar, exportierbar."
          >
            <rect x="4" y="4" width="16" height="16" rx="3" />
            <path d="M8 10h8M8 14h5" />
          </Feature>
          <Feature
            title="Deutsch, Englisch, Arabisch"
            body="Vollständig gespiegelte Oberfläche für arabische Fahrer. Beträge und Distanzen bleiben in lateinischen Zahlen."
          >
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 3.5v17M3.5 12h17" />
            <path d="M12 3.5c2.5 2.3 3.8 5.3 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.3-3.8-8.5S9.5 5.8 12 3.5Z" />
          </Feature>
          <Feature
            title="Flottenkonten"
            body="Fahrer werden per Einladung freigeschaltet. Läuft das Abo aus, endet der Zugang automatisch."
          >
            <path d="M12 3.5 20 7v6c0 4-3.4 6.9-8 7.5-4.6-.6-8-3.5-8-7.5V7l8-3.5Z" />
            <path d="m9 12 2 2 4-4" />
          </Feature>
          <Feature
            title="Tageskennzahlen"
            body="Angebote, Annahmequote, Verdienst und Strecke, pro Tag, pro Woche, pro Monat."
          >
            <path d="M12 4v4M12 16v4M4 12h4M16 12h4" />
            <circle cx="12" cy="12" r="4" />
          </Feature>
          <Feature
            title="Echte Adressen"
            body="Abholung und Ziel im Klartext statt als Kartenausschnitt, lesbar auf einen Blick, auch in Bewegung."
          >
            <path d="M12 21s7-4.3 7-10a7 7 0 1 0-14 0c0 5.7 7 10 7 10Z" />
            <circle cx="12" cy="11" r="2.5" />
          </Feature>
        </div>
      </div>

      {/* Die App */}
      <div
        id="app"
        style={{
          scrollMarginTop: 80,
          maxWidth: MAXW,
          margin: "0 auto",
          padding: "clamp(58px,8vw,88px) " + PADX + " 0",
        }}
      >
        <SectionHead title="Die App" eyebrow="Hell & dunkel · DE / AR" />
        <div
          style={{
            display: "flex",
            gap: "clamp(12px,2vw,20px)",
            overflowX: "auto",
            scrollSnapType: "x mandatory",
            paddingBottom: 8,
            WebkitOverflowScrolling: "touch",
          }}
        >
          <AppShot src="/app-screens/1a-home.png" caption="Start" />
          <AppShot src="/app-screens/1a-offer-detail.png" caption="Angebot" />
          <AppShot
            src="/app-screens/1b-offers-list-dark.png"
            caption="Liste · dunkel"
          />
          <AppShot
            src="/app-screens/1a-profile-stats.png"
            caption="Statistik"
          />
          <AppShot
            src="/app-screens/1e-home-rtl.png"
            caption="Start · العربية"
          />
        </div>
      </div>

      {/* Testimonials */}
      <div
        style={{
          maxWidth: MAXW,
          margin: "clamp(44px,7vw,64px) auto 0",
          padding: "0 " + PADX,
        }}
      >
        <div
          style={{
            background: "#12151a",
            color: "#e6e8ec",
            borderRadius: 20,
            padding: "clamp(26px,4vw,48px) clamp(22px,4vw,44px)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
            gap: "clamp(28px,4vw,48px)",
            alignItems: "start",
          }}
        >
          <Testimonial
            eyebrow="Aus dem Betrieb"
            quote="„Vorher haben meine Fahrer jede Fahrt genommen, die kam. Heute sehen sie den €/km-Wert, bevor sie zusagen, und die Abende sind deutlich ruhiger geworden.”"
            initials="MR"
            name="Murat R."
            meta="Rheinfahrt GmbH, Solingen · 14 Fahrer"
          />
          <Testimonial
            eyebrow="Aus dem Fahrzeug"
            quote="„Ich höre den Ton, schaue einmal hin und weiß, ob es sich lohnt. Kein Suchen, kein Rechnen im Kopf.”"
            initials="PK"
            name="Peter K."
            meta="Fahrer in Wuppertal · seit 2024 dabei"
          />
        </div>
      </div>

      {/* Häufige Fragen */}
      <div
        id="faq"
        style={{
          scrollMarginTop: 80,
          maxWidth: MAXW,
          margin: "0 auto",
          padding: "clamp(58px,8vw,88px) " + PADX + " 0",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
            gap: "clamp(24px,4vw,56px)",
            alignItems: "start",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "clamp(25px,3.4vw,32px)",
              fontWeight: 600,
              letterSpacing: "-.02em",
            }}
          >
            Häufige Fragen
          </h2>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              background: "var(--line)",
              border: "1px solid var(--line)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            <Faq
              q="Nimmt Reidey Fahrten automatisch an?"
              a="Nein. Die Annahme erfolgt ausschließlich in der Fahr-App des Fahrers. Reidey macht das Angebot sichtbar und bewertet es, entschieden wird vom Fahrer."
            />
            <Faq
              q="Funktioniert es bei geschlossener App?"
              a="Ja. Reidey meldet sich per Push mit hoher Priorität auf dem Sperrbildschirm, mit Ton auch im Stumm-Modus."
            />
            <Faq
              q="Welche Daten werden gespeichert?"
              a="Fahrpreis, Distanz, Adressen und Status je Angebot, auf Servern in der EU, DSGVO-konform. Keine Weitergabe an Dritte."
            />
            <Faq
              q="Wie kommen meine Fahrer an den Zugang?"
              a="Du lädst sie im Flottenkonto per E-Mail ein. Sie laden die App, melden sich an und sind sofort aktiv."
            />
            <Faq
              q="Welche Sprachen unterstützt die App?"
              a="Deutsch, Englisch und Arabisch mit vollständig gespiegelter Oberfläche. Beträge, Distanzen und Zeiten bleiben immer in lateinischen Zahlen."
            />
          </div>
        </div>
      </div>

      {/* Kontakt */}
      <div
        id="kontakt"
        style={{
          scrollMarginTop: 80,
          maxWidth: MAXW,
          margin: "clamp(58px,8vw,88px) auto 0",
          padding: "0 " + PADX,
        }}
      >
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 20,
            background: "var(--surface)",
            padding: "clamp(28px,4vw,52px) clamp(22px,4vw,44px)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(258px,1fr))",
            gap: "clamp(24px,3vw,44px)",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2
              style={{
                margin: 0,
                fontSize: "clamp(25px,3.4vw,34px)",
                fontWeight: 600,
                letterSpacing: "-.02em",
                lineHeight: 1.18,
              }}
            >
              Zeig uns deine Flotte, wir zeigen dir die Zahlen.
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: "clamp(15px,1.5vw,16.5px)",
                lineHeight: 1.6,
                color: "var(--ink-muted)",
                maxWidth: "44em",
              }}
            >
              15 Minuten am Telefon reichen, um zu sehen, welche Fahrten deine
              Fahrer aktuell unter Wert annehmen.
            </p>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              minWidth: "min(258px,100%)",
            }}
          >
            <a
              href="mailto:vertrieb@reidey.de"
              className="hover:bg-[#059669]!"
              style={{
                textAlign: "center",
                fontSize: 15.5,
                fontWeight: 600,
                background: "var(--primary)",
                color: "var(--primary-ink)",
                borderRadius: 13,
                padding: "16px 26px",
              }}
            >
              Termin vereinbaren
            </a>
            <a
              href="mailto:vertrieb@reidey.de"
              className="hover:text-[#059669]!"
              style={{
                textAlign: "center",
                fontSize: 14.5,
                fontWeight: 500,
                color: "var(--ink-muted)",
                padding: "6px 0",
              }}
            >
              vertrieb@reidey.de
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- pieces ---------- */

function Icon({ children, size = 26 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--ink)"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function StoreBadge({
  kicker,
  name,
  href,
  children,
}: {
  kicker: string;
  name: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="hover:border-[var(--line-strong)]!"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        border: "1px solid var(--line)",
        background: "var(--surface)",
        borderRadius: 12,
        padding: "10px 16px",
        color: "var(--ink)",
      }}
    >
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
      <span
        style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}
      >
        <span
          style={{
            fontSize: 9.5,
            color: "var(--ink-subtle)",
            letterSpacing: ".04em",
            textTransform: "uppercase",
          }}
        >
          {kicker}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
      </span>
    </Link>
  );
}

/** Five brand-amber rating stars. Decorative — the text carries the meaning. */
function Stars() {
  return (
    <div style={{ display: "flex", gap: 3 }} aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} width="18" height="18" viewBox="0 0 24 24" fill="#f59e0b">
          <path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 21l-5.8 3 1.1-6.5L2.6 9.4l6.5-.9L12 2.6Z" />
        </svg>
      ))}
    </div>
  );
}

/** Screenshot inside a realistic dark phone bezel with a theme-aware shadow. */
function PhoneMock({
  src,
  alt,
  style,
}: {
  src: string;
  alt: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className="phone-shadow"
      style={{
        background: "#0b0d10",
        borderRadius: 34,
        padding: 7,
        border: "1px solid rgba(255,255,255,.07)",
        ...style,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={780}
        height={1688}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          aspectRatio: "780 / 1688",
          borderRadius: 27,
        }}
      />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        flex: "1 1 190px",
        background: "var(--surface)",
        padding: "clamp(18px,3vw,24px) clamp(16px,3vw,22px)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: "clamp(29px,4vw,38px)",
          fontWeight: 600,
          letterSpacing: "-.03em",
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 13.5, color: "var(--ink-muted)", lineHeight: 1.45 }}>
        {label}
      </span>
    </div>
  );
}

function Step({
  num,
  title,
  body,
  children,
}: {
  num: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 16,
        background: "var(--surface)",
        padding: "clamp(20px,3vw,26px) clamp(18px,3vw,24px)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <span
        style={{ font: `500 12px ${mono}`, color: "#059669", letterSpacing: ".06em" }}
      >
        {num}
      </span>
      <Icon>{children}</Icon>
      <span style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-.01em" }}>
        {title}
      </span>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-muted)" }}>
        {body}
      </p>
    </div>
  );
}

function Feature({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div style={{ ...cardWhite, gap: 11 }}>
      <Icon size={24}>{children}</Icon>
      <span style={{ fontSize: 17, fontWeight: 600 }}>{title}</span>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--ink-muted)" }}>
        {body}
      </p>
    </div>
  );
}

function AppShot({ src, caption }: { src: string; caption: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        flex: "none",
        scrollSnapAlign: "start",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={caption}
        width={780}
        height={1688}
        style={{
          ...phoneImg,
          width: "clamp(172px,44vw,224px)",
          height: "auto",
          borderRadius: "clamp(20px,4vw,26px)",
        }}
      />
      <span style={{ font: `400 11.5px ${mono}`, color: "var(--ink-subtle)" }}>
        {caption}
      </span>
    </div>
  );
}

function Testimonial({
  eyebrow,
  quote,
  initials,
  name,
  meta,
}: {
  eyebrow: string;
  quote: string;
  initials: string;
  name: string;
  meta: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span
        style={{
          font: `500 11px ${mono}`,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "rgba(230,232,236,.5)",
        }}
      >
        {eyebrow}
      </span>
      <p
        style={{
          margin: 0,
          fontSize: "clamp(17.5px,2vw,22px)",
          lineHeight: 1.5,
          fontWeight: 500,
          letterSpacing: "-.01em",
        }}
      >
        {quote}
      </p>
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 6 }}
      >
        <span
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: "rgba(230,232,236,.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {initials}
        </span>
        <span
          style={{ display: "flex", flexDirection: "column", lineHeight: 1.35 }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
          <span style={{ fontSize: 13, color: "rgba(230,232,236,.6)" }}>
            {meta}
          </span>
        </span>
      </div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        padding: "clamp(18px,3vw,22px) clamp(18px,3vw,24px)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span style={{ fontSize: 16, fontWeight: 600 }}>{q}</span>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-muted)" }}>
        {a}
      </p>
    </div>
  );
}
