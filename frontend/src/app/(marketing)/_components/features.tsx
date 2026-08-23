import {
  Gauge,
  ScrollText,
  Bell,
  MapPin,
  BarChart3,
  Users,
  Languages,
  Moon,
} from "lucide-react";
import { Container, SectionHeading } from "./ui";
import { TiltCard } from "./tilt-card";

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
    <section id="funktionen" className="relative overflow-hidden py-14 lg:py-28">
      <div
        className="bg-gradient-accent pointer-events-none absolute left-1/2 top-40 h-[300px] w-[600px] -translate-x-1/2 rounded-full"
        style={{ opacity: 0.06, filter: "blur(120px)" }}
      />
      <Container className="relative">
        <SectionHeading
          eyebrow="Alle Funktionen"
          title="Alles, was eine Flottencrew braucht. In einer App."
          sub="Acht Module, die nahtlos zusammenarbeiten. Keine Integrationen. Keine Umwege."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <TiltCard key={f.title} className="card-modern group rounded-3xl p-6">
              <div className="feat-tile bg-gradient-accent-soft mb-4 flex h-11 w-11 items-center justify-center rounded-xl transition-colors">
                <f.icon
                  size={20}
                  className="text-primary transition-colors group-hover:text-white"
                />
              </div>
              <h3 className="font-heading mb-1.5 text-base font-semibold text-white">
                {f.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </TiltCard>
          ))}
        </div>
      </Container>
    </section>
  );
}
