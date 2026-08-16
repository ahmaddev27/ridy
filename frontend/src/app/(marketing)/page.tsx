import Link from "next/link";
import Image from "next/image";
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
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid min-h-[100dvh] max-w-[1200px] grid-cols-1 items-center gap-12 px-4 pb-16 pt-24 lg:grid-cols-2 lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted">
              <ShieldCheck size={14} strokeWidth={1.75} className="text-emerald-600 dark:text-emerald-400" />
              DSGVO-konform, Hosting in der EU
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight text-ink sm:text-5xl lg:text-6xl">
              Deine Flotte.
              <br />
              Voll im Griff.
            </h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-ink-muted">
              Verwalte deine Fahrer, deine Abläufe und deine Abrechnung an einem Ort.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-ink transition-opacity hover:opacity-90"
              >
                Kostenlos starten
                <ArrowRight size={16} strokeWidth={1.75} />
              </Link>
              <Link
                href="#funktionen"
                className="inline-flex items-center justify-center rounded-full border border-line bg-surface px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-surface-2"
              >
                Funktionen ansehen
              </Link>
            </div>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
              <Image
                src="https://picsum.photos/seed/reidey-fleet/1200/900"
                alt="Abstrakte Darstellung einer vernetzten Flotte"
                width={1200}
                height={900}
                priority
                className="h-full w-full object-cover"
              />
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-4 -z-10 rounded-[2rem] bg-emerald-500/10 blur-2xl"
            />
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

          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-6">
            {/* Large tinted cell */}
            <article className="flex flex-col justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-7 md:col-span-4 md:row-span-2">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-white">
                <Users size={22} strokeWidth={1.75} />
              </div>
              <div className="mt-8">
                <h3 className="text-xl font-semibold text-ink">Fahrerverwaltung & Einladungen</h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
                  Lade Fahrer per E-Mail ein, verwalte Profile, Rollen und Status. Jeder Fahrer legt sein eigenes Passwort fest und ist in wenigen Minuten startklar.
                </p>
              </div>
            </article>

            {/* Icon-forward small cell */}
            <article className="rounded-xl border border-line bg-canvas p-7 md:col-span-2">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-emerald-600 dark:text-emerald-400">
                <Smartphone size={22} strokeWidth={1.75} />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-ink">Mobile Fahrer-App</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Echtzeit-Benachrichtigungen direkt aufs Smartphone deiner Fahrer.
              </p>
            </article>

            {/* Icon-forward small cell */}
            <article className="rounded-xl border border-line bg-canvas p-7 md:col-span-2">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-emerald-600 dark:text-emerald-400">
                <Map size={22} strokeWidth={1.75} />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-ink">Live-Karte deiner Fahrer</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Behalte den Überblick über deine eigene Flotte in Echtzeit.
              </p>
            </article>

            {/* Wide tinted cell */}
            <article className="flex items-start gap-5 rounded-xl border border-line bg-surface-2 p-7 md:col-span-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                <Bell size={22} strokeWidth={1.75} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-ink">Benachrichtigungen</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  Push, E-Mail und In-App. Erreiche deine Fahrer zuverlässig, einzeln oder als Broadcast an die ganze Flotte.
                </p>
              </div>
            </article>

            <article className="rounded-xl border border-line bg-canvas p-7 md:col-span-3">
              <div className="flex items-start gap-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-emerald-600 dark:text-emerald-400">
                  <CreditCard size={22} strokeWidth={1.75} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-ink">Abonnements & Abrechnung</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                    Verwalte Pläne, Zahlungen und den Status deiner Flotte an einem Ort.
                  </p>
                </div>
              </div>
            </article>

            <article className="flex items-center gap-5 rounded-xl border border-line bg-canvas p-7 md:col-span-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-emerald-600 dark:text-emerald-400">
                <Languages size={22} strokeWidth={1.75} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-ink">Mehrsprachig</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                  Dashboard und App in Deutsch, Englisch und Arabisch, inklusive Rechts-nach-links-Darstellung.
                </p>
              </div>
            </article>
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
