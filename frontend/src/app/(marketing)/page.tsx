import Link from "next/link";
import {
  Users,
  Smartphone,
  Map,
  Bell,
  CreditCard,
  Languages,
  ShieldCheck,
  Server,
  Minimize2,
  KeyRound,
  ArrowRight,
  UserPlus,
  Settings2,
} from "lucide-react";
import { FaqItem } from "./_components/faq-item";

export const metadata = {
  title: "Reidey · Flottenmanagement für Fahrdienste",
  description:
    "Verwalte deine Flotte, deine Fahrer und deine Abläufe an einem Ort. Echtzeit-Benachrichtigungen, Live-Karte, Abrechnung und mehr. DSGVO-konform.",
};

const FAQ_PREVIEW = [
  {
    question: "Was ist Reidey?",
    answer:
      "Reidey ist eine Flottenmanagement-Plattform für Fahrdienst-Flotten. Du verwaltest Fahrer, Abläufe, Benachrichtigungen und Abrechnung an einem Ort, im Web und in der mobilen App.",
  },
  {
    question: "Wie erhalten Fahrer Zugang?",
    answer:
      "Du lädst Fahrer per E-Mail ein. Jeder Fahrer legt sein eigenes Passwort fest und meldet sich anschließend in der mobilen Fahrer-App an.",
  },
  {
    question: "Ist Reidey DSGVO-konform?",
    answer:
      "Ja. Wir verarbeiten Daten im Auftrag des Flottenbetreibers, nach dem Prinzip der Datenminimierung, mit klaren Rollen und Rechten. Das Hosting erfolgt in der EU.",
  },
  {
    question: "Welche Sprachen werden unterstützt?",
    answer:
      "Das Dashboard und die Fahrer-App sind mehrsprachig verfügbar: Deutsch, Englisch und Arabisch, inklusive Rechts-nach-links-Darstellung.",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* Hero (typographic, no image) */}
      <section className="relative isolate overflow-hidden">
        {/* Subtle token-based backdrop: faint emerald radial glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(16,185,129,0.12),transparent_70%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-line to-transparent"
        />
        <div className="mx-auto flex min-h-[100dvh] max-w-[880px] flex-col items-center justify-center px-4 pb-20 pt-24 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted">
            <ShieldCheck size={14} strokeWidth={1.75} className="text-emerald-600 dark:text-emerald-400" />
            DSGVO-konform, Hosting in der EU
          </span>
          <h1 className="mt-8 text-5xl font-bold leading-[1.05] tracking-tight text-ink sm:text-6xl lg:text-7xl">
            Deine Flotte.
            <br />
            Voll im Griff.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-ink-muted sm:text-xl">
            Fahrer, Abläufe und Abrechnung an einem Ort. Klar, schnell und mehrsprachig.
          </p>
          <div className="mt-10 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-7 py-3.5 text-sm font-semibold text-primary-ink transition-opacity hover:opacity-90"
            >
              Kostenlos starten
              <ArrowRight size={16} strokeWidth={1.75} />
            </Link>
            <Link
              href="#funktionen"
              className="inline-flex items-center justify-center rounded-full border border-line bg-surface px-7 py-3.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-2"
            >
              Funktionen ansehen
            </Link>
          </div>

          {/* Compact key highlights */}
          <div className="mt-16 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { icon: Users, label: "Fahrerverwaltung" },
              { icon: Bell, label: "Echtzeit-Benachrichtigungen" },
              { icon: Map, label: "Live-Karte" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-center gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium text-ink"
              >
                <item.icon size={18} strokeWidth={1.75} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                {item.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features (bento) */}
      <section id="funktionen" className="scroll-mt-20 border-t border-line bg-surface">
        <div className="mx-auto max-w-[1200px] px-4 py-20 lg:py-28">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              Alles, was deine Flotte braucht
            </h2>
            <p className="mt-4 text-lg text-ink-muted">
              Ein Werkzeug für Fahrerverwaltung, Kommunikation und Abrechnung. Klar, schnell und mehrsprachig.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Users,
                title: "Fahrerverwaltung & Einladungen",
                text: "Lade Fahrer per E-Mail ein, verwalte Profile, Rollen und Status. Jeder Fahrer ist in wenigen Minuten startklar.",
                tinted: true,
              },
              {
                icon: Bell,
                title: "Benachrichtigungen",
                text: "Push, E-Mail und In-App. Erreiche deine Fahrer zuverlässig, einzeln oder als Broadcast an die ganze Flotte.",
                tinted: true,
              },
              {
                icon: Smartphone,
                title: "Mobile Fahrer-App",
                text: "Echtzeit-Benachrichtigungen direkt aufs Smartphone deiner Fahrer.",
                tinted: false,
              },
              {
                icon: Map,
                title: "Live-Karte deiner Fahrer",
                text: "Behalte den Überblick über deine eigene Flotte in Echtzeit.",
                tinted: false,
              },
              {
                icon: CreditCard,
                title: "Abonnements & Abrechnung",
                text: "Verwalte Pläne, Zahlungen und den Status deiner Flotte an einem Ort.",
                tinted: false,
              },
              {
                icon: Languages,
                title: "Mehrsprachig",
                text: "Dashboard und App in Deutsch, Englisch und Arabisch, inklusive Rechts-nach-links-Darstellung.",
                tinted: false,
              },
            ].map((feature) => (
              <article
                key={feature.title}
                className={
                  "flex flex-col rounded-xl border p-7 " +
                  (feature.tinted
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-line bg-canvas")
                }
              >
                <div
                  className={
                    "flex h-11 w-11 items-center justify-center rounded-full " +
                    (feature.tinted
                      ? "bg-emerald-600 text-white"
                      : "bg-surface-2 text-emerald-600 dark:text-emerald-400")
                  }
                >
                  <feature.icon size={22} strokeWidth={1.75} />
                </div>
                <h3 className="mt-6 text-lg font-semibold text-ink">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{feature.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="ablauf" className="scroll-mt-20 border-t border-line">
        <div className="mx-auto max-w-[1200px] px-4 py-20 lg:py-28">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              In drei Schritten startklar
            </h2>
            <p className="mt-4 text-lg text-ink-muted">
              Von der Anmeldung bis zur laufenden Flotte, ohne technischen Aufwand.
            </p>
          </div>

          <ol className="mt-14 grid grid-cols-1 gap-8 md:grid-cols-3">
            {[
              {
                icon: KeyRound,
                title: "Konto erstellen",
                text: "Registriere deine Flotte in wenigen Minuten und richte dein Dashboard ein.",
              },
              {
                icon: UserPlus,
                title: "Fahrer einladen",
                text: "Sende Einladungen per E-Mail. Deine Fahrer melden sich in der App an.",
              },
              {
                icon: Settings2,
                title: "Flotte steuern",
                text: "Sende Benachrichtigungen, behalte den Überblick und verwalte die Abrechnung.",
              },
            ].map((step, i) => (
              <li key={step.title} className="relative">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-emerald-600 dark:text-emerald-400">
                    <step.icon size={22} strokeWidth={1.75} />
                  </div>
                  <span className="text-sm font-semibold text-ink-subtle tabular-nums">0{i + 1}</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1200px] px-4 py-16">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: ShieldCheck, title: "DSGVO-konform", text: "Verarbeitung im Auftrag, transparent und regelkonform." },
              { icon: Server, title: "Daten in der EU", text: "Hosting und Verarbeitung innerhalb der Europäischen Union." },
              { icon: Minimize2, title: "Datenminimierung", text: "Nur die Daten, die für den Betrieb wirklich nötig sind." },
              { icon: KeyRound, title: "Rollen & Rechte", text: "Feingranulare Zugriffssteuerung für dein gesamtes Team." },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-line bg-canvas p-6">
                <item.icon size={22} strokeWidth={1.75} className="text-emerald-600 dark:text-emerald-400" />
                <h3 className="mt-4 text-sm font-semibold text-ink">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ preview */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-[820px] px-4 py-20 lg:py-24">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Häufige Fragen</h2>
            <p className="mt-4 text-lg text-ink-muted">
              Kurz beantwortet. Mehr Details findest du im vollständigen FAQ.
            </p>
          </div>
          <div className="mt-10 space-y-3">
            {FAQ_PREVIEW.map((item) => (
              <FaqItem key={item.question} question={item.question} answer={item.answer} />
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link
              href="/faq"
              className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-600 transition-colors hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
            >
              Alle Fragen ansehen
              <ArrowRight size={16} strokeWidth={1.75} />
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1200px] px-4 py-20 lg:py-24">
          <div className="rounded-xl border border-line bg-canvas px-6 py-14 text-center sm:px-12">
            <h2 className="mx-auto max-w-xl text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              Bereit, deine Flotte zu steuern?
            </h2>
            <p className="mx-auto mt-4 max-w-md text-lg text-ink-muted">
              Starte kostenlos und richte dein Dashboard in wenigen Minuten ein.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-ink transition-opacity hover:opacity-90"
              >
                Kostenlos starten
                <ArrowRight size={16} strokeWidth={1.75} />
              </Link>
              <Link
                href="/faq"
                className="inline-flex items-center justify-center rounded-full border border-line bg-surface px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-surface-2"
              >
                Mehr erfahren
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
