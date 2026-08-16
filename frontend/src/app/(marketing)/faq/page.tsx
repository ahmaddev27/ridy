import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FaqItem } from "../_components/faq-item";

export const metadata = {
  title: "FAQ · Reidey",
  description:
    "Antworten auf häufige Fragen zu Reidey: Fahrerzugang, Sprachen, mobile App, Benachrichtigungen, Datensicherheit, Preise und Support.",
};

const GROUPS: { title: string; items: { question: string; answer: string }[] }[] = [
  {
    title: "Grundlagen",
    items: [
      {
        question: "Was ist Reidey?",
        answer:
          "Reidey ist eine Flottenmanagement-Plattform für Fahrdienst-Flotten. Du verwaltest Fahrer, Abläufe, Benachrichtigungen und Abrechnung zentral, im Web-Dashboard und in der mobilen Fahrer-App.",
      },
      {
        question: "Für wen ist Reidey gedacht?",
        answer:
          "Für Flottenbetreiber, die mehrere Fahrer koordinieren. Reidey hilft dir, deine Fahrer zu verwalten, mit ihnen zu kommunizieren und die Abrechnung deiner Flotte im Blick zu behalten.",
      },
    ],
  },
  {
    title: "Fahrer & Zugang",
    items: [
      {
        question: "Wie erhalten Fahrer Zugang?",
        answer:
          "Du lädst Fahrer per E-Mail ein. Über den Einladungslink legt jeder Fahrer sein eigenes Passwort fest und meldet sich anschließend in der mobilen App an. Du behältst die Kontrolle über Rollen und Status.",
      },
      {
        question: "Können Fahrer ihre eigenen Daten verwalten?",
        answer:
          "Ja. Fahrer melden sich mit ihrem eigenen Passwort an und sehen die für sie relevanten Informationen und Benachrichtigungen in der App.",
      },
    ],
  },
  {
    title: "App & Benachrichtigungen",
    items: [
      {
        question: "Wie funktioniert die mobile Fahrer-App?",
        answer:
          "Die App ist der Draht zu deinen Fahrern. Sie erhalten dort Echtzeit-Benachrichtigungen, sehen relevante Informationen und bleiben mit der Flottenzentrale verbunden.",
      },
      {
        question: "Welche Arten von Benachrichtigungen gibt es?",
        answer:
          "Reidey unterstützt Push-Benachrichtigungen, E-Mail und In-App-Nachrichten. Du kannst einzelne Fahrer ansprechen oder eine Nachricht als Broadcast an die ganze Flotte senden.",
      },
    ],
  },
  {
    title: "Sprachen",
    items: [
      {
        question: "Welche Sprachen werden unterstützt?",
        answer:
          "Dashboard und App sind mehrsprachig: Deutsch, Englisch und Arabisch. Für Arabisch wird die Rechts-nach-links-Darstellung vollständig unterstützt.",
      },
    ],
  },
  {
    title: "Datenschutz & Sicherheit",
    items: [
      {
        question: "Wie steht es um Datensicherheit und DSGVO?",
        answer:
          "Reidey verarbeitet personenbezogene Daten im Auftrag des Flottenbetreibers (Auftragsverarbeitung) und nach dem Grundsatz der Datenminimierung. Zugriffe sind über Rollen und Rechte geregelt. Details findest du in unserer Datenschutzerklärung.",
      },
      {
        question: "Wo werden die Daten gehostet?",
        answer:
          "Die Verarbeitung und das Hosting erfolgen innerhalb der Europäischen Union.",
      },
    ],
  },
  {
    title: "Preise & Support",
    items: [
      {
        question: "Was kostet Reidey?",
        answer:
          "Reidey wird als Abonnement angeboten. Pläne, Zahlungen und der Status deiner Flotte lassen sich direkt im Dashboard verwalten. Für aktuelle Konditionen kontaktiere uns bitte.",
      },
      {
        question: "Wie erreiche ich den Support?",
        answer:
          "Bei Fragen erreichst du uns per E-Mail unter [E-Mail]. Wir helfen dir gerne bei Einrichtung und Betrieb deiner Flotte.",
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-[820px] px-4 py-16 lg:py-24">
      <header>
        <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">Häufige Fragen</h1>
        <p className="mt-4 text-lg text-ink-muted">
          Alles Wichtige rund um Reidey, kompakt beantwortet.
        </p>
      </header>

      <div className="mt-14 space-y-12">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-subtle">
              {group.title}
            </h2>
            <div className="mt-4 space-y-3">
              {group.items.map((item) => (
                <FaqItem key={item.question} question={item.question} answer={item.answer} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-16 rounded-xl border border-line bg-surface p-8 text-center">
        <h2 className="text-xl font-semibold text-ink">Noch Fragen offen?</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
          Starte kostenlos oder schreib uns. Wir begleiten dich bei der Einrichtung deiner Flotte.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-ink transition-opacity hover:opacity-90"
        >
          Kostenlos starten
          <ArrowRight size={16} strokeWidth={1.75} />
        </Link>
      </div>
    </div>
  );
}
