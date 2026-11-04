import { Gauge, ScrollText, Bell, MapPin, BarChart3, Users, Languages, Moon } from "lucide-react";
import { Container, SectionHead } from "./ui";

const FEATURES = [
  {
    icon: Gauge,
    title: "Qualitätsbewertung",
    body: "Jedes Angebot als €, €€ oder €€€ eingeordnet, gemessen am €/km-Schnitt deiner Region.",
  },
  {
    icon: ScrollText,
    title: "Vollständiges Protokoll",
    body: "Jedes Angebot mit Status, Fahrpreis und Route — durchsuchbar, filterbar, exportierbar.",
  },
  {
    icon: Bell,
    title: "Push mit hoher Priorität",
    body: "Angebote melden sich auf dem Sperrbildschirm, mit Ton — auch bei geschlossener App.",
  },
  {
    icon: MapPin,
    title: "Echte Adressen",
    body: "Abholung und Ziel im Klartext statt Kartenausschnitt, lesbar auch in Bewegung.",
  },
  {
    icon: BarChart3,
    title: "Tageskennzahlen",
    body: "Angebote, Annahmequote, Verdienst und Strecke — pro Tag, Woche und Monat.",
  },
  {
    icon: Users,
    title: "Flottenkonten",
    body: "Fahrer per Einladung freigeschaltet. Läuft das Abo aus, endet der Zugang automatisch.",
  },
  {
    icon: Languages,
    title: "DE / EN / AR",
    body: "Vollständig gespiegelte Oberfläche für arabische Fahrer. Zahlen bleiben lateinisch.",
  },
  {
    icon: Moon,
    title: "Hell & dunkel",
    body: "Tag- und Nachtoberfläche, abgestimmt auf Fahrten zu jeder Tages- und Nachtzeit.",
  },
];

export function Features() {
  return (
    <section id="funktionen" className="mkt-section">
      <Container>
        <SectionHead title="Alles, was eine Flottencrew braucht. In einer App." meta="Alle Funktionen" />
        <div className="mkt-rule-grid grid-cols-[repeat(auto-fit,minmax(min(258px,100%),1fr))]">
          {FEATURES.map((f) => (
            <article key={f.title} className="mkt-cell flex flex-col gap-[11px]">
              <f.icon size={24} strokeWidth={1.4} aria-hidden />
              <h3 className="text-[17px] font-semibold">{f.title}</h3>
              <p className="text-[14px] leading-[1.6] text-ink-muted">{f.body}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
